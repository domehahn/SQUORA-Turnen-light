locals {
  name_prefix  = "${var.project_name}-${var.environment}"
  app_hostname = "${var.app_subdomain}.${var.domain}"
  api_hostname = "${var.api_subdomain}.${var.domain}"

  pages_project_name = "${local.name_prefix}-web"
  worker_name        = "${local.name_prefix}-api"
  d1_name            = "${local.name_prefix}-db"
  export_bucket_name = "${local.name_prefix}-exports"
}
