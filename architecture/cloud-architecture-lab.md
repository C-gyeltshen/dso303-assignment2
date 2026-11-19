# Building the design in the Cloud Architecture Lab

Lab: <https://main.d35uam9e2t7o65.amplifyapp.com/>

Build exactly the architecture in `architecture.png`, so the lab, the diagram, the Terraform and the service table all match (the viva will check this). Use the component names below. If the lab doesn't have a component, use its closest generic block and label it.

## 1. Canvas layout (build from outside in)

| # | Place | Inside | Label it |
|---|---|---|---|
| 1 | Region | — | `ap-south-1` |
| 2 | VPC | Region | `exam-vpc 10.0.0.0/16` |
| 3 | Availability Zone ×2 | VPC | `AZ-a`, `AZ-b` |
| 4 | Public subnet | each AZ | `public-a 10.0.0.0/24`, `public-b 10.0.1.0/24` |
| 5 | Private subnet (app) | each AZ | `app-a 10.0.10.0/24`, `app-b 10.0.11.0/24` |
| 6 | Private subnet (data) | each AZ | `data-a 10.0.20.0/24`, `data-b 10.0.21.0/24` |
| 7 | Internet Gateway | VPC edge | `igw` |
| 8 | NAT Gateway | each public subnet | `nat-a`, `nat-b` |
| 9 | Lambda (API) | each app subnet | `api-lambda` |
| 10 | Lambda (workers) | each app subnet | `marker / upload-processor / notifier` |
| 11 | RDS Proxy | app subnets (span both) | `rds-proxy` |
| 12 | RDS PostgreSQL | data-a | `db-primary` (Multi-AZ on) |
| 13 | RDS PostgreSQL standby | data-b | `db-standby` |
| 14 | VPC endpoint (S3 gateway) | VPC | `s3-endpoint` |
| 15 | Route 53, CloudFront, WAF, ACM | outside the region (edge) | — |
| 16 | Cognito | region (outside VPC) | `user-pool (students/tutors/admins)` |
| 17 | API Gateway (HTTP API) | region | `http-api + JWT authorizer` |
| 18 | S3 ×2 | region | `s3-frontend`, `s3-uploads (KMS, lifecycle)` |
| 19 | SQS ×3 (+ DLQs) | region | `marking-queue`, `uploads-queue`, `notify-queue` |
| 20 | SES | region | `ses-email` |
| 21 | Secrets Manager, KMS, CloudWatch, X-Ray, CloudTrail, AWS Backup, SNS | region | — |
| 22 | CI/CD (GitHub Actions / CodePipeline block) | outside | `github-actions → terraform` |

**Security groups** (if the lab models them): `lambda-sg` → `proxy-sg` on 5432 → `db-sg` on 5432. The DB must **not** be public.

## 2. Connections to draw

```
User → Route 53 → CloudFront (WAF attached)
CloudFront → s3-frontend              (path /*)
CloudFront → http-api                 (path /api/*)
User → Cognito                        (sign-in)
http-api → Cognito                    (JWT check)
http-api → api-lambda (AZ-a and AZ-b)
api-lambda → rds-proxy → db-primary   (db-primary ⇄ db-standby: sync replication)
api-lambda → marking-queue, notify-queue
User → s3-uploads                     (presigned POST)
s3-uploads → uploads-queue → upload-processor → ses-email
marking-queue → marker → rds-proxy
notify-queue → notifier → ses-email
Lambdas (app subnets) → nat-a / nat-b → igw
rds-proxy → Secrets Manager;  s3-uploads, db, secrets → KMS
All → CloudWatch → Alarms → SNS
```

## 3. Simulations to run (screenshot each)

**Walkthrough 1 – student opens exam + autosave**
Send a request along: `User → Route 53 → CloudFront → WAF → API Gateway (JWT) → api-lambda → rds-proxy → db-primary`. If the lab lets you set request rate, run a burst of ~100 req/s (3,000 students ÷ 30 s autosave) and screenshot the result showing no failures.

**Walkthrough 2 – 40 MB upload + tutor email**
Send: `User → API Gateway → api-lambda` (get presigned URL), then `User → s3-uploads → uploads-queue → upload-processor → rds-proxy/db` and `upload-processor → SES`. Point out that the 40 MB file never passes through API Gateway/Lambda.

**AZ failure**
Use the lab's failure tool to fail **AZ-a** (or each component in AZ-a: nat-a, api-lambda-a, db-primary). Show:
1. Requests still succeed via AZ-b (`nat-b`, `api-lambda-b`).
2. `db-standby` is promoted to primary.
3. Re-run walkthrough 1 after the failure → still succeeds.

## 4. Evidence to save in `evidence/`

| File | What it shows |
|---|---|
| `lab-01-full-architecture.png` | Whole canvas, both AZs, all tiers labelled |
| `lab-02-walkthrough-exam-autosave.png` | Request path highlighted, success result |
| `lab-03-walkthrough-upload-notify.png` | Upload path + email step highlighted |
| `lab-04-peak-load.png` | Burst / load result (if the lab supports it) |
| `lab-05-az-a-failed.png` | AZ-a marked failed |
| `lab-06-after-failover.png` | Traffic served from AZ-b, standby promoted |
| `lab-export.json` (if the lab can export) | The saved design |
