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

## Controls the project demonstrates

The security story of the product is its own subject matter: untrusted content (documents, emails, distributor files) can supply **facts** but never **authority**. Any action implied by text inside such content is proposed with `origin: UNTRUSTED_CONTENT` and refused by rule `R-UNTRUSTED-ORIGIN`, regardless of what a detector noticed. See [`docs/CONTROLS.md`](docs/CONTROLS.md) and the Trust boundary screen.

## Scope

Out of scope: the synthetic data, the illustrative regulatory mappings (design aids, not legal advice), and the ISO 20022 messages (structural and semantic checks only; not validated against the official XSDs).
