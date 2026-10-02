/* The control plane runtime. The workflow owns the process; agents are plug-ins.
 * Every proposal, verdict, human decision, execution and governance change is an evidence envelope. */
(function (g) {
  'use strict';
  const T = (g.TACP = g.TACP || {});

  const STATUS_FOR = { DENY: 'DENIED', OBSERVE_ONLY: 'OBSERVED', RECOMMEND_ONLY: 'AWAITING_DECISION', REQUIRE_APPROVAL: 'AWAITING_APPROVAL', AUTO_EXECUTE: 'EXECUTED' };

  class ControlPlane {
    constructor(opts) {
      const o = opts || {};
      this.pack = T.POLICY_PACK;
      this.world = T.buildWorld(o.seed);
      this.agents = T.clone(T.AGENTS);
      this.controls = {
        dials: Object.fromEntries(Object.keys(this.pack.processes).map((k) => [k, this.pack.processes[k].dial])),
        killSwitches: Object.fromEntries(Object.keys(this.pack.domains).map((k) => [k, false])),
        alpha: this.pack.conformal.defaultAlpha
      };
      this.ledger = new T.EvidenceLedger();
      this.clock = Date.parse(T.BUSINESS_DATE + 'T07:00:00Z');
      this.reasoner = { name: 'deterministic', version: '1.0.0' };
      this.listeners = new Set();
      this.msgSeq = 1;
    }

    // ---------- infrastructure ----------
    now() { return new Date(this.clock).toISOString().replace('.000Z', 'Z'); }
    advance(seconds) { this.clock += seconds * 1000; }
    setClock(isoDateTime) { this.clock = Date.parse(isoDateTime); }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit() { this.listeners.forEach((fn) => { try { fn(); } catch (e) { /* UI listener errors must not break the engine */ } }); }
    ctx() { return { pack: this.pack, controls: T.clone(this.controls), agents: this.agents }; }
    getCase(id) { const c = this.world.cases.find((x) => x.id === id); if (!c) throw new Error('Unknown case ' + id); return c; }
    addCase(c) { this.world.cases.push(Object.assign({ status: 'NEW', createdAt: this.now() }, c)); this.emit(); return c; }
    nextMsgId(prefix) { return prefix + '-' + String(this.msgSeq++).padStart(5, '0'); }

    record(kind, data) {
      const entry = this.ledger.append(Object.assign({ kind, at: this.now() }, data));
      this.advance(7);
      return entry;
    }

    // ---------- the loop: propose → gate → (execute | wait for a person) ----------
    propose(caseId) { return T.reason(this.getCase(caseId), this); }

    gate(caseId, proposal, opts) {
      const c = this.getCase(caseId);
      const ctx = this.ctx();
      const gate = T.evaluate(proposal, ctx);
      const options = opts || {};
      const entry = this.record('DECISION', {
        caseId, actor: proposal.agentId,
        agent: { id: proposal.agentId, version: (this.agents[proposal.agentId] || {}).version },
        model: { reasoner: proposal.reasonerName || this.reasoner.name, version: proposal.reasonerVersion || this.reasoner.version },
        promptVersion: 'prompts-1.2', policyVersion: this.pack.version,
        inputSnapshotHash: T.sha256(T.canonicalJSON(Object.assign({}, c, { proposal: undefined, gate: undefined }))),
        sourceLineage: proposal.sourceLineage || [], riskClass: gate.riskClass, confidence: proposal.conformal || null,
        proposal: T.clone(proposal), gate, controlsSnapshot: ctx.controls,
        agentSnapshot: this.agents[proposal.agentId] ? T.clone(this.agents[proposal.agentId]) : null,
        note: options.note || null
      });
      if (options.alternative) { this.emit(); return { proposal, gate, entry }; }
      c.proposal = proposal;
      c.gate = gate;
      c.decisionSeq = entry.seq;
      c.status = STATUS_FOR[gate.verdict];
      if (gate.verdict === 'AUTO_EXECUTE') this.execute(c, proposal, 'POLICY:' + gate.levelCode);
      this.emit();
      return { proposal, gate, entry };
    }

    run(caseId) {
      const c = this.getCase(caseId);
      if (c.status !== 'NEW') throw new Error(caseId + ' has already been processed (' + c.status + ').');
      return this.gate(caseId, this.propose(caseId));
    }

    runAll() {
      const results = [];
      this.world.cases.filter((c) => c.status === 'NEW').forEach((c) => results.push(this.run(c.id)));
      return results;
    }

    decide(caseId, role, decision, note) {
      const c = this.getCase(caseId);
      if (c.status !== 'AWAITING_APPROVAL' && c.status !== 'AWAITING_DECISION') throw new Error(caseId + ' is not waiting for a decision.');
      if (!c.gate.deciders.includes(role)) throw new Error(this.pack.roles[role] + ' cannot decide this. It needs: ' + c.gate.deciders.map((r) => this.pack.roles[r]).join(', ') + '.');
      this.record('HUMAN_DECISION', { caseId, actor: 'HUMAN:' + role, decision, note: note || null, relatedSeq: c.decisionSeq, capability: c.proposal.capability, riskClass: c.gate.riskClass });
      if (decision === 'APPROVE') this.execute(c, c.proposal, 'HUMAN:' + role);
      else c.status = 'REJECTED';
      this.emit();
    }

    execute(c, proposal, authorisedBy) {
      const fn = EXEC[proposal.capability];
      const effect = fn ? fn(c, proposal.params || {}, this) : { summary: 'No-op' };
      const messages = (effect.messages || []).map((m) => Object.assign({ direction: 'OUT', at: this.now() }, m));
      c.messages = (c.messages || []).concat(messages);
      c.outcome = effect.summary;
      c.status = 'EXECUTED';
      this.record('EXECUTION', {
        caseId: c.id, actor: proposal.agentId, authorisedBy, capabilityCalled: proposal.capability,
        requestHash: T.sha256(T.canonicalJSON(proposal.params || {})), response: effect.summary,
        responseHash: T.sha256(T.canonicalJSON({ summary: effect.summary, messages: messages.map((m) => m.xml) })),
        messages: messages.map((m) => ({ type: m.type, valid: m.valid, hash: T.sha256(m.xml) })), finalState: 'EXECUTED'
      });
    }

    // Evaluate without recording (policy sandbox).
    dryRun(proposal) { return T.evaluate(proposal, this.ctx()); }

    // ---------- governance (also evidenced) ----------
    requireRole(role, allowed, what) { if (!allowed.includes(role)) throw new Error(this.pack.roles[role] + ' cannot ' + what + '. Allowed: ' + allowed.map((r) => this.pack.roles[r]).join(', ') + '.'); }
    setDial(process, level, role) {
      this.requireRole(role, this.pack.governanceRoles, 'change autonomy');
      const from = this.controls.dials[process];
      const to = Math.max(0, Math.min(4, Number(level)));
      if (from === to) return;
      this.controls.dials[process] = to;
      this.record('GOVERNANCE_CHANGE', { actor: 'HUMAN:' + role, change: { type: 'AUTONOMY_DIAL', process, from, to }, policyVersion: this.pack.version });
      this.emit();
    }
    setKillSwitch(domain, on, role) {
      this.requireRole(role, this.pack.killSwitchRoles, 'use a kill switch');
      if (this.controls.killSwitches[domain] === !!on) return;
      this.controls.killSwitches[domain] = !!on;
      this.record('GOVERNANCE_CHANGE', { actor: 'HUMAN:' + role, change: { type: 'KILL_SWITCH', domain, frozen: !!on }, policyVersion: this.pack.version });
      this.emit();
    }
    setAlpha(alpha, role) {
      this.requireRole(role, this.pack.governanceRoles, 'change the confidence level');
      const from = this.controls.alpha;
      const to = Number(alpha);
      if (from === to) return;
      this.controls.alpha = to;
      this.record('GOVERNANCE_CHANGE', { actor: 'HUMAN:' + role, change: { type: 'CONFORMAL_ALPHA', from, to }, policyVersion: this.pack.version });
      this.emit();
    }
  }

  // ---------- Capability executors (deterministic; the only code that changes state) ----------
  const by = (arr, id) => arr.find((x) => x.id === id);
  function statusMsg(cp, o, status, reason) {
    return T.messages.build('setr.016', { msgId: cp.nextMsgId('STS'), createdAt: cp.now(), relatedRef: o.orderRef, relatedMsg: o.side === 'SUB' ? 'setr.010.001.04' : 'setr.004.001.04', orderRef: o.orderRef, status, reason });
  }
  const EXEC = {
    ANSWER_QUERY: (c, p) => ({ summary: p.answer }),
    EXPLAIN_STATUS: (c, p) => ({ summary: p.explanation || 'Status explained.' }),
    REQUEST_DOCUMENTS: (c, p, cp) => { cp.world.outbox.push({ at: cp.now(), caseId: c.id, to: p.to, items: p.documents }); return { summary: 'Request sent to ' + p.to + ' for: ' + p.documents.join('; ') + '.' }; },
    ROUTE_CASE: (c, p) => ({ summary: 'Routed to the ' + p.queue + ' queue.' }),
    NORMALISE_ORDER_FORMAT: (c, p, cp) => { c.order[p.field] = p.to; return { summary: 'Normalised ' + p.field + ' from "' + p.from + '" to ' + p.to + '; order now in good order.', messages: [statusMsg(cp, c.order, 'PACK', 'Format corrected; accepted for dealing')] }; },
    SEND_ORDER_STATUS: (c, p, cp) => ({ summary: 'Sent status ' + p.status + ' for ' + p.orderRef + (p.reason ? ' (' + p.reason + ')' : '') + '.', messages: [statusMsg(cp, c.order, p.status, p.reason)] }),
    DRAFT_INVESTOR_NOTICE: (c, p) => ({ summary: 'Investor notice drafted for review.' }),
    RECOMMEND_FUNDING_ACTION: (c, p) => ({ summary: 'Funding plan accepted: ' + p.actions.join('; ') + '.' }),
    PUBLISH_OVERSIGHT_FINDING: (c, p, cp) => { cp.world.findings.push(Object.assign({ at: cp.now(), caseId: c.id }, p)); return { summary: 'Finding published to ' + by(cp.world.providers, p.providerId).name + '.' }; },
    UPDATE_CORRESPONDENCE_ADDRESS: (c, p, cp) => { const inv = by(cp.world.investors, p.investorId); inv.address = p.newAddress; return { summary: 'Correspondence address updated.' }; },
    UPDATE_BANK_DETAILS: (c, p, cp) => { const inv = by(cp.world.investors, p.investorId); inv.bank = p.newBank; return { summary: 'Redemption bank details updated to ' + p.newBank + ' after independent check.' }; },
    OPEN_ACCOUNT: (c, p, cp) => {
      const inv = by(cp.world.investors, p.investorId);
      inv.accountId = inv.accountId || 'ACC-' + (70000 + cp.world.investors.indexOf(inv));
      const msg = T.messages.build('acmt.001', { msgId: cp.nextMsgId('AOI'), createdAt: cp.now(), accountName: p.accountName, currency: p.currency, ownerName: inv.name, lei: p.lei, country: p.country });
      return { summary: 'Account ' + inv.accountId + ' opening instruction sent.', messages: [msg] };
    },
    AMEND_DEALING_DATE: (c, p, cp) => { c.order.dealingDate = p.newDealingDate; return { summary: 'Order ' + p.orderRef + ' will deal on ' + p.newDealingDate + '.', messages: [statusMsg(cp, c.order, 'PACK', 'Received after ' + p.cutoff + ' cut-off; dealing on ' + p.newDealingDate)] }; },
    AMEND_ORDER_AMOUNT: (c, p) => { c.order.amount = p.newAmount; return { summary: 'Order amount changed to ' + p.newAmount + '.' }; },
    EXECUTE_TRANSFER: (c, p, cp) => {
      const h = by(cp.world.holdings, p.holdingId);
      h.sources[0].value = Number((h.sources[0].value - p.units).toFixed(3));
      const msg = T.messages.build('sese.001', { msgId: cp.nextMsgId('TRF'), createdAt: cp.now(), transferRef: 'TR-' + c.id.slice(5), isin: p.isin, units: p.units, accountId: p.accountId, receivingAccount: p.receivingAccount });
      return { summary: 'Transfer of ' + T.fmtUnits(p.units) + ' units instructed.', messages: [msg] };
    },
    RECONCILE_TOKEN_BREAK: (c, p, cp) => { const w = cp.world.wallets.find((x) => x.wallet === p.wallet); w.chainUnits += p.adjustment; const h = by(cp.world.holdings, w.holdingId); h.sources[1].value = w.chainUnits; h.sources.forEach((s) => { s.reconState = 'MATCHED'; }); h.openBreaks = 0; return { summary: 'Burn of ' + Math.abs(p.adjustment) + ' tokens instructed; chain matches register.' }; },
    ACCEPT_INVESTOR_KYC: (c, p, cp) => { const inv = by(cp.world.investors, p.investorId); inv.kycStatus = p.recommendation === 'DECLINE' ? 'DECLINED' : 'APPROVED'; return { summary: 'Compliance decision applied: investor ' + inv.kycStatus.toLowerCase() + (p.recommendation === 'ACCEPT_WITH_EDD' ? ' with enhanced due diligence' : '') + '.' }; },
    APPLY_REDEMPTION_GATE: (c, p, cp) => { const f = by(cp.world.funds, p.fundId); f.gateApplied = { proRata: p.proRata, at: cp.now() }; return { summary: 'Board approved: redemptions paid at ' + T.fmtPct(p.proRata) + '; the rest deferred to next quarter.' }; }
  };

  T.ControlPlane = ControlPlane;
  T.EXEC = EXEC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
