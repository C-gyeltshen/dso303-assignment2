# AWS services used

Every service in the design: what job it does, why it was chosen over another option, how it is set up, and what it connects to. The services are grouped by layer, in the same order as the [architecture diagram](../architecture/architecture-diagram.png).

## Edge layer

| Service | Role | Why over an alternative | Key settings | Connects to |
|---|---|---|---|---|
| Amazon Route 53 | DNS: turns `exam.uni.edu` into an address | Free "alias" records point straight at CloudFront and include health checks. An outside DNS provider cannot do this | Public hosted zone; A and AAAA alias records to CloudFront | CloudFront |
| AWS WAF | Web firewall for the site | Blocks SQL injection, cross-site scripting and request floods. Security groups only see ports, not web content | AWS managed core and SQL injection rule sets; rate limit on `/login` set high enough for the campus network, where many students share one public address | CloudFront |
| AWS Shield Standard | Protection from network floods (DDoS) | Free and automatic. Shield Advanced costs about $3,000 a month, too much for this load | On by default for CloudFront and Route 53 | WAF, CloudFront |
| Amazon CloudFront | Content delivery network and single HTTPS entry point | Caches the website close to users and takes the start-of-exam load off the servers. A load balancer alone cannot cache | Website from S3 through origin access control (OAC); `/api/*` forwarded to the ALB with no caching; HTTPS only, TLS 1.2 or newer | Route 53, WAF, S3 (web), ALB, ACM |
| AWS Certificate Manager (ACM) | HTTPS certificates | Free and renews itself. Bought certificates must be renewed by hand | Certificate in `us-east-1` for CloudFront; certificate in the app Region for the ALB | CloudFront, ALB |
| Amazon S3 (web app bucket) | Holds the website files | No servers, almost no cost, and old versions can be restored. Cheaper than hosting on EC2 or Fargate | Private bucket; Block Public Access on; versioning on; readable only by CloudFront | CloudFront, CodeBuild |

## Network

| Service | Role | Why over an alternative | Key settings | Connects to |
|---|---|---|---|---|
| Amazon VPC | The private network for the platform | Needed to keep databases and servers off the public internet. The default VPC has only public subnets | `10.0.0.0/16`; 6 subnets in 2 zones: public `10.0.0.0/24`, `10.0.1.0/24`; app `10.0.10.0/24`, `10.0.11.0/24`; data `10.0.20.0/24`, `10.0.21.0/24` | All in-VPC services |
| Internet gateway | Front door of the VPC for the load balancer | The only way public traffic can reach the public subnets | Attached to the VPC; public route table sends `0.0.0.0/0` to it | Public subnets, ALB |
| NAT gateway (×2) | Lets private servers reach the internet (for example for updates) without being reachable from it | One per zone, so losing a zone does not cut off the other. A single NAT would be a single point of failure | One in each public subnet; each private route table points to the NAT in its own zone | Private subnets, internet gateway |
| Route tables | Decide where traffic goes | Separate tables keep each zone independent | Public table → internet gateway; private-a → NAT A; private-b → NAT B | Subnets, gateways, endpoints |
| Gateway endpoints (S3 and DynamoDB) | Private path from the VPC to S3 and DynamoDB | Free, faster and safer than going through NAT, and cuts NAT data charges | Added to both private route tables | Fargate, Lambda, S3, DynamoDB |
| Security groups | Firewalls around each layer | Stateful and tied to roles, not IP addresses, so they keep working as tasks start and stop | `alb-sg`: 443 from CloudFront. `app-sg`: 8080 from `alb-sg` only. `lambda-sg`: outbound only. `proxy-sg`: 5432 from `lambda-sg`. `data-sg`: 5432 from `app-sg` and `proxy-sg`, 6379 from `app-sg` | Every in-VPC service |

## Compute

| Service | Role | Why over an alternative | Key settings | Connects to |
|---|---|---|---|---|
| Application Load Balancer (ALB) | Shares API requests across healthy servers in both zones | Understands web requests (paths, health checks) and works directly with ECS. Cheaper than API Gateway at steady exam-time load | In both public subnets; HTTPS listener; health check `/health`; 30-second deregistration delay | CloudFront, ECS Fargate |
| Amazon ECS on AWS Fargate | Runs the exam API in containers | No servers to patch, and it scales one task at a time. Better than Lambda for the API because it keeps database connections open and has no "cold start" when 3,000 students arrive at once | Service `exam-api`; 0.5 vCPU, 1 GB per task; minimum 4 (2 per zone), maximum 20; scheduled scale-out before exams; target tracking at 50% CPU; tasks spread across zones | ALB, Aurora, DynamoDB, Redis, Cognito, EventBridge, Secrets Manager |
| AWS Lambda (`marking-fn`, `notify-fn`) | Background workers: mark MCQs, check uploads, send emails | Runs only when there is work and scales with the queue. Cheaper than an always-on worker server | Run in the private app subnets; reserved concurrency of 50 so they cannot overload the database; each has its own IAM role | SQS, RDS Proxy, SES, S3 |
| Amazon ECR | Stores the API container images | Private and checked by IAM, with image scanning. Docker Hub is public and rate-limited | Scan on push; tags cannot be overwritten; keeps the last 10 images | CodeBuild, ECS |

## Sign-in

| Service | Role | Why over an alternative | Key settings | Connects to |
|---|---|---|---|---|
| Amazon Cognito | Sign-in and roles | Managed passwords, MFA and university single sign-on (SAML). Much safer than building login yourself | User pool; groups Student, Tutor and Admin; the group is carried in the sign-in token; MFA required for staff | Web app, API |

## Data

| Service | Role | Why over an alternative | Key settings | Connects to |
|---|---|---|---|---|
| Amazon Aurora PostgreSQL | Main records: users, exams, questions, submissions, results | Switches to its standby in about 30–60 seconds and keeps 6 copies across 3 zones. Better than standard RDS Multi-AZ, which is slower to fail over. Relational, which suits linked data like exams, students and results better than DynamoDB | Writer in Zone A, standby/reader in Zone B; KMS encryption; 35-day point-in-time restore; deletion protection; private data subnets only | Fargate, RDS Proxy, Secrets Manager, KMS, AWS Backup |
| Amazon RDS Proxy | Shares database connections between Lambda runs | Stops a burst of Lambda runs from using up all of Aurora's connections | Reads the password from Secrets Manager; TLS required; `proxy-sg` | Lambda, Aurora, Secrets Manager |
| Amazon DynamoDB | Stores the answers autosaved every 30 seconds | Very fast writes that scale automatically. Keeps 100 writes per second away from Aurora | Table `AnswerDrafts` (key: attempt ID + question ID); on-demand capacity; point-in-time restore on; KMS encryption | Fargate (through the gateway endpoint), AWS Backup |
| Amazon ElastiCache (Redis) | Keeps exam papers in memory | Stops 3,000 students from reading the same paper from the database at once | Multi-AZ with automatic failover; one primary and one replica; encrypted in transit and at rest | Fargate |
| Amazon S3 (assignment bucket) | Stores uploaded assignments | Cheaper and more durable than EBS disks. Presigned links keep 50 MB uploads off the API | Block Public Access on; SSE-KMS encryption; versioning on; presigned PUT links (15 minutes, ≤ 50 MB, PDF or ZIP only); CORS for the website only; lifecycle rule below | Browser, EventBridge, Lambda, IAM, KMS |
| S3 Glacier (lifecycle) | Cheap long-term storage for old files | Costs a fraction of standard storage for files that are rarely opened but must be kept 5 years | Lifecycle: Standard-IA after 30 days → Glacier Flexible Retrieval after 365 days → deleted after 1,825 days (5 years); unfinished uploads removed after 7 days | S3 assignment bucket |

## Background processing

| Service | Role | Why over an alternative | Key settings | Connects to |
|---|---|---|---|---|
| Amazon EventBridge | Routes events ("file uploaded", "exam submitted", "results released") | Filters events and can send one event to several targets. A direct S3 → Lambda trigger cannot | Rules match on event type and send to the right queue | S3, Fargate API, SQS |
| Amazon SQS (submissions queue and marking queue) | Holds background jobs until a worker is free | Absorbs the wave at the end of an exam and retries failed jobs for free. Without it, slow jobs would make students wait | Standard queues; encrypted; visibility timeout 180 seconds; redrive to the dead-letter queue after 5 failures | EventBridge, Lambda |
| SQS dead-letter queue | Keeps jobs that failed 5 times | Nothing is lost silently; failed jobs can be inspected and replayed | 14-day retention; CloudWatch alarm when it holds any message | SQS queues, CloudWatch |
| Amazon SES | Sends result and notification emails | Supports templates, signed emails (DKIM) and bounce handling. SNS email is plain and unbranded | Verified university domain; production sending access; configuration set for bounces | Lambda |

## Security

| Service | Role | Why over an alternative | Key settings | Connects to |
|---|---|---|---|---|
| AWS IAM | Permissions for every part | Roles give short-lived credentials, with no long-lived keys to leak | Separate roles: `ExamApiTaskRole`, `MarkingFnRole`, `SubmissionNotifyFnRole`, `RdsProxyRole`, `CodeBuildRole`, `CodePipelineRole`; each allows only the actions it needs | All services |
| AWS Secrets Manager | Stores database passwords | Changes Aurora passwords automatically. Parameter Store cannot | Rotation every 30 days; readable only by the API, Lambda and RDS Proxy roles | Fargate, Lambda, RDS Proxy |
| AWS KMS | Encryption keys | Customer-managed keys can be locked down and every use is logged. AWS-owned keys give no such control | Separate keys for databases and for files; yearly automatic rotation | S3, Aurora, DynamoDB, SQS, AWS Backup |
| Amazon GuardDuty | Detects threats such as stolen credentials or unusual traffic | Managed, with nothing to install | Enabled for the account; findings → EventBridge → SNS | CloudTrail, VPC flow logs, SNS |

## Monitoring and backup

| Service | Role | Why over an alternative | Key settings | Connects to |
|---|---|---|---|---|
| Amazon CloudWatch | Logs, metrics, alarms and dashboards | Built in to every AWS service; no separate monitoring system to run | Container Insights; 90-day log retention; alarms on 5xx errors, slow responses (p95), queue age and dead-letter queue > 0 | All services, SNS |
| AWS X-Ray | Traces each request through the system | Shows exactly which step is slow during the peak. Logs alone cannot | Tracing on in the API and the Lambda functions | Fargate, Lambda |
| Amazon SNS | Sends alerts to the operations team | One alarm can go to email, SMS and chat at once | Topic `ops-alerts`, subscribed by the on-call team | CloudWatch, GuardDuty |
| AWS CloudTrail | Records every change made in the AWS account | Needed for audits and investigations | Trail in all Regions, saved to a locked S3 bucket for 5 years | S3, KMS |
| AWS Backup | Central backups | One policy enforces the 5-year retention rule. Separate snapshots cannot | Daily backup plan for Aurora and DynamoDB; kept 5 years; Vault Lock on; copy to a second Region | Aurora, DynamoDB, KMS |

## CI/CD and infrastructure as code

| Service | Role | Why over an alternative | Key settings | Connects to |
|---|---|---|---|---|
| GitHub | Holds the code | Where the team already works; a push to `main` starts the pipeline | Branch protection on `main`; linked through AWS CodeConnections | CodePipeline |
| AWS CodePipeline | Runs the release steps in order | Native to AWS and uses IAM roles, so no access keys are stored in GitHub | Stages: Source → Build → Deploy infrastructure → Deploy app | GitHub, CodeBuild, CloudFormation, ECS |
| AWS CodeBuild | Runs tests and builds the container image and website | Pay per minute, with no build server to maintain | Runs unit tests; builds and pushes the image to ECR; uploads the website to S3 and refreshes CloudFront | CodePipeline, ECR, S3 |
| AWS CloudFormation | Creates all infrastructure from templates | Native to AWS, previews changes before applying them and rolls back on failure. The whole platform can be rebuilt from code | Stacks: network, data, app, edge, monitoring, pipeline; databases keep a snapshot when deleted | All services |
