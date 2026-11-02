# Customer benefits website update — 2026-11-02

**Status:** SOURCE UPDATED · CI ROUTE AND BROWSER RENDER CHECKS PASSED · DRAFT · NOT DEPLOYED

**PR:** https://github.com/Knight-Shield-Wallet/whitepaper/pull/13  
**Reviewed source head:** `adc32dbc25d555a52fedf2b5dfadbce33c96fdbd`  
**QA run:** 41540144318 — KSD Labs V2 Release Candidate QA — success  
**Render artifact:** `ksdlabs-v2-render-proof-adc32dbc25d555a52fedf2b5dfadbce33c96fdbd` (artifact 13185164874)

## Changes

- Added `/the-rest-of-us/` to the QA source-page contract and HTTP route smoke test. Added sitemap and deployment-manifest assertions for the route. Preserved the page and existing internal links.
- Added Habitat-style pastel product cards with thick black outlines and rounded corners for Secretary, CafAI, Dispatch, Orbit and Wallet. Midnight Lens retains its original premium styling.
- Kept native expandable product explanations, with disclosure affordances styled for visibility.
- Moved the CafAI → Dispatch → Orbit fictional walkthrough directly below the CafAI introduction, added a direct CTA, and styled its task/evidence controls for phone and desktop layouts.
- Preserved the explicit in-development wallet status, cookie explanation, community article, and disabled signup until its backend is verified.

## Verification

GitHub Actions run 41540144318 passed all steps on the reviewed candidate, including:

- Static source contract checks.
- HTTP 200 for all 14 public routes, including `/the-rest-of-us/`.
- Signup remains fail-closed while the backend is unverified.
- Headless Chrome phone and desktop renders for the homepage, catalogue, products, CafAI walkthrough, community page, workspace and privacy page.
- SHA-256 manifest for retained screenshots.

The screenshots were visually inspected. They show the colored product cards on desktop and phone layouts, the full catalogue, the CafAI walkthrough controls and the community page. The walkthrough is illustrative: its data is fictional and it calls no providers or execution services. The previous local logic harness recorded four passing cases (website/application tasks, complete/missing evidence); no change was made to that logic in this update.

## Not established

No real CafAI, Dispatch or Orbit operation; independent Orbit verification; five-real-run qualification; wallet launch/access facts; or verified public contact channel is established here. The PR remains a draft. No merge, public deployment, DNS, signup activation or wallet launch announcement occurred. Required release approval remains outstanding before publication.
