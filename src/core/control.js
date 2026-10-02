/* Control plane: conformal sets, the policy function, and decision evidence.
 * The model proposes; this file decides. Nothing here calls a model. */
(function (g) {
  'use strict';
  const T = (g.TACP = g.TACP || {});

  // ---------- Split conformal prediction ----------
  // Nonconformity score s = 1 - p(candidate). With n calibration scores and miscoverage alpha,
  // q̂ is the ceil((n+1)(1-alpha))-th smallest score. Candidates with s <= q̂ form the set.
  const conformal = {
    qhat(calibrationScores, alpha) {
      const n = calibrationScores.length;
      if (!n) return Infinity;
      const sorted = calibrationScores.slice().sort((a, b) => a - b);
      const k = Math.ceil((n + 1) * (1 - alpha));
      if (k > n) return Infinity;
      return sorted[Math.max(k, 1) - 1];
    },
    predictionSet(candidates, qhat) {
      return candidates.filter((c) => 1 - c.p <= qhat);
    }
  };

  // ---------- Approver resolution ----------
  function deciderRoles(pack, capability, risk) {
    return pack.approvals.byCapability[capability] || pack.approvals.byRisk[risk] || ['OPS'];
  }

  // ---------- The policy function ----------
  // Permission = Policy(risk class, process, agent identity and autonomy, data authority,
  //                     confidence, exception state, origin, controls)
  function evaluate(proposal, ctx) {
    const pack = ctx.pack;
    const rules = [];
    const add = (id, result, detail) => rules.push({ id, result, detail });
    const cap = pack.capabilities[proposal.capability];

    if (!cap) {
      add('R-KNOWN-CAPABILITY', 'DENY', 'Capability "' + proposal.capability + '" is not in policy pack ' + pack.version + '.');
      return finish('DENY', -1, null);
    }
    add('R-KNOWN-CAPABILITY', 'PASS', cap.label + ' (' + cap.risk + ').');

    const risk = cap.risk;
    const rc = pack.riskClasses[risk];
    const agent = ctx.agents[proposal.agentId];
    const process = pack.processes[proposal.process];
    let denied = false;

    if (!agent || !agent.entitlements.includes(proposal.capability)) {
      add('R-ENTITLEMENT', 'DENY', (proposal.agentId || 'Unknown agent') + ' is not entitled to ' + proposal.capability + '.');
      denied = true;
    } else {
      add('R-ENTITLEMENT', 'PASS', agent.id + ' holds ' + proposal.capability + '.');
    }

    const domain = process ? process.domain : cap.domain;
    if (ctx.controls.killSwitches && ctx.controls.killSwitches[domain]) {
      add('R-KILL-SWITCH', 'DENY', pack.domains[domain] + ' is frozen.');
      denied = true;
    } else {
      add('R-KILL-SWITCH', 'PASS', pack.domains[domain] + ' is live.');
    }

    if (proposal.origin === 'UNTRUSTED_CONTENT') {
      add('R-UNTRUSTED-ORIGIN', 'DENY', 'This action originates from text inside a document. Documents supply facts, never authority.');
      denied = true;
    } else {
      add('R-UNTRUSTED-ORIGIN', 'PASS', 'Proposed by agent reasoning over validated facts.');
    }

    if (proposal.capability === 'AMEND_DEALING_DATE') {
      const p = proposal.params || {};
      if (!p.newDealingDate || !p.earliestPermittedDealingDate || p.newDealingDate < p.earliestPermittedDealingDate) {
        add('R-NO-BACKDATING', 'DENY', 'Requested ' + (p.newDealingDate || '—') + ' is earlier than the earliest permitted ' + (p.earliestPermittedDealingDate || '—') + '.');
        denied = true;
      } else {
        add('R-NO-BACKDATING', 'PASS', p.newDealingDate + ' is on or after ' + p.earliestPermittedDealingDate + '.');
      }
    }

    if (denied) return finish('DENY', -1, risk);

    const dial = process ? ctx.controls.dials[proposal.process] : 0;
    let level = Math.min(rc.ceiling, dial, agent.maxAutonomy);
    add('R-CEILING', 'CAP', 'min(' + risk + ' ceiling L' + rc.ceiling + ', ' + (process ? process.label : 'unknown process') +
      ' dial L' + dial + ', agent max L' + agent.maxAutonomy + ') = L' + level + '.');

    const cf = proposal.conformal;
    if (!cf || cf.setSize !== 1) {
      const before = level;
      level = Math.min(level, 1);
      add('R-CONFORMAL', before > level ? 'ESCALATE' : 'NOTED',
        cf ? 'Prediction set holds ' + cf.setSize + ' candidate(s) at α=' + cf.alpha + ' (q̂=' + fmt(cf.qhat) + ').' : 'No calibrated confidence supplied.');
    } else {
      add('R-CONFORMAL', 'PASS', 'Prediction set holds exactly one candidate at α=' + cf.alpha + ' (q̂=' + fmt(cf.qhat) + '). Autonomy unchanged.');
    }

    const da = proposal.dataAuthority;
    if (da && (!da.authoritative || da.openBreaks > 0)) {
      const before = level;
      level = Math.min(level, 1);
      add('R-DATA-AUTHORITY', before > level ? 'ESCALATE' : 'NOTED',
        (da.authoritative ? '' : 'Source is not authoritative. ') + (da.openBreaks > 0 ? da.openBreaks + ' open break(s) on this record.' : ''));
    } else {
      add('R-DATA-AUTHORITY', 'PASS', da ? 'Authoritative source, no open breaks.' : 'No register data touched.');
    }

    if (cap.makerChecker) {
      const before = level;
      level = Math.min(level, 2);
      add('R-MAKER-CHECKER', before > level ? 'CAP' : 'NOTED', 'Agent is the maker; an independent person must check.');
    }

    if (risk === 'R4') {
      const before = level;
      level = Math.min(level, 1);
      add('R-R4-HUMAN', before > level ? 'CAP' : 'NOTED', 'A person makes this determination; the agent may only recommend.');
    }

    return finish(pack.autonomyLevels[level].verdict, level, risk);

    function finish(verdict, lvl, riskClass) {
      return {
        verdict,
        level: lvl,
        levelCode: lvl >= 0 ? 'L' + lvl : '—',
        riskClass,
        deciders: lvl >= 1 && lvl <= 2 ? deciderRoles(pack, proposal.capability, riskClass) : [],
        rules,
        policyVersion: pack.version
      };
    }
  }
  function fmt(x) { return x === Infinity ? '∞' : Number(x).toFixed(3); }

  // ---------- Decision evidence ledger (hash-chained envelopes) ----------
  class EvidenceLedger {
    constructor() { this.entries = []; }

    append(envelope) {
      const prevHash = this.entries.length ? this.entries[this.entries.length - 1].hash : 'GENESIS';
      const body = Object.assign({}, T.clone(envelope), { seq: this.entries.length, prevHash });
      const hash = T.sha256(T.canonicalJSON(body));
      const entry = Object.assign(body, { hash });
      this.entries.push(entry);
      return entry;
    }

    verify() {
      let prev = 'GENESIS';
      for (let i = 0; i < this.entries.length; i++) {
        const e = this.entries[i];
        const body = Object.assign({}, e);
        delete body.hash;
        if (e.prevHash !== prev) return { ok: false, brokenAt: i, reason: 'Link to previous entry does not match.' };
        if (T.sha256(T.canonicalJSON(body)) !== e.hash) return { ok: false, brokenAt: i, reason: 'Entry content no longer matches its hash.' };
        prev = e.hash;
      }
      return { ok: true, count: this.entries.length };
    }

    forCase(caseId) { return this.entries.filter((e) => e.caseId === caseId); }
    last() { return this.entries[this.entries.length - 1]; }
  }

  // Replay = re-run the policy function on the stored proposal, controls and agent snapshot.
  function replay(entry, pack) {
    if (!entry.proposal || !entry.gate) return { replayable: false, reason: 'Entry carries no gate decision.' };
    if (entry.policyVersion !== pack.version) {
      return { replayable: false, reason: 'Recorded under policy ' + entry.policyVersion + '; loaded pack is ' + pack.version + '.' };
    }
    const agents = {};
    if (entry.agentSnapshot) agents[entry.agentSnapshot.id] = entry.agentSnapshot;
    const result = evaluate(entry.proposal, { pack, controls: entry.controlsSnapshot, agents });
    const sameVerdict = result.verdict === entry.gate.verdict && result.level === entry.gate.level;
    const ruleDiffs = [];
    const n = Math.max(result.rules.length, entry.gate.rules.length);
    for (let i = 0; i < n; i++) {
      const a = entry.gate.rules[i], b = result.rules[i];
      if (!a || !b || a.id !== b.id || a.result !== b.result) ruleDiffs.push({ index: i, recorded: a, replayed: b });
    }
    return { replayable: true, match: sameVerdict && ruleDiffs.length === 0, recorded: entry.gate, replayed: result, ruleDiffs };
  }

  Object.assign(T, { conformal, evaluate, EvidenceLedger, replay, deciderRoles });
})(typeof globalThis !== 'undefined' ? globalThis : this);
