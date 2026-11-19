# Online Exams & Assignments Platform on AWS

Cloud architecture for a university (8,000 students, ~400 staff) moving all exams and assignment submissions online.

- **Targets met by design:** 99.9 % availability during exams · survives the loss of one AZ · RPO ≤ 5 min · RTO ≤ 1 h · 5-year retention · encryption in transit (TLS everywhere) and at rest (KMS)
- **Peak:** 3,000 students starting one exam within 5 minutes, autosave every 30 s (≈100 writes/s)

| Deliverable | Where |
|---|---|
| Architecture diagram, walkthroughs, peak/AZ explanation | [`architecture/`](architecture/README.md) |
| Service table (role, why over an alternative, configuration, connections) | [`docs/services.md`](docs/services.md) |
| Cloud Architecture Lab build guide | [`architecture/cloud-architecture-lab.md`](architecture/cloud-architecture-lab.md) |
| Evidence (lab screenshots, failover log) | [`evidence/`](evidence/README.md) |
| Infrastructure as code (Terraform) | [`infra/`](infra) |
| Lambda backend (Node.js 22) | [`backend/`](backend) |
| Frontend SPA | [`frontend/`](frontend) |
| CI/CD | [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) |

## Architecture summary

Route 53 → **CloudFront + WAF** → S3 (SPA) and **API Gateway HTTP API** (Cognito JWT authorizer) → **Lambda** in private subnets across **two AZs** → **RDS Proxy** → **RDS PostgreSQL Multi-AZ** in private data subnets. Assignment files go **directly to S3** via presigned POST (≤ 50 MB, SSE-KMS, lifecycle to Glacier, deleted after 5 years). Marking, upload processing and emails run asynchronously through **SQS → Lambda → SES**. Secrets Manager holds DB credentials, KMS encrypts data at rest, CloudWatch/X-Ray/CloudTrail provide monitoring and audit, AWS Backup keeps monthly DB backups for 5 years. Everything is deployed by **Terraform from GitHub Actions** on every push to `main`.

![architecture](architecture/architecture.png)

## Repository layout

```
architecture/   diagram (PNG + diagram.py source), walkthroughs, lab guide
docs/           services.md, viva-notes.md
evidence/       screenshots from the Cloud Architecture Lab and AWS
infra/          Terraform: network, security, database, storage, auth, queues, lambda, api, edge, monitoring
infra/bootstrap one-off: Terraform state bucket + GitHub OIDC deploy role
backend/        Lambda handlers (api, marker, uploadProcessor, notifier, migrate) + unit tests
frontend/       static SPA (Cognito Hosted UI + PKCE, exam autosave, uploads)
scripts/        create-test-users.sh, simulate-az-loss.sh
```

## Deploy

### Prerequisites
- AWS account, AWS CLI v2 signed in as an admin, Terraform ≥ 1.10, Node.js 22, a GitHub repository.
- An email address you can receive mail on (SES sandbox: sender and recipients must be verified).

### 1. Bootstrap (once, from your laptop)
```bash
cd infra/bootstrap
terraform init
terraform apply -var github_repo=<your-github-user>/<repo>
# note the outputs: state_bucket, deploy_role_arn
```

### 2. Configure GitHub
Repository → Settings → Secrets and variables → Actions:

| Type | Name | Value |
|---|---|---|
| Secret | `AWS_DEPLOY_ROLE_ARN` | `deploy_role_arn` output |
| Secret | `TF_STATE_BUCKET` | `state_bucket` output |
| Variable | `ALARM_EMAIL` | your email |
| Variable | `SES_SENDER_EMAIL` | your email (sender) |
| Variable | `SES_VERIFY_EMAILS` | `["tutor.test@example.com","student.test@example.com"]` |
| Variable | `SINGLE_NAT_GATEWAY` | `true` for a cheap demo, `false` for production |

### 3. Push to `main`
```bash
git push origin main
```
The pipeline runs tests → `terraform plan/apply` → database migration (with demo exam + assignment seed) → uploads the SPA with a generated `config.js` → invalidates CloudFront → smoke-tests `/api/health`. Pull requests run the same checks plus `terraform plan` without applying. First deploy takes ~20–25 min (RDS Multi-AZ + CloudFront).

### 4. After the first deploy
1. Click the verification links SES and SNS send to your inboxes.
2. Create demo users:
   ```bash
   cd infra && terraform init -backend-config="bucket=<state_bucket>" -backend-config="key=prod/terraform.tfstate" -backend-config="region=ap-south-1" && cd ..
   ./scripts/create-test-users.sh student.test@example.com tutor.test@example.com admin.test@example.com 'Demo-Passw0rd!'
   ```
3. Open the `site_url` output, sign in as the student, open **Demo: Cloud Computing Quiz** and upload a PDF to **Demo: Architecture Report**.

### Local deploy (without CI)
```bash
cd backend && npm ci --omit=dev && cd ../infra
cp backend.hcl.example backend.hcl && cp terraform.tfvars.example terraform.tfvars   # edit both
terraform init -backend-config=backend.hcl
terraform apply
```
then run the "Migrate" and "Deploy frontend" steps from the workflow by hand.

## Demonstrating the requirements (video script)

| Requirement | How to show it |
|---|---|
| Frontend + API | Sign in as student, list exams (`/api/exams`) |
| Autosave | Answer a question, wait 30 s → "Saved hh:mm:ss"; refresh the page → answers return |
| Two-AZ database | RDS console → Multi-AZ **Yes**, primary and secondary AZ shown |
| S3 uploads | Upload a ~40 MB PDF, show progress bar and the object in S3 (encrypted, KMS) |
| Async step | Show the `upload-processor` log in CloudWatch and the tutor email; submit the exam and show the MCQ score appear (marker Lambda) |
| AZ loss | `./scripts/simulate-az-loss.sh` → `evidence/az-failover-log.txt` shows the DB moving to the other AZ while `/api/health` keeps answering; then `terraform -chdir=infra apply` to restore |
| CI/CD | Change some text in `frontend/index.html`, push to `main`, show the pipeline and the change live |

## Tear down
```bash
cd infra
terraform destroy          # with the same backend config / variables used to deploy
cd bootstrap
terraform destroy          # removes state bucket (empty it first: aws s3 rm s3://<state_bucket> --recursive) and OIDC role
```
Notes: set `deletion_protection = false` before destroying (it is the default for the demo). The KMS key is scheduled for deletion after 7 days. If destroy reports the backup vault isn't empty, delete its recovery points in the AWS Backup console and run destroy again.

## Cost guide (ap-south-1, demo settings)
Roughly **USD 3–4 per day** while deployed (estimate – check the AWS Pricing Calculator): one NAT gateway ≈ $1.3/day, RDS `db.t4g.micro` Multi-AZ ≈ $1/day, RDS Proxy ≈ $0.7/day; Lambda, API Gateway, SQS, S3 and CloudFront are pennies at demo traffic. **Destroy when you're done recording.**

## Security summary
- No public database; RDS reachable only from RDS Proxy's security group; data subnets have no internet route.
- TLS everywhere: CloudFront HTTPS-only, `rds.force_ssl`, RDS Proxy `require_tls`, S3 bucket policy denies non-TLS.
- At rest: KMS CMK for RDS, S3 uploads, Secrets Manager, CloudWatch Logs, SNS; SSE for SQS and other buckets.
- Least-privilege IAM role per Lambda; CI uses short-lived OIDC credentials, no stored AWS keys.
- WAF managed rules + per-IP rate limit; API Gateway throttling; Cognito with optional TOTP MFA and admin-only account creation.
