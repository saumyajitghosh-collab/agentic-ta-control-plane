/* Policy pack v1.3 — data, not code. The policy engine reads this; changing autonomy
 * or approvals is a governance change recorded in the evidence ledger. */
(function (g) {
  'use strict';
  const T = (g.TACP = g.TACP || {});

  T.POLICY_PACK = {
    id: 'tacp-policy-pack',
    version: '1.3.0',
    effective: '2026-10-01',

    autonomyLevels: [
      { level: 0, code: 'L0', name: 'Observe', verdict: 'OBSERVE_ONLY', meaning: 'Record what the agent would do; nothing happens.' },
      { level: 1, code: 'L1', name: 'Recommend', verdict: 'RECOMMEND_ONLY', meaning: 'A person decides; the agent recommends.' },
      { level: 2, code: 'L2', name: 'Act after approval', verdict: 'REQUIRE_APPROVAL', meaning: 'The agent acts once an entitled person approves.' },
      { level: 3, code: 'L3', name: 'Act and notify', verdict: 'AUTO_EXECUTE', meaning: 'The agent acts and notifies the owning team.' },
      { level: 4, code: 'L4', name: 'Act within bounds', verdict: 'AUTO_EXECUTE', meaning: 'The agent acts silently within its entitlements.' }
    ],

    riskClasses: {
      R0: { name: 'Read', ceiling: 4, covers: 'Query, explain, summarise' },
      R1: { name: 'Administrative', ceiling: 3, covers: 'Request, route, draft, send status' },
      R2: { name: 'Record-changing, non-economic', ceiling: 2, covers: 'Account metadata, account opening' },
      R3: { name: 'Economic or ownership', ceiling: 2, covers: 'Orders, transfers, price, date or account changes' },
      R4: { name: 'Regulatory or fiduciary', ceiling: 1, covers: 'KYC/AML determinations, gates, eligibility' }
    },

    // Typed business capabilities — the only way anything reaches a TA.
    capabilities: {
      ANSWER_QUERY: { risk: 'R0', domain: 'LIFECYCLE', label: 'Answer a query from the register' },
      EXPLAIN_STATUS: { risk: 'R0', domain: 'DEALING', label: 'Explain an order status' },
      REQUEST_DOCUMENTS: { risk: 'R1', domain: 'LIFECYCLE', label: 'Request missing documents or data' },
      ROUTE_CASE: { risk: 'R1', domain: 'OPERATIONS', label: 'Route a case to a team queue' },
      NORMALISE_ORDER_FORMAT: { risk: 'R1', domain: 'DEALING', label: 'Fix order formatting (no economic change)' },
      SEND_ORDER_STATUS: { risk: 'R1', domain: 'DEALING', label: 'Send order status (setr.016)' },
      DRAFT_INVESTOR_NOTICE: { risk: 'R1', domain: 'OPERATIONS', label: 'Draft an investor notice' },
      RECOMMEND_FUNDING_ACTION: { risk: 'R1', domain: 'OPERATIONS', label: 'Recommend a funding action' },
      PUBLISH_OVERSIGHT_FINDING: { risk: 'R1', domain: 'OVERSIGHT', label: 'Publish an oversight finding' },
      UPDATE_CORRESPONDENCE_ADDRESS: { risk: 'R2', domain: 'LIFECYCLE', label: 'Update correspondence address' },
      UPDATE_BANK_DETAILS: { risk: 'R2', domain: 'LIFECYCLE', label: 'Update redemption bank details', makerChecker: true },
      OPEN_ACCOUNT: { risk: 'R2', domain: 'LIFECYCLE', label: 'Open investor account (acmt.001)' },
      AMEND_DEALING_DATE: { risk: 'R3', domain: 'DEALING', label: 'Move an order to another dealing date' },
      AMEND_ORDER_AMOUNT: { risk: 'R3', domain: 'DEALING', label: 'Change an order amount' },
      EXECUTE_TRANSFER: { risk: 'R3', domain: 'LIFECYCLE', label: 'Execute a holding transfer (sese.001)' },
      RECONCILE_TOKEN_BREAK: { risk: 'R3', domain: 'OVERSIGHT', label: 'Correct an on-chain / register break' },
      ACCEPT_INVESTOR_KYC: { risk: 'R4', domain: 'LIFECYCLE', label: 'Accept investor for AML/KYC' },
      APPLY_REDEMPTION_GATE: { risk: 'R4', domain: 'OPERATIONS', label: 'Apply a redemption gate' }
    },

    // Each process has an autonomy dial. Effective autonomy never exceeds the risk ceiling.
    processes: {
      ONBOARDING: { domain: 'LIFECYCLE', label: 'Onboarding and KYC', dial: 3 },
      ACCOUNT_MAINTENANCE: { domain: 'LIFECYCLE', label: 'Account maintenance', dial: 2 },
      TRANSFERS: { domain: 'LIFECYCLE', label: 'Transfers', dial: 2 },
      SERVICING: { domain: 'LIFECYCLE', label: 'Investor servicing', dial: 4 },
      DEALING: { domain: 'DEALING', label: 'Dealing exceptions', dial: 3 },
      NIGO_REPAIR: { domain: 'DEALING', label: 'NIGO repair', dial: 3 },
      LIQUIDITY: { domain: 'OPERATIONS', label: 'Liquidity and T+1', dial: 1 },
      SEMI_LIQUID: { domain: 'OPERATIONS', label: 'Semi-liquid gates', dial: 1 },
      OVERSIGHT: { domain: 'OVERSIGHT', label: 'Delegate oversight', dial: 1 },
      TOKEN_RECON: { domain: 'OVERSIGHT', label: 'Tokenized reconciliation', dial: 1 }
    },

    domains: {
      LIFECYCLE: 'Investor lifecycle',
      DEALING: 'Dealing',
      OPERATIONS: 'Operations and liquidity',
      OVERSIGHT: 'Oversight and intelligence'
    },

    // Who may decide or approve, by capability first, then by risk class.
    approvals: {
      byCapability: { APPLY_REDEMPTION_GATE: ['BOARD'], UPDATE_BANK_DETAILS: ['OPS'] },
      byRisk: { R0: ['OPS'], R1: ['OPS'], R2: ['OPS'], R3: ['OPS'], R4: ['COMPLIANCE'] }
    },

    roles: {
      OPS: 'Operations',
      COMPLIANCE: 'Compliance',
      BOARD: 'Fund board / ManCo',
      DISTRIBUTION: 'Distribution',
      AUDITOR: 'Auditor'
    },
    governanceRoles: ['COMPLIANCE'],
    killSwitchRoles: ['OPS', 'COMPLIANCE'],

    rules: [
      { id: 'R-KNOWN-CAPABILITY', effect: 'DENY', text: 'Only catalogued capabilities can be proposed.' },
      { id: 'R-ENTITLEMENT', effect: 'DENY', text: 'The agent identity must be entitled to the capability.' },
      { id: 'R-KILL-SWITCH', effect: 'DENY', text: 'A frozen domain executes nothing.' },
      { id: 'R-UNTRUSTED-ORIGIN', effect: 'DENY', text: 'Instructions found in documents, emails or files carry no authority.' },
      { id: 'R-NO-BACKDATING', effect: 'DENY', text: 'An order can never be moved to a dealing date earlier than its earliest permitted date.' },
      { id: 'R-CEILING', effect: 'CAP', text: 'Autonomy = min(risk-class ceiling, process dial, agent maximum).' },
      { id: 'R-CONFORMAL', effect: 'ESCALATE', text: 'Unless the conformal prediction set holds exactly one candidate, a person decides. Confidence can lower autonomy, never raise it.' },
      { id: 'R-DATA-AUTHORITY', effect: 'ESCALATE', text: 'Acting on non-authoritative data, or data with an open break, needs a person.' },
      { id: 'R-MAKER-CHECKER', effect: 'CAP', text: 'Maker-checker capabilities always need an independent approver.' },
      { id: 'R-R4-HUMAN', effect: 'CAP', text: 'Regulatory and fiduciary determinations are made by a person.' }
    ],

    conformal: { defaultAlpha: 0.05 }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
