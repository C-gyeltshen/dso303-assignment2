# Backend code is built by `npm ci --omit=dev` in ../backend (CI does this) and zipped here.
data "archive_file" "backend" {
  type        = "zip"
  source_dir  = "${path.module}/../backend"
  output_path = "${path.module}/.build/backend.zip"
}

locals {
  common_env = {
    DB_HOST          = aws_db_proxy.main.endpoint
    DB_NAME          = aws_db_instance.main.db_name
    DB_SECRET_ARN    = aws_db_instance.main.master_user_secret[0].secret_arn
    UPLOAD_BUCKET    = aws_s3_bucket.uploads.bucket
    MARKING_QUEUE    = aws_sqs_queue.q["marking"].url
    NOTIFY_QUEUE     = aws_sqs_queue.q["notify"].url
    SES_SENDER       = var.ses_sender_email
    USER_POOL_ID     = aws_cognito_user_pool.main.id
    SITE_URL         = local.site_url
    NODE_OPTIONS     = "--enable-source-maps"
  }

  functions = {
    api = {
      handler     = "src/api.handler"
      timeout     = 10
      memory      = 512
      concurrency = var.api_reserved_concurrency
    }
    marker = {
      handler     = "src/marker.handler"
      timeout     = 10
      memory      = 256
      concurrency = var.worker_reserved_concurrency
    }
    upload-processor = {
      handler     = "src/uploadProcessor.handler"
      timeout     = 30
      memory      = 256
      concurrency = -1
    }
    notifier = {
      handler     = "src/notifier.handler"
      timeout     = 30
      memory      = 256
      concurrency = var.worker_reserved_concurrency
    }
    migrate = {
      handler     = "src/migrate.handler"
      timeout     = 60
      memory      = 256
      concurrency = -1
    }
  }
}

# ---------------- IAM: one least-privilege role per function ----------------
resource "aws_iam_role" "fn" {
  for_each = local.functions
  name     = "${local.name}-${each.key}"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "vpc" {
  for_each   = local.functions
  role       = aws_iam_role.fn[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy_attachment" "xray" {
  for_each   = local.functions
  role       = aws_iam_role.fn[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

locals {
  db_secret_stmt = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_db_instance.main.master_user_secret[0].secret_arn },
    { Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.main.arn }
  ]
  ses_stmt = [{ Effect = "Allow", Action = ["ses:SendEmail", "ses:SendRawEmail"], Resource = "*",
  Condition = { StringEquals = { "ses:FromAddress" = var.ses_sender_email } } }]

  fn_policies = {
    api = concat(local.db_secret_stmt, [
      { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.uploads.arn}/submissions/*" },
      { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.uploads.arn}/submissions/*" },
      { Effect = "Allow", Action = ["kms:GenerateDataKey", "kms:Decrypt"], Resource = aws_kms_key.main.arn },
      { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = [aws_sqs_queue.q["marking"].arn, aws_sqs_queue.q["notify"].arn] },
      { Effect = "Allow", Action = ["cognito-idp:AdminCreateUser", "cognito-idp:AdminAddUserToGroup", "cognito-idp:ListUsers"], Resource = aws_cognito_user_pool.main.arn }
    ])
    marker = concat(local.db_secret_stmt, [
      { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.q["marking"].arn }
    ])
    upload-processor = concat(local.db_secret_stmt, local.ses_stmt, [
      { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.q["uploads"].arn },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObjectTagging"], Resource = "${aws_s3_bucket.uploads.arn}/submissions/*" }
    ])
    notifier = concat(local.db_secret_stmt, local.ses_stmt, [
      { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.q["notify"].arn }
    ])
    migrate = local.db_secret_stmt
  }
}

resource "aws_iam_role_policy" "fn" {
  for_each = local.functions
  role     = aws_iam_role.fn[each.key].id
  policy   = jsonencode({ Version = "2012-10-17", Statement = local.fn_policies[each.key] })
}

# ---------------- Functions ----------------
resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.functions
  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = 90
  kms_key_id        = aws_kms_key.main.arn
}

resource "aws_lambda_function" "fn" {
  for_each                       = local.functions
  function_name                  = "${local.name}-${each.key}"
  role                           = aws_iam_role.fn[each.key].arn
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = each.value.handler
  filename                       = data.archive_file.backend.output_path
  source_code_hash               = data.archive_file.backend.output_base64sha256
  timeout                        = each.value.timeout
  memory_size                    = each.value.memory
  reserved_concurrent_executions = each.value.concurrency

  vpc_config {
    subnet_ids         = aws_subnet.app[*].id # both AZs
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment { variables = local.common_env }
  tracing_config { mode = "Active" }

  depends_on = [aws_cloudwatch_log_group.fn, aws_iam_role_policy_attachment.vpc]
}

# ---------------- SQS triggers ----------------
locals {
  triggers = {
    marker           = { queue = "marking", batch = 10 }
    upload-processor = { queue = "uploads", batch = 5 }
    notifier         = { queue = "notify", batch = 10 }
  }
}

resource "aws_lambda_event_source_mapping" "sqs" {
  for_each                = local.triggers
  event_source_arn        = aws_sqs_queue.q[each.value.queue].arn
  function_name           = aws_lambda_function.fn[each.key].arn
  batch_size              = each.value.batch
  function_response_types = ["ReportBatchItemFailures"]
}
