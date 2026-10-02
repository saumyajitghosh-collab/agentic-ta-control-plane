# Architecture

The product is organised as five planes plus two cross-cutting bands. This edition runs all of them in the browser so the control model can be inspected end to end; the module boundaries are the ones a server edition would keep.

## Planes

**Experience.** Role-aware views over the same cases and evidence: the Story, Ops workstation, Federated register, Liquidity and gates, Oversight and Compliance map (`src/app/app.js`). The selected role (Operations, Compliance, Fund board / ManCo, Distribution, Auditor) determines which decisions and governance changes a user may make.

**Reasoning.** Four domain agents (`src/core/agents.js`), each a principal with an identity, a version, a maximum autonomy level and an explicit list of capabilities it may propose:

| Agent | Domain | Max | Typical work |
| --- | --- | --- | --- |
| `AGENT:LIFECYCLE:V2` | Investor lifecycle | L4 | Onboarding packs, KYC recommendations, account maintenance, transfers, queries |
| `AGENT:DEALING_NIGO:V3` | Dealing | L3 | Order validation, NIGO repair, cut-off handling, status messages |
| `AGENT:OPS_LIQUIDITY:V1` | Operations and liquidity | L2 | T+1 funding plans, semi-liquid gate calculations |
| `AGENT:OVERSIGHT:V1` | Oversight and intelligence | L2 | Provider findings, token-register reconciliation |

An agent receives a bounded **case graph** (investor, account, fund, share class, order, distributor, TA, exceptions), never an open prompt. It returns candidate actions with probabilities, a rationale, the facts it used and their source lineage.

**Control.** `src/core/control.js` holds three things:

1. **Calibrated confidence.** Split conformal prediction: nonconformity score `1 − p`, quantile `q̂` at level `ceil((n+1)(1−α))/n` over each process's calibration scores; the prediction set is every candidate with `1 − p ≤ q̂`.
2. **The policy function** `evaluate(proposal, ctx)`: a pure function of the proposal, the policy pack, the controls snapshot (dials, kill switches, α) and the agent registry. It returns a verdict (`AUTO_EXECUTE`, `REQUIRE_APPROVAL`, `RECOMMEND_ONLY`, `OBSERVE_ONLY`, `DENY`), the autonomy level, deciding roles and every rule's result.
3. **The evidence ledger**: append-only, each entry's SHA-256 hash covering its canonical JSON plus the previous hash. `verify()` walks the chain; `replay(entry)` re-runs `evaluate` on the stored proposal and snapshots and compares outcomes.

**Execution.** `src/core/engine.js` owns the workflow: `propose → gate → (execute | wait for a person)`. Only the capability executors change state, and they take typed parameters. ISO 20022 messages are produced by deterministic builders in `src/core/messages.js` and checked structurally (required paths) and semantically (ISIN check digits, positive amounts, valid status codes, matching references). The model never writes a message.

**Data.** `src/core/data.js` generates a seeded world: three TAs (Luxembourg, UK, India), four funds including a semi-liquid fund with a 5% quarterly gate and a tokenized share class, distributors, investors with valid-format LEIs, and holdings reported by several sources. Each holding carries field-level provenance: source, record reference, effective and received times, reconciliation state, quality and whether the source is authoritative.

## Cross-cutting bands

**Evidence.** Five envelope kinds: `DECISION`, `HUMAN_DECISION`, `EXECUTION`, `GOVERNANCE_CHANGE`, plus alternatives evaluated (for example the backdating option in the story) recorded as `DECISION` entries with a note. A decision envelope stores agent and reasoner versions, prompt version, policy pack version, an input snapshot hash, source lineage, risk class, confidence, the controls snapshot and the full gate result.

**Identity.** Agents and people are both principals. Agents have entitlements and autonomy ceilings; people have roles that determine who may approve which risk class, change autonomy (Compliance) or use kill switches (Operations, Compliance).

## Trust boundary

Untrusted content (documents, emails, distributor files) can supply facts that pass schema extraction. Any action implied by text inside such content is proposed with `origin: UNTRUSTED_CONTENT`, and rule `R-UNTRUSTED-ORIGIN` refuses it regardless of what the detector noticed. Detection exists for visibility; the gate is the control.

## What a server edition changes

- Split the reasoning and execution planes into separate services; only the executor holds write credentials to provider systems.
- Persist cases and evidence (Postgres with an append-only evidence table and periodic anchoring of the chain head).
- Replace synthetic data with provider adapters (files, APIs, ISO 20022) and add XSD validation.
- Serve the policy pack as a signed, versioned artefact with its own approval workflow.
- Use OIDC for people and workload identities for agents.
