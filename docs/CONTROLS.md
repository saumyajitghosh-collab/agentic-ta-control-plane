# Controls

## Policy rules (evaluated in this order)

| Rule | Effect | What it does |
| --- | --- | --- |
| R-KNOWN-CAPABILITY | Deny | Only capabilities in the catalogue can be proposed. |
| R-ENTITLEMENT | Deny | The agent must be registered and entitled to the capability. |
| R-KILL-SWITCH | Deny | A frozen domain refuses every action in its processes. |
| R-UNTRUSTED-ORIGIN | Deny | Actions implied by instructions inside documents are refused. |
| R-NO-BACKDATING | Deny | A dealing date earlier than the earliest permitted date is refused. |
| R-CEILING | Cap | Autonomy = min(risk-class ceiling, process dial, agent maximum). |
| R-CONFORMAL | Escalate | Unless the prediction set holds exactly one candidate, a person decides. |
| R-DATA-AUTHORITY | Escalate | Non-authoritative data or open reconciliation breaks send the case to a person. |
| R-MAKER-CHECKER | Cap | Capabilities such as bank-detail changes always need an independent checker. |
| R-R4-HUMAN | Cap | Regulatory and fiduciary determinations are always decided by a person. |

## Invariants enforced by tests

`tests/core.test.js` fuzzes 20,000 random proposals (random agent, capability, process, dial settings, kill switches, confidence, data authority, origin and backdating) and asserts:

1. Unentitled or unknown agents are always refused.
2. Untrusted-origin proposals are always refused.
3. Proposals in a frozen domain are always refused.
4. Backdated dealing dates are always refused.
5. Autonomy never exceeds the risk ceiling, the process dial or the agent maximum.
6. R4 capabilities never go above L1.
7. A prediction set other than size one never goes above L1.
8. Open data breaks never go above L1.
9. Maker-checker capabilities never auto-execute.
10. A weaker confidence result never yields more autonomy than a single-candidate set.

Other tests cover tamper detection and replay, role checks on human decisions and governance changes, evidenced kill switches, message validation (a well-formed message with a wrong ISIN must fail), the seven-step story, the T+1 gap and the injection suite.

## Human decisions

| Verdict | Who decides |
| --- | --- |
| R1 at L1 | Operations |
| R2 or R3 at L2 | Operations |
| ACCEPT_INVESTOR_KYC (R4) | Compliance |
| APPLY_REDEMPTION_GATE (R4) | Fund board / ManCo |
| Autonomy dials, α | Compliance |
| Kill switches | Operations or Compliance |

Every decision and governance change is recorded as an evidence envelope.

## Shadow-to-autonomy promotion

A process can move up one level when, over the shadow period: at least 300 cases, at least 95% same resolution as people, at most 1% material disagreement and at most 2% false escalation, and the process is below the highest level any capability in its domain allows. Agreement below 85% flags the process for review. Promotion is a Compliance action and is evidenced; risk ceilings still apply afterwards.

## Regulatory mapping (illustrative)

| Framework | Expectation | Where |
| --- | --- | --- |
| Singapore agentic AI framework (Jan 2026) | Bound powers upfront; human checkpoints; control tool and data access; keep users informed | Risk classes and dials; L1/L2 verdicts; entitlements and data authority; evidence |
| EU AI Act | Logging, human oversight, traceability | Evidence ledger, replay, kill switches |
| DORA | ICT resilience; exit | Deterministic operation without a model; policy pack and ledger export |
| SEBI circular SEBI/HO/IMD/DF5/CIR/P/2019/63 (9 May 2019) | Quarterly reporting of AI/ML applications | Draft register generated from agent identities |

These mappings are design aids, not legal advice.
