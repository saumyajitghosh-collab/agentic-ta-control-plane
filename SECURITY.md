# Security

## Reporting a vulnerability

Please open a private security advisory through GitHub (**Security → Advisories → Report a vulnerability**) rather than a public issue. This is a demonstration project with no production deployment, but reports are welcome and will be acknowledged.

## What this project is

A static, client-side demonstration. It has **no backend, no database and no user accounts**. All data is synthetic and generated in the browser from a fixed seed. Nothing is transmitted anywhere except, optionally, to the Anthropic API (see below).

## The optional Claude reasoner and your API key

The Settings screen lets you paste an Anthropic API key so the Ops workstation can ask Claude to write a proposal rationale.

- The key is held **only in the current browser tab's memory**. It is not written to `localStorage`, cookies or any server.
- It is sent **only** to `https://api.anthropic.com`, using the browser-direct header Anthropic requires for client-side calls.
- Because the call is made from the browser, the key is present in that page's context. Treat it like any other credential: use a scoped, disposable key, avoid shared or public machines, and revoke it afterwards. For anything beyond a demo, proxy model calls through a server so the key never reaches the client.
- With no key set, every agent runs on deterministic reasoning and the whole product still works. The Story always runs deterministically.

## Payments

The site takes no card data and holds no payment secrets. There is no backend.

- **UPI.** The pricing page shows a UPI ID and a `upi://pay` deep link. The ID is public by design.
- **Razorpay.** The static site only links to a Razorpay Payment Link/Page. The full checkout that verifies signatures lives in `server/razorpay-verify.js`, which reads `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` from the environment. No key or secret is ever committed; if one appears in this repo, rotate it and remove it from history.
- **The entitlement gate is client-side** (`src/app/entitlements.js`) and can be bypassed. It is a free/paid signal and a deterrent, not access control. Do not treat it as one.

## Admin access

There is one admin account (the owner). `src/app/auth.js` stores only a salt and a salted,
iterated SHA-256 digest of the password — never the password itself. Sign in at `login.html`;
the session unlocks every Operator feature permanently.

This is a client-side gate on a static site. The digest is public, so the gate can be bypassed
by anyone who sets the session key directly, and the digest could be brute-forced offline.
What it does buy: the password is not in the repository and not on the page, and a strong
password is impractical to reverse. Treat it as obfuscation, not access control. A
server-verified login is the real fix.

## Controls the project demonstrates

The security story of the product is its own subject matter: untrusted content (documents, emails, distributor files) can supply **facts** but never **authority**. Any action implied by text inside such content is proposed with `origin: UNTRUSTED_CONTENT` and refused by rule `R-UNTRUSTED-ORIGIN`, regardless of what a detector noticed. See [`docs/CONTROLS.md`](docs/CONTROLS.md) and the Trust boundary screen.

## Scope

Out of scope: the synthetic data, the illustrative regulatory mappings (design aids, not legal advice), and the ISO 20022 messages (structural and semantic checks only; not validated against the official XSDs).
