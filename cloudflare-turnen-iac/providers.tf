provider "cloudflare" {
  # Authentication is intentionally taken from the environment:
  #   export CLOUDFLARE_API_TOKEN="..."
  #
  # Do NOT place API tokens in *.tfvars or commit them to Git.
}
