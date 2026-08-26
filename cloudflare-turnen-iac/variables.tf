variable "cloudflare_account_id" {
  description = "Cloudflare Account ID."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Existing Cloudflare Zone ID for the domain registered at STRATO."
  type        = string
}

variable "domain" {
  description = "Base domain, e.g. turnen.example.de."
  type        = string
}

variable "project_name" {
  description = "Short lowercase project identifier used in Cloudflare resource names."
  type        = string
  default     = "turnen"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "app_subdomain" {
  description = "Frontend subdomain."
  type        = string
  default     = "app"
}

variable "api_subdomain" {
  description = "API/Worker subdomain."
  type        = string
  default     = "api"
}

variable "pages_production_branch" {
  description = "Branch name used for Cloudflare Pages production deployments."
  type        = string
  default     = "main"
}

variable "pages_build_command" {
  description = "Frontend build command."
  type        = string
  default     = "npm run build"
}

variable "pages_output_directory" {
  description = "Frontend build output directory."
  type        = string
  default     = "dist"
}

variable "enable_export_bucket" {
  description = "Create a private EU R2 bucket for short-lived GDPR/user exports."
  type        = bool
  default     = true
}

variable "export_retention_seconds" {
  description = "Automatic deletion age for export objects. Default: 24 hours."
  type        = number
  default     = 86400

  validation {
    condition     = var.export_retention_seconds >= 3600
    error_message = "export_retention_seconds must be at least 3600 seconds."
  }
}
