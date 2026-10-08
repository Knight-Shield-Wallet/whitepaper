# KSD Labs public website — deployment

Owner record: `Knight-Shield-Wallet/ksd-pentagon-runtime#677`. This file describes the
release path as it actually runs. It is not a release receipt; every claim of a live or
qualified state needs its own retained run, deployment and readback evidence.

## Release source

| Item | Value |
|---|---|
| Repository | `Knight-Shield-Wallet/whitepaper` (public) |
| Release branch | `deploy/ksdlabs-public-v1` (the only branch that publishes) |
| Publish workflow | `.github/workflows/ksdlabs-pages.yml` |
| QA workflow | `.github/workflows/ksdlabs-v2-qa.yml` (pull requests into the release branch) |
| Build step | none — the repository root is the static site |
| Canonical domain | `ksdlabs.com` (apex), `www.ksdlabs.com` redirects to it once routed |

`main` and other branches do not deploy. Changes reach the release branch through a
bounded pull request so the QA workflow runs against the exact head first.

## Publish workflow

- Triggers: `push` to `deploy/ksdlabs-public-v1`, or `workflow_dispatch`. The job is guarded
  by `if: github.ref == 'refs/heads/deploy/ksdlabs-public-v1'`, so a dispatch from another
  ref is skipped.
- Permissions: `contents: read`, `pages: write`, `id-token: write`.
- Environment: `github-pages`; concurrency group `ksdlabs-pages`, `cancel-in-progress: false`.
- Steps: `actions/checkout@v4` (the triggering commit) → presence check for `index.html`
  and `CNAME == ksdlabs.com` → `actions/configure-pages@v5` →
  `actions/upload-pages-artifact@v3` with `path: .` → `actions/deploy-pages@v4`.
- The uploaded artifact is the whole checkout root (pages, `assets/`,
  `deployment-manifest.json`, `CNAME`, `.nojekyll`, `robots.txt`, `sitemap.xml`).

Trace the deployed SHA from the run's `head_sha` and the deployment record, not from the
current branch head, which may have moved.

## GitHub Pages settings

Required: `build_type=workflow`, `cname=ksdlabs.com`, `https_enforced=true`.

With an Actions workflow, GitHub ignores the repository `CNAME` file for domain
registration. The file is kept for source continuity and the workflow check, but the
custom domain is bound only by the Pages setting:

```
gh api --method PUT repos/Knight-Shield-Wallet/whitepaper/pages -f cname=ksdlabs.com
```

The `source.branch` value returned by the Pages API is not the build source for an
Actions deployment.

## Domain routing

The site uses root-relative URLs (`/assets/...`, `/deployment-manifest.json`, `/privacy/`).
They are correct only at the domain root. At the project URL
`https://knight-shield-wallet.github.io/whitepaper/` the HTML loads but CSS, JavaScript and
navigation resolve against the organisation root and return 404. Do not rewrite URLs to
`/whitepaper/`; complete custom-domain routing instead.

Records GitHub documents for a Pages apex plus `www` (recheck the official page before any
change: <https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site>):

| Name | Type | Value |
|---|---|---|
| `@` | A | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` |
| `www` | CNAME | `knight-shield-wallet.github.io` (no repository path) |

GitHub also documents optional AAAA records (`2606:50c0:8000::153` … `8003::153`); adding
them is a separate decision. DNS changes are outside this repository's release path and
need their own scoped authority, a full zone export with record IDs/TTLs, and must leave
mail, TXT, unrelated records, nameservers, DNSSEC and registrar untouched.

## Signup

Signup forms (on `/`, `/catalogue/`, `/workspace/`, `/midnight-lens/`, `/dust-bowl-cafe/`,
`/partners/`) ship disabled in the HTML: every control has `disabled`, the form has
`aria-disabled="true"`, the button reads "Updates opening soon". The forms have no
`action`, so this markup is what prevents native GET submission when JavaScript or the
manifest fails to load.

`assets/site.js` enables the forms only when `deployment-manifest.json` loads and has
`customer_updates.live === true`, `customer_updates.backend_runtime_verified === true` and
`public_signup_api` equal to `https://api.ksdlabs.com/v1/subscriptions`. Both flags stay
`false` until the subscription backend has its own retained proof.

## Release checks

Before calling a candidate released:

1. QA workflow passes on the PR head; publish run succeeds on the merged SHA. Retain run
   ID, attempt, job, artifact ID/digest, deployment ID and status.
2. Every manifest page, both assets, the manifest, `robots.txt` and `sitemap.xml` served at
   `https://ksdlabs.com` byte-match the deployed SHA. HTTP 200 alone is not evidence — the
   parked domain also answers 200.
3. Valid TLS for apex and `www`; `http://` and `www` redirect to `https://ksdlabs.com`
   preserving the path.
4. A real browser renders styles and script with no failed resources, and all six signup
   forms are disabled with JavaScript off, `site.js` blocked, the manifest unavailable or
   malformed, and the flags false. No real email address is entered.

## Rollback

- Source: revert the offending commit on the release branch through a PR; the publish
  workflow redeploys it as a new run. Do not rewrite history or force-push.
- Pages domain: `gh api --method PUT repos/Knight-Shield-Wallet/whitepaper/pages -F cname=null`
  returns to project-URL publication. Leave `https_enforced` on.
- DNS: restore only the captured A/CNAME RRsets with their original TTLs from the zone
  export.

## Troubleshooting

- Every ksdlabs.com URL returns the same parking page: DNS still points at the parking
  host (apex `A 2.57.91.91`, `www CNAME ksdlabs.com` at the October 2026 inspection) and/or
  the Pages `cname` is unset. Fix routing; rebuilding does not help.
- Project URL shows unstyled pages and an enabled-looking form: expected root-relative
  asset 404s at the project path; check the custom-domain route instead.
- `Configure GitHub Pages` fails with `Resource not accessible by integration`: Pages must
  first be enabled with source "GitHub Actions" by a repository admin in Settings → Pages.
- Run fails before any step with no runner assigned: re-run once; investigate Actions
  availability/billing if it repeats.
