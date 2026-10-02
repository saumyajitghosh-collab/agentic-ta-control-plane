/* Four domain agents. Each is a principal with an identity and entitlements, like a person.
 * Agents only propose: they return candidate actions with probabilities, and the conformal
 * prediction set is computed from calibration data, not from the agent's own say-so. */
(function (g) {
  'use strict';
  const T = (g.TACP = g.TACP || {});
  const A = () => T.analytics;

  T.AGENTS = {
    'AGENT:LIFECYCLE:V2': {
      id: 'AGENT:LIFECYCLE:V2', domain: 'LIFECYCLE', name: 'Investor lifecycle agent', version: '2.1.0', maxAutonomy: 4,
      entitlements: ['ANSWER_QUERY', 'REQUEST_DOCUMENTS', 'ROUTE_CASE', 'UPDATE_CORRESPONDENCE_ADDRESS', 'UPDATE_BANK_DETAILS', 'OPEN_ACCOUNT', 'EXECUTE_TRANSFER', 'ACCEPT_INVESTOR_KYC']
    },
    'AGENT:DEALING_NIGO:V3': {
      id: 'AGENT:DEALING_NIGO:V3', domain: 'DEALING', name: 'Dealing and NIGO agent', version: '3.0.2', maxAutonomy: 3,
      entitlements: ['EXPLAIN_STATUS', 'NORMALISE_ORDER_FORMAT', 'SEND_ORDER_STATUS', 'AMEND_DEALING_DATE', 'REQUEST_DOCUMENTS', 'ROUTE_CASE']
    },
    'AGENT:OPS_LIQUIDITY:V1': {
      id: 'AGENT:OPS_LIQUIDITY:V1', domain: 'OPERATIONS', name: 'Operations and liquidity agent', version: '1.4.0', maxAutonomy: 2,
      entitlements: ['RECOMMEND_FUNDING_ACTION', 'APPLY_REDEMPTION_GATE', 'DRAFT_INVESTOR_NOTICE', 'ROUTE_CASE']
    },
    'AGENT:OVERSIGHT:V1': {
      id: 'AGENT:OVERSIGHT:V1', domain: 'OVERSIGHT', name: 'Oversight and intelligence agent', version: '1.2.1', maxAutonomy: 2,
      entitlements: ['PUBLISH_OVERSIGHT_FINDING', 'RECONCILE_TOKEN_BREAK', 'ANSWER_QUERY']
    }
  };

  const AGENT_BY_DOMAIN = { LIFECYCLE: 'AGENT:LIFECYCLE:V2', DEALING: 'AGENT:DEALING_NIGO:V3', OPERATIONS: 'AGENT:OPS_LIQUIDITY:V1', OVERSIGHT: 'AGENT:OVERSIGHT:V1' };
  T.agentFor = (c) => AGENT_BY_DOMAIN[c.domain];

  const cand = (label, capability, params, p) => ({ label, capability, params, p });

  function finalise(c, cp, candidates, extra) {
    const qhat = T.conformal.qhat(cp.world.calibration[c.process] || [], cp.controls.alpha);
    const set = T.conformal.predictionSet(candidates, qhat);
    const top = candidates.slice().sort((a, b) => b.p - a.p)[0];
    return Object.assign({
      caseId: c.id, agentId: T.agentFor(c), process: c.process, origin: 'AGENT_REASONING',
      capability: top.capability, params: top.params, label: top.label,
      candidates: candidates.map((x) => ({ label: x.label, capability: x.capability, p: x.p, score: Number((1 - x.p).toFixed(4)), inSet: set.includes(x) })),
      conformal: { alpha: cp.controls.alpha, qhat: Number(qhat === Infinity ? 1 : qhat.toFixed(4)), setSize: set.length, set: set.map((x) => x.label) }
    }, extra);
  }

  function reason(c, cp) {
    const w = cp.world;
    const by = A().byId;
    const inv = c.investorId ? by(w.investors, c.investorId) : null;

    switch (c.type) {
      case 'ONBOARDING': {
        const d = c.data;
        const missing = d.docsRequired.filter((x) => !d.docsProvided.includes(x));
        const facts = ['Documents received: ' + d.docsProvided.length + ' of ' + d.docsRequired.length];
        if (missing.length) {
          return finalise(c, cp, [
            cand('Request ' + missing.length + ' missing document(s)', 'REQUEST_DOCUMENTS', { to: inv.name, documents: missing }, 0.97),
            cand('Route to onboarding team', 'ROUTE_CASE', { queue: 'Onboarding' }, 0.03)
          ], { rationale: 'The pack is incomplete: ' + missing.join(', ') + '. Requesting the missing items is administrative.', facts: facts.concat(['Missing: ' + missing.join(', ')]), sourceLineage: [{ source: 'Application pack', ref: c.id + '-PACK' }] });
        }
        if (d.screening === 'PEP_MATCH') {
          return finalise(c, cp, [
            cand('Recommend acceptance with enhanced due diligence', 'ACCEPT_INVESTOR_KYC', { investorId: inv.id, screening: 'PEP_MATCH', recommendation: 'ACCEPT_WITH_EDD', edd: d.edd }, 0.81),
            cand('Recommend decline', 'ACCEPT_INVESTOR_KYC', { investorId: inv.id, screening: 'PEP_MATCH', recommendation: 'DECLINE' }, 0.12),
            cand('Route for further investigation', 'ROUTE_CASE', { queue: 'Financial crime' }, 0.07)
          ], { rationale: 'Screening hit found: ' + d.hitDetail + '. Enhanced due diligence evidence is on file. Acceptance is a compliance determination, so the agent can only recommend.', facts: facts.concat(['Screening hit found: ' + d.hitDetail, 'Recorded as a fact, not a determination']), sourceLineage: [{ source: 'Screening service', ref: 'SCR-' + inv.id }, { source: 'Application pack', ref: c.id + '-PACK' }] });
        }
        return finalise(c, cp, [
          cand('Recommend acceptance (no screening hit found)', 'ACCEPT_INVESTOR_KYC', { investorId: inv.id, screening: 'NO_HIT', recommendation: 'ACCEPT' }, 0.93),
          cand('Route for enhanced due diligence', 'ROUTE_CASE', { queue: 'Onboarding' }, 0.07)
        ], { rationale: 'Pack complete and no screening hit found. "No hit" is a fact; approving the investor is a compliance determination.', facts: facts.concat(['No screening hit found']), sourceLineage: [{ source: 'Screening service', ref: 'SCR-' + inv.id }] });
      }

      case 'ACCOUNT_OPEN':
        return finalise(c, cp, [cand('Open investor account', 'OPEN_ACCOUNT', { investorId: inv.id, accountName: inv.name, currency: c.data.currency, lei: inv.lei, country: inv.country }, 0.98)],
          { rationale: 'KYC accepted by compliance; open the account with the TA.', facts: ['KYC status: ' + inv.kycStatus], sourceLineage: [{ source: 'KYC decision', ref: c.data.kycDecisionRef }] });

      case 'ORDER': {
        const o = c.order;
        const v = A().validateOrder(o, w);
        const codes = v.issues.map((x) => x.code);
        const facts = v.issues.length ? v.issues.map((x) => x.detail) : ['Order passes every validation rule'];
        const lineage = [{ source: (by(w.distributors, o.distributorId) || {}).name + ' order', ref: o.orderRef }, { source: 'Dealing policy', ref: v.fund.id + ' v7.2' }];
        const da = { authoritative: true, openBreaks: 0 };
        if (codes.includes('FORMAT_ISIN') && codes.length === 1) {
          return finalise(c, cp, [
            cand('Normalise ISIN formatting', 'NORMALISE_ORDER_FORMAT', { orderRef: o.orderRef, field: 'isin', from: o.isin, to: A().normaliseIsin(o.isin) }, 0.98),
            cand('Return to distributor', 'SEND_ORDER_STATUS', { orderRef: o.orderRef, status: 'RJCT', reason: 'Invalid ISIN format' }, 0.02)
          ], { rationale: 'The ISIN differs only in spacing and case. Normalising it changes no economic term.', facts, sourceLineage: lineage, dataAuthority: da });
        }
        if (codes.includes('MISSING_ACCOUNT')) {
          return finalise(c, cp, [cand('Ask the distributor for the account number', 'REQUEST_DOCUMENTS', { to: (by(w.distributors, o.distributorId) || {}).name, documents: ['Investor account number for ' + o.orderRef] }, 0.95),
            cand('Return order as not in good order', 'SEND_ORDER_STATUS', { orderRef: o.orderRef, status: 'RJCT', reason: 'Missing account' }, 0.05)],
            { rationale: 'The order cannot be matched to an account. Ask before rejecting.', facts, sourceLineage: lineage, dataAuthority: da });
        }
        if (codes.includes('BELOW_MINIMUM')) {
          return finalise(c, cp, [
            cand('Return to distributor: below minimum', 'SEND_ORDER_STATUS', { orderRef: o.orderRef, status: 'RJCT', reason: 'Below minimum initial investment' }, 0.56),
            cand('Route to dealing desk for a waiver review', 'ROUTE_CASE', { queue: 'Dealing desk' }, 0.42),
            cand('Increase the order to the minimum', 'AMEND_ORDER_AMOUNT', { orderRef: o.orderRef, newAmount: v.shareClass.minInitial }, 0.02)
          ], { rationale: 'Waivers are sometimes granted for this distributor, so the right outcome is unclear.', facts, sourceLineage: lineage, dataAuthority: da });
        }
        if (codes.includes('INELIGIBLE_CLASS')) {
          return finalise(c, cp, [cand('Reject: share class not open to this investor type', 'SEND_ORDER_STATUS', { orderRef: o.orderRef, status: 'RJCT', reason: 'Share class not available to investor type' }, 0.9),
            cand('Route to dealing desk', 'ROUTE_CASE', { queue: 'Dealing desk' }, 0.1)],
            { rationale: 'Eligibility is a deterministic prospectus rule.', facts, sourceLineage: lineage, dataAuthority: da });
        }
        if (codes.includes('LATE')) {
          const dd = v.dealing;
          return finalise(c, cp, [
            cand('Deal on the next dealing date (' + dd.earliestPermitted + ')', 'AMEND_DEALING_DATE', { orderRef: o.orderRef, receivedLocal: o.receivedLocal, cutoff: dd.cutoff, newDealingDate: dd.earliestPermitted, earliestPermittedDealingDate: dd.earliestPermitted }, 0.95),
            cand('Deal today (' + dd.receivedDay + ')', 'AMEND_DEALING_DATE', { orderRef: o.orderRef, receivedLocal: o.receivedLocal, cutoff: dd.cutoff, newDealingDate: dd.receivedDay, earliestPermittedDealingDate: dd.earliestPermitted }, 0.03),
            cand('Reject the order', 'SEND_ORDER_STATUS', { orderRef: o.orderRef, status: 'RJCT', reason: 'Received after cut-off' }, 0.02)
          ], { rationale: 'Received after the cut-off, so the earliest permitted dealing date is the next one. Moving the dealing date is an economic change.', facts, sourceLineage: lineage, dataAuthority: da });
        }
        return finalise(c, cp, [cand('Confirm the order is accepted (PACK)', 'SEND_ORDER_STATUS', { orderRef: o.orderRef, status: 'PACK', reason: 'Accepted for dealing on ' + v.dealing.earliestPermitted }, 0.99)],
          { rationale: 'Clean order; confirm acceptance and dealing date.', facts, sourceLineage: lineage, dataAuthority: da });
      }

      case 'ADDRESS_CHANGE':
        return finalise(c, cp, [cand('Update correspondence address', 'UPDATE_CORRESPONDENCE_ADDRESS', { investorId: inv.id, newAddress: c.data.newAddress }, 0.96), cand('Request more evidence', 'REQUEST_DOCUMENTS', { to: inv.name, documents: ['Proof of address'] }, 0.04)],
          { rationale: 'Signed form and proof of address verified.', facts: [c.data.evidence], sourceLineage: [{ source: 'Change form', ref: c.id + '-FORM' }], dataAuthority: { authoritative: true, openBreaks: 0 } });

      case 'BANK_DETAILS_CHANGE':
        if (!c.data.callbackDone) {
          return finalise(c, cp, [cand('Request call-back verification first', 'REQUEST_DOCUMENTS', { to: inv.name, documents: ['Call-back with an authorised signatory'] }, 0.61), cand('Update bank details', 'UPDATE_BANK_DETAILS', { investorId: inv.id, newBank: c.data.newBank }, 0.39)],
            { rationale: 'Bank changes without a call-back are a known fraud pattern; the outcome is not clear-cut.', facts: [c.data.evidence], sourceLineage: [{ source: 'Email instruction', ref: c.id + '-EML' }], dataAuthority: { authoritative: true, openBreaks: 0 } });
        }
        return finalise(c, cp, [cand('Update redemption bank details', 'UPDATE_BANK_DETAILS', { investorId: inv.id, newBank: c.data.newBank }, 0.94), cand('Request call-back again', 'REQUEST_DOCUMENTS', { to: inv.name, documents: ['Call-back'] }, 0.06)],
          { rationale: 'Instruction signed and call-back completed. The agent is the maker; a person must check.', facts: [c.data.evidence], sourceLineage: [{ source: 'Signed instruction', ref: c.id + '-INS' }, { source: 'Call-back log', ref: c.id + '-CB' }], dataAuthority: { authoritative: true, openBreaks: 0 } });

      case 'TRANSFER': {
        const h = by(w.holdings, c.holdingId);
        const sc = by(w.shareClasses, h.shareClassId);
        return finalise(c, cp, [cand('Transfer ' + T.fmtUnits(c.data.units) + ' units to ' + c.data.receivingAccount, 'EXECUTE_TRANSFER', { holdingId: h.id, isin: sc.isin, units: c.data.units, accountId: inv.accountId, receivingAccount: c.data.receivingAccount }, 0.93), cand('Route to transfers team', 'ROUTE_CASE', { queue: 'Transfers' }, 0.07)],
          { rationale: 'Signed transfer form; units available on the authoritative register.', facts: ['Register units: ' + T.fmtUnits(h.sources[0].value), h.openBreaks ? 'Open break against ' + h.sources[1].source : 'Sources agree'], sourceLineage: h.sources.map((s) => ({ source: s.source, ref: s.recordRef })), dataAuthority: { authoritative: true, openBreaks: h.openBreaks } });
      }

      case 'QUERY': {
        const h = by(w.holdings, c.holdingId);
        const sc = by(w.shareClasses, h.shareClassId);
        const reg = h.sources[0];
        const answer = inv.name + ' holds ' + T.fmtUnits(reg.value) + ' units of ' + sc.name + ' (' + sc.isin + ') per the ' + reg.source + ' as at ' + reg.effectiveAt + '.' + (h.openBreaks ? ' Note: ' + h.sources[1].source + ' shows ' + T.fmtUnits(h.sources[1].value) + ' units; that record is not authoritative and a break is open.' : '');
        return finalise(c, cp, [cand('Answer from the authoritative register', 'ANSWER_QUERY', { holdingId: h.id, answer }, 0.97), cand('Route to servicing team', 'ROUTE_CASE', { queue: 'Servicing' }, 0.03)],
          { rationale: 'Read-only answer with provenance.', facts: [answer], sourceLineage: h.sources.map((s) => ({ source: s.source, ref: s.recordRef })), dataAuthority: { authoritative: true, openBreaks: 0 } });
      }

      case 'GATE': {
        const gc = A().gateCalc(w);
        return finalise(c, cp, [cand('Recommend a pro-rata gate at ' + T.fmtPct(gc.proRata), 'APPLY_REDEMPTION_GATE', { fundId: c.fundId, proRata: Number(gc.proRata.toFixed(4)), requested: gc.requested, capacity: gc.capacity }, 0.9), cand('Recommend meeting all requests from liquidity reserve', 'APPLY_REDEMPTION_GATE', { fundId: c.fundId, proRata: 1 }, 0.1)],
          { rationale: 'Requests of ' + T.fmtMoney(gc.requested, 'EUR') + ' exceed the 5% capacity of ' + T.fmtMoney(gc.capacity, 'EUR') + '. Applying a gate is a board decision.', facts: ['Requested ' + T.fmtMoney(gc.requested, 'EUR'), 'Capacity ' + T.fmtMoney(gc.capacity, 'EUR')], sourceLineage: [{ source: 'Provider A register', ref: 'F-KES-Q4-REQUESTS' }], dataAuthority: { authoritative: true, openBreaks: 0 } });
      }

      case 'LIQUIDITY': {
        const lad = A().liquidityLadder(w, c.fundId, 1, c.data.extraRedemption);
        return finalise(c, cp, [cand('Net flows and pre-arrange a ' + T.fmtMoney(Math.abs(lad.maxShortfall), lad.ccy) + ' facility', 'RECOMMEND_FUNDING_ACTION', { fundId: c.fundId, gapDays: lad.gapDays, maxShortfall: lad.maxShortfall, firstGap: lad.firstGap, actions: ['Net subscriptions against redemptions in the same share class', 'Pre-arrange an overdraft facility covering the shortfall', 'Review swing-pricing threshold for the gap days'] }, 0.88), cand('Route to treasury', 'ROUTE_CASE', { queue: 'Treasury' }, 0.12)],
          { rationale: 'Under a T+1 underlying cycle the fund is short of cash on ' + lad.gapDays + ' day(s).', facts: ['First gap: ' + lad.firstGap, 'Maximum shortfall: ' + T.fmtMoney(lad.maxShortfall, lad.ccy)], sourceLineage: [{ source: 'Order book', ref: c.fundId + '-FLOWS' }], dataAuthority: { authoritative: true, openBreaks: 0 } });
      }

      case 'OVERSIGHT': {
        const sc = A().scorecard(w, c.data.cohort);
        const f = sc.findings.find((x) => x.providerId === c.providerId && x.metric === c.data.metric) || sc.findings[0];
        return finalise(c, cp, [cand('Publish finding to the provider', 'PUBLISH_OVERSIGHT_FINDING', { providerId: f.providerId, metric: f.metric, cohort: f.cohort, value: f.value, median: f.median, ratio: Number(f.ratio.toFixed(2)) }, 0.9), cand('Keep under watch', 'ROUTE_CASE', { queue: 'Oversight' }, 0.1)],
          { rationale: f.label + ' is ' + f.ratio.toFixed(2) + '× the peer median in the ' + f.cohort.toLowerCase() + ' cohort.', facts: [f.label + ': ' + f.value + ' vs median ' + f.median.toFixed(2)], sourceLineage: [{ source: 'Normalised provider metrics', ref: 'SC-' + f.cohort }], dataAuthority: { authoritative: true, openBreaks: 0 } });
      }

      case 'TOKEN_BREAK': {
        const wl = w.wallets.find((x) => x.wallet === c.data.wallet);
        const diff = wl.chainUnits - wl.registerUnits;
        return finalise(c, cp, [cand('Ask the token agent to burn ' + diff + ' tokens to match the register', 'RECONCILE_TOKEN_BREAK', { wallet: wl.wallet, registerUnits: wl.registerUnits, chainUnits: wl.chainUnits, adjustment: -diff }, 0.76), cand('Route to digital assets team', 'ROUTE_CASE', { queue: 'Digital assets' }, 0.24)],
          { rationale: 'The register is the book of record; the chain shows ' + diff + ' extra tokens.', facts: ['Register ' + wl.registerUnits + ', chain ' + wl.chainUnits], sourceLineage: [{ source: 'Provider A register', ref: wl.holdingId }, { source: 'On-chain token ledger', ref: wl.wallet }], dataAuthority: { authoritative: true, openBreaks: 1 } });
      }

      default:
        throw new Error('No reasoning for case type ' + c.type);
    }
  }

  T.reason = reason;
})(typeof globalThis !== 'undefined' ? globalThis : this);
