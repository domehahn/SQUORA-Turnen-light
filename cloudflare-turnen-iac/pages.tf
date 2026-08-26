resource "cloudflare_pages_project" "web" {
  account_id        = var.cloudflare_account_id
  name              = local.pages_project_name
  production_branch = var.pages_production_branch

  build_config = {
    build_caching   = true
    build_command   = var.pages_build_command
    destination_dir = var.pages_output_directory
    root_dir        = "/"
  }
}

resource "cloudflare_pages_domain" "web" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.web.name
  name         = local.app_hostname
}

resource "cloudflare_dns_record" "web" {
  zone_id = var.cloudflare_zone_id
  name    = local.app_hostname
  type    = "CNAME"
  content = "${cloudflare_pages_project.web.name}.pages.dev"
  proxied = true
  ttl     = 1

  comment = "Managed by Terraform: Turnen app frontend"

  depends_on = [cloudflare_pages_domain.web]
}
