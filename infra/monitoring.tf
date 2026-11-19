# ---------------- Alerts ----------------
resource "aws_sns_topic" "ops" {
  name              = "${local.name}-ops-alerts"
  kms_master_key_id = aws_kms_key.main.id
}

resource "aws_sns_topic_subscription" "ops_email" {
  topic_arn = aws_sns_topic.ops.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  fn_names = { for k, f in aws_lambda_function.fn : k => f.function_name }
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.name}-api-5xx"
  alarm_description   = "API returned 5xx responses"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = aws_apigatewayv2_api.http.id, Stage = "$default" }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.ops.arn]
  ok_actions          = [aws_sns_topic.ops.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = local.fn_names
  alarm_name          = "${each.value}-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.ops.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  alarm_name          = "${local.name}-api-throttles"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = local.fn_names["api"] }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.ops.arn]
}

resource "aws_cloudwatch_metric_alarm" "dlq" {
  for_each            = aws_sqs_queue.dlq
  alarm_name          = "${each.value.name}-not-empty"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = each.value.name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.ops.arn]
}

resource "aws_cloudwatch_metric_alarm" "queue_age" {
  for_each            = aws_sqs_queue.q
  alarm_name          = "${each.value.name}-backlog"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = each.value.name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 300
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.ops.arn]
}

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${local.name}-db-cpu"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_sns_topic.ops.arn]
}

resource "aws_db_event_subscription" "failover" {
  name             = "${local.name}-db-events"
  sns_topic        = aws_sns_topic.ops.arn
  source_type      = "db-instance"
  source_ids       = [aws_db_instance.main.identifier]
  event_categories = ["failover", "failure", "availability"]
}

# ---------------- Dashboard ----------------
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.name
  dashboard_body = jsonencode({
    widgets = [
      { type = "metric", x = 0, y = 0, width = 12, height = 6, properties = {
        title = "API requests / errors", region = var.region, stat = "Sum", period = 60,
        metrics = [
          ["AWS/ApiGateway", "Count", "ApiId", aws_apigatewayv2_api.http.id, "Stage", "$default"],
          [".", "4xx", ".", ".", ".", "."],
          [".", "5xx", ".", ".", ".", "."]
      ] } },
      { type = "metric", x = 12, y = 0, width = 12, height = 6, properties = {
        title = "API latency p95 (ms)", region = var.region, stat = "p95", period = 60,
        metrics = [["AWS/ApiGateway", "Latency", "ApiId", aws_apigatewayv2_api.http.id, "Stage", "$default"]]
      } },
      { type = "metric", x = 0, y = 6, width = 12, height = 6, properties = {
        title = "Lambda concurrency", region = var.region, stat = "Maximum", period = 60,
        metrics = [for k, n in local.fn_names : ["AWS/Lambda", "ConcurrentExecutions", "FunctionName", n]]
      } },
      { type = "metric", x = 12, y = 6, width = 12, height = 6, properties = {
        title = "RDS CPU / connections", region = var.region, stat = "Average", period = 60,
        metrics = [
          ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.main.identifier],
          [".", "DatabaseConnections", ".", ".", { yAxis = "right" }]
      ] } },
      { type = "metric", x = 0, y = 12, width = 24, height = 6, properties = {
        title = "Queue backlog", region = var.region, stat = "Maximum", period = 60,
        metrics = [for k, q in aws_sqs_queue.q : ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", q.name]]
      } }
    ]
  })
}

# ---------------- Audit ----------------
resource "aws_s3_bucket" "trail" {
  count         = var.enable_cloudtrail ? 1 : 0
  bucket        = "${local.name}-trail-${random_id.suffix.hex}"
  force_destroy = !var.deletion_protection
}

resource "aws_s3_bucket_public_access_block" "trail" {
  count                   = var.enable_cloudtrail ? 1 : 0
  bucket                  = aws_s3_bucket.trail[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  rule {
    id     = "retain-5-years"
    status = "Enabled"
    filter {}
    transition {
      days          = 90
      storage_class = "GLACIER"
    }
    expiration { days = 1825 }
  }
}

resource "aws_s3_bucket_policy" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "AclCheck", Effect = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" },
      Action = "s3:GetBucketAcl", Resource = aws_s3_bucket.trail[0].arn },
      { Sid = "Write", Effect = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" },
        Action   = "s3:PutObject", Resource = "${aws_s3_bucket.trail[0].arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/*",
      Condition = { StringEquals = { "s3:x-amz-acl" = "bucket-owner-full-control" } } }
    ]
  })
}

resource "aws_cloudtrail" "main" {
  count                         = var.enable_cloudtrail ? 1 : 0
  name                          = "${local.name}-trail"
  s3_bucket_name                = aws_s3_bucket.trail[0].id
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true
  depends_on                    = [aws_s3_bucket_policy.trail]
}

# ---------------- SES ----------------
resource "aws_ses_email_identity" "sender" {
  email = var.ses_sender_email
}

resource "aws_ses_email_identity" "test" {
  for_each = toset(var.ses_verify_emails)
  email    = each.key
}
