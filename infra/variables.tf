variable "project" {
  description = "Name prefix for all resources"
  type        = string
  default     = "exam-platform"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "single_nat_gateway" {
  description = "true = one NAT gateway (cheap demo). false = one per AZ (production, survives AZ loss)."
  type        = bool
  default     = false
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro" # use db.t4g.medium or larger in production
}

variable "db_multi_az" {
  type    = bool
  default = true
}

variable "deletion_protection" {
  description = "Protect the database from deletion. Set false for a demo you will tear down."
  type        = bool
  default     = false
}

variable "api_reserved_concurrency" {
  description = "Reserved concurrency for the API Lambda (-1 = unreserved). Production: 300. New AWS accounts often have a 10-concurrency quota, so keep -1 there."
  type        = number
  default     = -1
}

variable "worker_reserved_concurrency" {
  description = "Reserved concurrency for marker/notifier (-1 = unreserved)"
  type        = number
  default     = -1
}

variable "alarm_email" {
  description = "Email that receives CloudWatch alarms"
  type        = string
}

variable "ses_sender_email" {
  description = "Verified SES sender address (e.g. exams-noreply@uni.edu). In the SES sandbox recipients must be verified too."
  type        = string
}

variable "ses_verify_emails" {
  description = "Extra addresses to verify in the SES sandbox (tutor/student test accounts)"
  type        = list(string)
  default     = []
}

variable "domain_name" {
  description = "Optional custom domain (e.g. exams.example.edu) with a Route 53 hosted zone. Empty = use the CloudFront domain."
  type        = string
  default     = ""
}

variable "hosted_zone_name" {
  description = "Route 53 hosted zone that contains domain_name (e.g. example.edu)"
  type        = string
  default     = ""
}

variable "waf_rate_limit" {
  description = "Requests per 5 minutes per IP before WAF blocks"
  type        = number
  default     = 10000
}

variable "enable_cloudtrail" {
  description = "Create a dedicated CloudTrail trail (disable if your account/organisation already has one)"
  type        = bool
  default     = true
}
