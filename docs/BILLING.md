# Billing and licensing

The demo is free to explore. Running it — agents on your own cases, governance changes,
exports, bring-your-own-model — is the **Operator** tier. This document is honest about
how that is enforced today and what it takes to enforce it properly.

## The tiers

| | Free | Operator |
| --- | --- | --- |
| Story (7 steps), Ops workstation, federated register, liquidity & gates | yes | yes |
| Trust boundary + injection suite, evidence & replay, oversight, compliance map | yes | yes |
| Policy sandbox (dry-run proposals) | yes | yes |
| Run agents on the operational queue and decide real cases | — | yes |
| Autonomy dials, kill switches, confidence α | — | yes |
| Shadow-mode promotion | — | yes |
| Exports: policy pack, evidence ledger, oversight pack, AI/ML register | — | yes |
| Bring your own model (Claude) | — | yes |

The first **30 days of Operator are free**, tied to the device, not the account — a new
account on the same device does not restart the clock. After that the free tier stays open.

Prices: **₹2,999 / month** or **₹29,999 / year**. Configure in `src/app/entitlements.js`.

## How the gate works today, and its limits

`src/app/entitlements.js` runs in the browser. It tracks the device trial and the plan in
`localStorage`, and `src/app/app.js` refuses the premium actions when the tier is not active.

**This is a deterrent, not a security boundary.** Anyone can read the source, edit
`localStorage`, or call the unlock. It does two useful things — it makes the free/paid
line explicit, and it filters casual users — and it cannot stop a determined one. Payment
also cannot be *verified* client-side: the "I have paid" button is an honour-system step,
provisional until checked against the payment account.

If you need it enforced, use Path 2 below.

## Payments

### India — UPI

Pay to the UPI ID in `PAY.upi` (any UPI app). The pricing page shows the ID with a
`upi://pay` deep link and an amount. The buyer enters the UTR to activate. This is the
same flow the asset-servicing project uses.

### Everywhere else — Razorpay

**UPI does not work outside India.** Foreign buyers have no UPI app and no Indian bank
account, so a UPI-only page simply excludes them. Razorpay takes **UPI and international
cards in one checkout**, which is why it is the right single front door.

**Path 1 — Razorpay Payment Link / Payment Page (no backend, works today).**
Create a Payment Link in the Razorpay dashboard for each plan, then paste the URLs into
`PAY.razorpayMonthly` / `PAY.razorpayYearly` in `src/app/entitlements.js`. The pricing page
renders a pay button. The buyer returns and enters their Razorpay payment ID to activate.
No server, no keys in the repo.

**Path 2 — full checkout + signature verification (enforced).**
Use `server/razorpay-verify.js` — a reference Cloudflare Worker (or Vercel/Netlify
function) that creates orders and verifies the checkout signature, which requires your
key secret and therefore cannot live in the browser. Deploy it, set `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` as secrets, and point the client at it.

> Keys are **never** committed. The worker reads them from the environment. If you ever
> paste a key into a file in this repo, treat it as compromised and rotate it.

**Still missing for a true paywall, even with Path 2:** persistence of *who paid for what
until when*, and a signed entitlement token the client presents on return visits. Without
those, verification is correct but nothing remembers it — the client would have to be
re-activated each time. Reasonable options: a Cloudflare D1/KV table plus a short signed
JWT, or a licensing service (Keygen, Lemon Squeezy license keys) that issues and validates
keys for you.

### Taxes

Cross-border digital sales raise VAT/GST questions that differ by country. Razorpay handles
Indian GST if configured; for a global audience a **merchant of record** (Paddle, Lemon
Squeezy) collects and remits overseas tax on your behalf, at a higher fee. This is not tax
advice — check the treatment of exported digital services before taking real money.

## What is not in the repo

- No API keys, no key secrets, no card data. Payment details never touch this site.
- The UPI ID is public (it is on a public page). That is a deliberate choice; if you would
  rather not expose it, move collection to Razorpay only.
- Activation is local to the device until Path 2 plus persistence is in place.
