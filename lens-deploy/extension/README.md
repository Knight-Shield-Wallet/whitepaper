# Midnight Lens — Real Buy & Sell browser filter

## What this build does

- Runs only on Facebook Marketplace pages the user is actively viewing.
- Inspects listing-card text and links already rendered in the page DOM.
- Hides likely commercial/dealer/store inventory when **Real Buy & Sell** is enabled.
- Applies seller-account-age filtering only when Facebook visibly exposes a `Joined Facebook in …` value.
- Keeps unavailable account age as **Unknown** unless the user enables strict age filtering.
- Can sync visible listing metadata into the user's Midnight Lens Marketplace session so the Lens web workspace can build evidence records.
- Routes optional Lens API sync through the extension background worker, so the Facebook page itself is not granted direct Lens API access.

## What this build does not do

- It does not crawl seller profiles.
- It does not request hidden Marketplace fields.
- It does not bypass Facebook access controls.
- It does not claim that a commercial/private classification proves seller identity or legitimacy.
- It does not turn a negative stolen-property search into “police clearance.”

## Firefox Android / desktop

This is a Manifest V3 WebExtension. The repository produces a QA ZIP plus SHA-256 checksum through GitHub Actions. Public browser distribution still requires the normal browser-store signing/review gate.

## Evidence route

Visible Marketplace card → local deterministic classification → hide/show decision → extension background sync → normalized Lens metadata → Midnight Lens Marketplace record → device-local Item Scan / Photo Guard → registry handoff → Lens Verify receipts.
