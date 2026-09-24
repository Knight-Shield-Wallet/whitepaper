# KSDLabs Public Website V1

Temporary staging copy only.

Canonical target architecture:

GitHub public source repo -> KSD Static Deploy -> Cloudflare Pages -> ksdlabs.com

Target public repo: `Knight-Shield-Wallet/ksdlabs-site`.

This staging package contains no secrets and no private runtime dependencies. Do not treat this directory as the permanent canonical source after the public repo is created.

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
