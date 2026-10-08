# KSDLabs Public Website V1

Public source for ksdlabs.com, published from the `deploy/ksdlabs-public-v1` branch by
`.github/workflows/ksdlabs-pages.yml` to GitHub Pages. See [DEPLOYMENT.md](DEPLOYMENT.md)
for the release path, Pages/domain settings, checks and rollback.

This package contains no secrets and no private runtime dependencies.

## Public-repo extraction rule

Copy only the contents of this directory into the root of the dedicated public repo.

Do not copy:
- parent repository history
- .github workflows from the private runtime
- Supabase/service credentials
- private Dispatch code
- deployment secrets
- internal governance documents

Expected public root:
- index.html
- assets/
- products/
- midnight-lens/
- dust-bowl-cafe/
- dispatch/
- catalogue/
- about/
- contact/
- robots.txt
- sitemap.xml
- deployment-manifest.json

The exact locked KSD/KSDLabs logo asset must be added later as an asset. Until then the site intentionally uses text branding rather than an approximation.

## Current public-site source

Mirrors KSD Labs source release candidate `198d9a78a19717368720cc4db35d49b91f9bd828` from `Knight-Shield-Wallet/ksd-pentagon-runtime`, including the KSD Workspace integration. Custom-domain publication is verified only by the release checks in DEPLOYMENT.md.
