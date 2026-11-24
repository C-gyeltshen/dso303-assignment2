# Glossary


| Term | Meaning |
|---|---|
| **Region** | A geographic area where AWS has data centres, for example `ap-south-1` (Mumbai) |
| **Availability Zone (AZ)** | One or more separate data centres inside a Region, with their own power and network. Running in two AZs means one can fail without taking the system down |
| **VPC** | Virtual Private Cloud: your own private network inside AWS |
| **Subnet** | A smaller slice of the VPC that sits in one AZ |
| **Public subnet** | A subnet that can be reached from the internet (here, only the load balancer and NAT gateways live there) |
| **Private subnet** | A subnet with no direct internet access (servers and databases live there) |
| **CIDR** (e.g. `10.0.0.0/16`) | A way of writing a range of IP addresses |
| **NAT gateway** | Lets private servers go *out* to the internet without anyone coming *in* |
| **Gateway endpoint** | A private path from the VPC to S3 or DynamoDB that never touches the internet |
| **Security group** | A firewall around a resource that says who may connect to it, and on which port |
| **Load balancer** | Spreads requests across several servers and skips any that are unhealthy |
| **Container / Fargate task** | A packaged copy of the application. Fargate runs it without you managing servers |
| **Lambda function** | Code that runs only when something triggers it, and is billed per run |
| **CDN (CloudFront)** | A network of servers around the world that keeps copies of the website close to users |
| **WAF** | Web Application Firewall: blocks harmful web requests |
| **DNS (Route 53)** | The internet's address book: turns names into addresses |
| **Presigned URL** | A short-lived link that lets a browser upload one file directly to S3 |
| **Queue (SQS)** | A waiting line for jobs, so they are done reliably in the background |
| **Dead-letter queue** | Where jobs go after failing several times, so they can be checked later |
| **Event (EventBridge)** | A message saying "something happened", for example "file uploaded" |
| **Cache (ElastiCache Redis)** | Fast memory storage for data that is read often |
| **Multi-AZ / failover** | A standby copy in another AZ that takes over automatically if the main one fails |
| **RDS Proxy** | Shares a small number of database connections among many users |
| **Encryption in transit** | Data is scrambled while it travels (HTTPS / TLS) |
| **Encryption at rest** | Data is scrambled while it is stored (KMS keys) |
| **KMS** | Key Management Service: creates and guards encryption keys |
| **IAM role** | A set of permissions that a service uses, instead of a password |
| **RPO** (Recovery Point Objective) | The most data you can afford to lose, measured in time. Here: 5 minutes |
| **RTO** (Recovery Time Objective) | The longest the system may be down. Here: 1 hour |
| **Point-in-time restore** | Rolling a database back to any second within a set number of days |
| **Lifecycle rule** | An automatic rule that moves old files to cheaper storage and deletes them later |
| **Auto scaling** | Adding or removing servers automatically as load changes |
| **Scheduled scaling** | Adding servers at a set time, for example 30 minutes before an exam |
| **CI/CD** | Continuous Integration / Continuous Deployment: tests and releases code automatically on every push |
| **Infrastructure as code (IaC)** | Describing servers and networks in template files, so they are built the same way every time |
| **HTTP 200 / 202 / 503** | Web response codes: 200 = OK, 202 = accepted for background work, 503 = service unavailable |
