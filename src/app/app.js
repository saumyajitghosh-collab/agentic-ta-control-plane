/* Agentic TA Control Plane — UI. Plain JS, no build step, runs on GitHub Pages. */
(function () {
  'use strict';
  const T = window.TACP;
  const E = T.esc;
  const A = T.analytics;
  const byId = A.byId;

  const VIEWS = [
    { id: 'story', label: 'Story', group: 'Start here' },
    { id: 'ops', label: 'Ops workstation', group: 'Operate' },
    { id: 'register', label: 'Federated register', group: 'Operate' },
    { id: 'liquidity', label: 'Liquidity and gates', group: 'Operate' },
    { id: 'control', label: 'Control plane', group: 'Govern' },
    { id: 'shadow', label: 'Shadow mode', group: 'Govern' },
    { id: 'trust', label: 'Trust boundary', group: 'Govern' },
    { id: 'evidence', label: 'Evidence and replay', group: 'Prove' },
    { id: 'oversight', label: 'Cross-TA oversight', group: 'Prove' },
    { id: 'compliance', label: 'Compliance map', group: 'Prove' },
    { id: 'settings', label: 'Settings', group: 'Settings' }
  ];

  const state = {
    cp: null, story: null, role: 'OPS', view: 'story',
    selCase: null, caseTab: 'overview', filter: { domain: 'ALL', status: 'ALL' },
    regTab: 'holdings', selHolding: null, cohort: 'STANDARD', liqFund: 'F-AUR', liqCycle: 1,
    docId: 'DOC-KYC-CORVANE', suite: null, tamper: null, replays: {}, evOpen: {},
    sandbox: { agentId: 'AGENT:DEALING_NIGO:V3', capability: 'AMEND_DEALING_DATE', process: 'DEALING', setSize: '1', data: 'auth', origin: 'AGENT_REASONING', backdate: 'no' },
    reasoner: { mode: 'deterministic', key: '', model: 'claude-sonnet-5-5' },
    toast: null, modal: null, busy: false
  };

  function reset() {
    state.cp = new T.ControlPlane();
    state.story = new T.Story(state.cp);
    state.cp.subscribe(() => render());
    state.selCase = null; state.tamper = null; state.replays = {}; state.suite = null; state.evOpen = {};
  }

  // ---------- small components ----------
  const pack = () => state.cp.pack;
  const roleName = (r) => pack().roles[r] || r;
  const VERDICT = { AUTO_EXECUTE: ['Executed by policy', 'auth'], REQUIRE_APPROVAL: ['Needs approval', 'human'], RECOMMEND_ONLY: ['A person decides', 'human'], OBSERVE_ONLY: ['Observed only', 'observe'], DENY: ['Refused', 'deny'] };
  const STATUS = { NEW: ['New', 'plain'], EXECUTED: ['Executed', 'auth'], AWAITING_APPROVAL: ['Awaiting approval', 'human'], AWAITING_DECISION: ['Awaiting decision', 'human'], DENIED: ['Refused', 'deny'], REJECTED: ['Declined', 'deny'], OBSERVED: ['Observed', 'observe'] };
  const chip = (text, kind) => '<span class="chip chip-' + kind + '">' + E(text) + '</span>';
  const statusChip = (s) => chip((STATUS[s] || [s])[0], (STATUS[s] || [0, 'plain'])[1]);
  const verdictChip = (v) => chip((VERDICT[v] || [v])[0], (VERDICT[v] || [0, 'plain'])[1]);
  const riskTag = (r) => (r ? '<span class="risk risk-' + r + '">' + r + '</span>' : '');
  const agentName = (id) => (state.cp.agents[id] ? state.cp.agents[id].name : id);
  const levelName = (l) => (l >= 0 ? pack().autonomyLevels[l].name : '');
  const processLabel = (p) => (pack().processes[p] ? pack().processes[p].label : p);
  const btn = (label, act, data, cls) => '<button class="btn ' + (cls || '') + '" data-act="' + act + '"' + Object.keys(data || {}).map((k) => ' data-' + k + '="' + E(data[k]) + '"').join('') + '>' + E(label) + '</button>';

  function gateVerdict(g) {
    return '<div class="verdict v-' + g.verdict + '">' + E(VERDICT[g.verdict][0]) +
      (g.level >= 0 ? '<span class="sub">' + g.levelCode + ', ' + E(levelName(g.level)) + '</span>' : '') +
      (g.deciders.length ? '<span class="sub">Decided by ' + g.deciders.map(roleName).join(' or ') + '</span>' : '') + '</div>';
  }
  function gateRules(g) {
    return '<div class="gate">' + g.rules.map((r) => '<div class="gate-rule r-' + r.result + '"><span class="gate-res">' + r.result + '</span><span><span class="gate-id">' + r.id + '</span> ' + E(r.detail) + '</span></div>').join('') + '</div>' +
      '<div class="small muted">Policy pack ' + E(g.policyVersion) + '</div>';
  }

  function proposalBlock(p) {
    const risk = pack().capabilities[p.capability] ? pack().capabilities[p.capability].risk : '';
    return '<div class="proposal"><div class="who">' + E(agentName(p.agentId)) + ' proposes</div>' +
      '<div class="what">' + E(p.label) + '</div>' +
      '<div class="row">' + riskTag(risk) + '<code>' + E(p.capability) + '</code>' + (p.reasonerName && p.reasonerName !== 'deterministic' ? chip('Rationale by ' + p.reasonerName, 'agent') : '') + '</div>' +
      (p.rationale ? '<p class="small" style="margin-top:6px">' + E(p.rationale) + '</p>' : '') +
      (p.facts && p.facts.length ? '<ul class="facts">' + p.facts.map((f) => '<li>' + E(f) + '</li>').join('') + '</ul>' : '') + '</div>' +
      '<details><summary>Candidates and calibrated confidence (prediction set holds ' + p.conformal.setSize + ')</summary>' +
      '<div class="scroll-x"><table class="cands"><thead><tr><th>Candidate</th><th class="num">p</th><th class="num">Score</th><th>In set</th></tr></thead><tbody>' +
      p.candidates.map((c) => '<tr><td>' + E(c.label) + '</td><td class="num">' + c.p.toFixed(2) + '</td><td class="num">' + c.score.toFixed(3) + '</td><td>' + (c.inSet ? '<span class="inset">Yes</span>' : 'No') + '</td></tr>').join('') +
      '</tbody></table></div><p class="small muted">Split conformal at α=' + p.conformal.alpha + ', q̂=' + p.conformal.qhat + '. A candidate is in the set when 1 − p ≤ q̂. Confidence can only lower autonomy.</p></details>';
  }

  function decisionBar(c) {
    if (c.status !== 'AWAITING_APPROVAL' && c.status !== 'AWAITING_DECISION') return '';
    const can = c.gate.deciders.includes(state.role);
    const who = c.gate.deciders.map(roleName).join(' or ');
    const text = c.status === 'AWAITING_APPROVAL' ? 'The agent acts once ' + who + ' approves.' : 'The agent only recommends. ' + who + ' decides.';
    const buttons = c.status === 'AWAITING_APPROVAL'
      ? btn('Approve', 'decide', { case: c.id, d: 'APPROVE' }, 'btn-approve') + btn('Decline', 'decide', { case: c.id, d: 'REJECT' }, 'btn-decline')
      : btn('Accept recommendation', 'decide', { case: c.id, d: 'APPROVE' }, 'btn-approve') + btn('Reject recommendation', 'decide', { case: c.id, d: 'REJECT' }, 'btn-decline');
    return '<div class="decision"><p>' + E(text) + '</p><div class="row">' +
      (can ? buttons : '<span class="small">You are acting as ' + E(roleName(state.role)) + '.</span>' + btn('Act as ' + roleName(c.gate.deciders[0]), 'switch-role', { role: c.gate.deciders[0] })) + '</div></div>';
  }

  function messagesInline(c) {
    if (!c.messages || !c.messages.length) return '';
    return '<div class="row" style="margin-top:10px">' + c.messages.map((m, i) =>
      '<button class="btn" data-act="view-msg" data-case="' + E(c.id) + '" data-i="' + i + '">' + E(m.type) + ' ' + (m.direction === 'IN' ? 'received' : 'sent') + (m.valid ? '' : ' (invalid)') + '</button>').join('') + '</div>';
  }

  function caseCard(c, opts) {
    const o = opts || {};
    return '<div class="case-card' + (o.alt ? ' alt' : '') + '"><div class="case-head"><h3>' + E(c.title) + '</h3>' + statusChip(c.status) + '</div>' +
      '<div class="small muted">' + E(c.id) + ', ' + E(processLabel(c.process)) + '</div>' +
      (c.proposal ? proposalBlock(c.proposal) : '') +
      (c.gate ? gateVerdict(c.gate) + '<details' + (o.openRules ? ' open' : '') + '><summary>How the gate decided</summary>' + gateRules(c.gate) + '</details>' : '') +
      (c.outcome ? '<div class="outcome">' + E(c.outcome) + '</div>' : '') +
      messagesInline(c) + decisionBar(c) + '</div>';
  }

  function caseGraph(c) {
    const w = state.cp.world;
    const nodes = [];
    const inv = c.investorId ? byId(w.investors, c.investorId) : null;
    if (inv) { nodes.push(['Investor', inv.name]); if (inv.accountId) nodes.push(['Account', inv.accountId]); }
    const fundId = c.fundId || (c.order && c.order.fundId);
    const fund = fundId ? byId(w.funds, fundId) : null;
    if (fund) nodes.push(['Fund', fund.name]);
    if (c.order) {
      const sc = byId(w.shareClasses, c.order.shareClassId);
      nodes.push(['Share class', sc.name]);
      nodes.push(['Order', c.order.orderRef + (c.order.side === 'SUB' ? ' subscription' : ' redemption')]);
      nodes.push(['Received', c.order.receivedLocal.replace('T', ' ') + ', ' + c.order.tz]);
      const d = byId(w.distributors, c.order.distributorId);
      if (d) nodes.push(['Distributor', d.name]);
    }
    if (c.holdingId) { const h = byId(w.holdings, c.holdingId); nodes.push(['Holding', h.id + (h.openBreaks ? ', open break' : ''), !!h.openBreaks]); }
    const prov = c.providerId ? byId(w.providers, c.providerId) : null;
    if (prov) nodes.push(['Transfer agent', prov.name + ', ' + prov.region]);
    if (c.order) {
      const v = A.validateOrder(c.order, w);
      v.issues.forEach((x) => nodes.push(['Exception', x.code, true]));
    }
    if (c.gate) nodes.push(['Decision', VERDICT[c.gate.verdict][0], c.gate.verdict !== 'AUTO_EXECUTE']);
    return '<div class="graph">' + nodes.map((n) => '<span class="node' + (n[2] ? ' hot' : '') + '"><b>' + E(n[0]) + '</b>' + E(n[1]) + '</span>').join('<span class="link">—</span>') + '</div>';
  }

  // ---------- charts (inline SVG) ----------
  function ladderChart(lad) {
    const W = 720, H = 230, pad = { l: 56, r: 12, t: 14, b: 34 };
    const vals = lad.rows.map((r) => r.cash).concat(lad.rows.map((r) => r.net), [0]);
    const max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
    const span = (max - min) || 1;
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - min) / span);
    const bw = (W - pad.l - pad.r) / lad.rows.length;
    const scale = Math.abs(max) > 1e8 || Math.abs(min) > 1e8 ? 1e7 : 1e6;
    const unit = scale === 1e7 ? 'crore' : 'm';
    const fmtAxis = (v) => (v / scale).toFixed(0) + unit;
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Daily cash ladder">';
    [max, (max + min) / 2, min].forEach((v) => { s += '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--rule)"/><text x="' + (pad.l - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + fmtAxis(v) + '</text>'; });
    s += '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--ink-3)"/>';
    lad.rows.forEach((r, i) => {
      const x = pad.l + i * bw + bw * 0.2, w = bw * 0.6;
      const y0 = y(0), y1 = y(r.net);
      s += '<rect x="' + x + '" y="' + Math.min(y0, y1) + '" width="' + w + '" height="' + Math.max(1, Math.abs(y1 - y0)) + '" fill="' + (r.net >= 0 ? 'var(--auth)' : 'var(--deny)') + '" opacity="0.55"/>';
      s += '<text x="' + (x + w / 2) + '" y="' + (H - 12) + '" text-anchor="middle">' + r.date.slice(5) + '</text>';
    });
    const pts = lad.rows.map((r, i) => (pad.l + i * bw + bw / 2) + ',' + y(r.cash)).join(' ');
    s += '<polyline points="' + pts + '" fill="none" stroke="var(--ink)" stroke-width="2"/>';
    lad.rows.forEach((r, i) => { s += '<circle cx="' + (pad.l + i * bw + bw / 2) + '" cy="' + y(r.cash) + '" r="3.5" fill="' + (r.gap ? 'var(--deny)' : 'var(--ink)') + '"/>'; });
    return s + '</svg><div class="legend"><span><i style="background:var(--auth);opacity:.55"></i>Net inflow</span><span><i style="background:var(--deny);opacity:.55"></i>Net outflow</span><span><i style="background:var(--ink)"></i>Cash position (red point = overdrawn)</span></div>';
  }

  function agreementChart(rows, threshold) {
    const W = 720, rowH = 26, H = rows.length * rowH + 30, l = 190, r = 60;
    const x = (v) => l + (W - l - r) * v;
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Shadow agreement by process">';
    rows.forEach((row, i) => {
      const yy = 10 + i * rowH;
      s += '<text x="' + (l - 8) + '" y="' + (yy + 13) + '" text-anchor="end">' + E(row.label) + '</text>';
      s += '<rect x="' + l + '" y="' + yy + '" width="' + (x(row.match) - l) + '" height="16" rx="2" fill="' + (row.match >= threshold ? 'var(--auth)' : 'var(--human)') + '" opacity="0.7"/>';
      s += '<text x="' + (x(row.match) + 6) + '" y="' + (yy + 13) + '">' + T.fmtPct(row.match) + '</text>';
    });
    s += '<line x1="' + x(threshold) + '" x2="' + x(threshold) + '" y1="4" y2="' + (H - 18) + '" stroke="var(--ink)" stroke-dasharray="4 3"/><text x="' + x(threshold) + '" y="' + (H - 4) + '" text-anchor="middle">' + T.fmtPct(threshold, 0) + ' promotion threshold</text>';
    return s + '</svg>';
  }

  // ---------- views ----------
  function viewStory() {
    const st = state.story;
    const steps = st.steps.map((step, i) => {
      const status = st.status(i);
      const res = st.results[i];
      let body = '';
      if (status === 'ready') body += btn('Run this step', 'story-run', { i }, 'btn-primary');
      if (res) {
        if (res.alternative) {
          body += '<div class="case-card alt"><div class="case-head"><h3>Alternative the gate refused: ' + E(res.alternative.label) + '</h3>' + verdictChip('DENY') + '</div>' +
            gateVerdict(res.alternative.gate) + '<details><summary>Why it was refused</summary>' + gateRules(res.alternative.gate) + '</details><p class="small muted">Recorded as evidence entry ' + res.alternative.seq + '.</p></div>';
        }
        body += res.caseIds.map((id) => caseCard(state.cp.getCase(id))).join('');
        if (st.steps[i].id === 'liquidity') {
          const c = state.cp.getCase('NW-6');
          body += '<div class="panel" style="margin-top:12px"><h4 style="margin-top:0">Aurora cash ladder, T+1 rehearsal</h4>' + ladderChart(A.liquidityLadder(state.cp.world, 'F-AUR', 1, c.data.extraRedemption)) + '</div>';
        }
        if (st.steps[i].id === 'oversight') {
          const sc = A.scorecard(state.cp.world, 'STANDARD');
          const row = sc.rows.find((r) => r.metric.key === 'cutoffExceptions');
          body += '<div class="panel" style="margin-top:12px"><h4 style="margin-top:0">Cut-off exceptions per 1,000 orders, standard cohort</h4><table><tbody>' + row.cells.map((c) => '<tr><td>' + E(byId(state.cp.world.providers, c.providerId).name) + '</td><td class="num' + (c.flag ? ' flag' : '') + '">' + c.value.toFixed(2) + '</td><td class="num muted">' + c.ratio.toFixed(2) + '× median</td></tr>').join('') + '</tbody></table></div>';
        }
        if (res.custom) {
          body += '<div class="panel" style="margin-top:12px">' +
            '<div class="verdict ' + (res.verify.ok ? 'v-AUTO_EXECUTE' : 'v-DENY') + '">' + (res.verify.ok ? 'Evidence chain intact: ' + res.verify.count + ' linked entries' : 'Chain broken at entry ' + res.verify.brokenAt) + '<span class="sub">' + res.trail + ' entries belong to this story</span></div>' +
            '<div class="scroll-x" style="margin-top:10px"><table><thead><tr><th>Entry</th><th>Case</th><th>Capability</th><th>Recorded</th><th>Replayed</th><th>Match</th></tr></thead><tbody>' +
            res.replays.map((r) => '<tr><td class="mono">' + r.seq + '</td><td>' + E(r.caseId) + '</td><td><code>' + E(r.capability) + '</code></td><td>' + verdictChip(r.recorded) + '</td><td>' + verdictChip(r.replayed) + '</td><td>' + (r.match ? chip('Identical', 'auth') : chip('Differs', 'deny')) + '</td></tr>').join('') +
            '</tbody></table></div><p class="small muted" style="margin-top:8px">Replay re-runs the policy function on each stored proposal, controls snapshot and agent identity. ' + btn('Open the evidence ledger', 'nav', { view: 'evidence' }, 'btn-link') + '</p></div>';
        }
        res.notes.forEach((n) => { body += '<div class="note">' + E(n) + '</div>'; });
      }
      return '<li class="step step--' + status + '"><div class="step-num" aria-hidden="true">' + (i + 1) + '</div><div class="step-body"><h3>' + E(step.title) + '</h3><p>' + E(step.blurb) + '</p>' + body + '</div></li>';
    }).join('');
    const prog = st.steps.map((s, i) => '<span class="' + (st.status(i) === 'done' ? 'done' : st.status(i) === 'waiting' ? 'waiting' : '') + '"></span>').join('');
    return '<section class="hero"><h1>One investor, one unbroken audit trail</h1><p class="lede">Follow Northwind Pension Trust from application to redemption. Agents propose; a deterministic policy decides; people make the calls that are theirs to make; every step is evidence you can replay.</p>' +
      '<div class="progress" aria-label="Story progress">' + prog + '</div></section>' +
      (st.stopped ? '<div class="decision"><p>' + E(st.stopped) + '</p>' + btn('Reset the demo', 'reset', {}) + '</div>' : '') +
      '<ol class="story">' + steps + '</ol>';
  }

  function filteredCases() {
    const f = state.filter;
    return state.cp.world.cases.filter((c) => (f.domain === 'ALL' || c.domain === f.domain) &&
      (f.status === 'ALL' || (f.status === 'WAITING' ? (c.status === 'AWAITING_APPROVAL' || c.status === 'AWAITING_DECISION') : f.status === 'CLOSED' ? ['DENIED', 'REJECTED', 'OBSERVED'].includes(c.status) : c.status === f.status)));
  }

  function viewOps() {
    const cases = filteredCases();
    const all = state.cp.world.cases;
    const count = (pred) => all.filter(pred).length;
    const newCount = count((c) => c.status === 'NEW');
    const sel = state.selCase ? all.find((c) => c.id === state.selCase) : null;
    const opt = (v, label, cur) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + E(label) + '</option>';
    const queue = cases.length ? cases.map((c) => '<button class="qitem" data-act="sel-case" data-case="' + c.id + '" aria-current="' + (c.id === state.selCase) + '">' +
      '<div class="row" style="justify-content:space-between"><span class="t">' + E(c.title) + '</span>' + statusChip(c.status) + '</div>' +
      '<div class="m">' + E(c.id) + ', ' + E(processLabel(c.process)) + (c.gate ? ', ' + c.gate.levelCode : '') + '</div></button>').join('') : '<div class="empty">No cases match these filters.</div>';
    return '<div class="page-head"><h1>Ops workstation</h1><p>The operational queue across every transfer agent. Run the agents, then work the items that need a person.</p></div>' +
      '<div class="row" style="margin-bottom:14px">' + btn(newCount ? 'Run agents on ' + newCount + ' new case' + (newCount > 1 ? 's' : '') : 'No new cases', 'run-all', {}, 'btn-primary') +
      '<span class="small muted">Reasoner: ' + (state.reasoner.mode === 'claude' && state.reasoner.key ? 'Claude (' + E(state.reasoner.model) + ')' : 'deterministic') + '</span><span style="flex:1"></span>' +
      '<label class="field" style="flex-direction:row;align-items:center">Domain <select data-change="filter-domain">' + opt('ALL', 'All domains', state.filter.domain) + Object.keys(pack().domains).map((d) => opt(d, pack().domains[d], state.filter.domain)).join('') + '</select></label>' +
      '<label class="field" style="flex-direction:row;align-items:center">Status <select data-change="filter-status">' + opt('ALL', 'All', state.filter.status) + opt('NEW', 'New', state.filter.status) + opt('WAITING', 'Needs a person', state.filter.status) + opt('EXECUTED', 'Executed', state.filter.status) + opt('CLOSED', 'Refused or declined', state.filter.status) + '</select></label></div>' +
      '<div class="row small" style="margin-bottom:12px;gap:14px"><span>' + count((c) => c.status === 'EXECUTED') + ' executed</span><span>' + count((c) => c.status === 'AWAITING_APPROVAL' || c.status === 'AWAITING_DECISION') + ' need a person</span><span>' + count((c) => c.status === 'DENIED') + ' refused</span><span>' + newCount + ' new</span></div>' +
      '<div class="ops"><div class="panel queue" style="padding:0">' + queue + '</div><div>' + (sel ? caseDetail(sel) : '<div class="panel empty">Select a case to see its case graph, the agent’s proposal, the gate’s decision and the evidence.</div>') + '</div></div>';
  }

  function caseDetail(c) {
    const tabs = [['overview', 'Overview'], ['gate', 'Proposal and gate'], ['evidence', 'Evidence'], ['messages', 'Messages']];
    let body = '';
    if (state.caseTab === 'overview') {
      body = '<h4 style="margin-top:0">Case graph</h4><p class="small muted">The bounded context the agent receives. It never gets a free prompt.</p>' + caseGraph(c) +
        (c.status === 'NEW' ? '<div style="margin-top:14px">' + btn('Run agent on this case', 'run-case', { case: c.id }, 'btn-primary') + '</div>' : caseCard(c)) +
        (c.holdingId ? provenanceTable(byId(state.cp.world.holdings, c.holdingId)) : '');
    } else if (state.caseTab === 'gate') {
      body = c.proposal ? proposalBlock(c.proposal) + gateVerdict(c.gate) + gateRules(c.gate) + decisionBar(c) : '<div class="empty">The agent has not proposed anything yet.</div>';
    } else if (state.caseTab === 'evidence') {
      const entries = state.cp.ledger.forCase(c.id);
      body = entries.length ? entries.map(evidenceCard).join('') : '<div class="empty">No evidence yet. Run the agent first.</div>';
    } else {
      body = c.messages && c.messages.length ? c.messages.map((m, i) => '<div class="case-card"><div class="case-head"><h3>' + E(m.type) + ' ' + (m.direction === 'IN' ? 'received' : 'sent') + '</h3>' + (m.valid ? chip('All checks passed', 'auth') : chip('Failed checks', 'deny')) + '</div>' +
        '<details><summary>' + m.checks.length + ' structural and semantic checks</summary><ul class="facts">' + m.checks.map((k) => '<li>' + (k.pass ? 'Pass' : 'Fail') + ': ' + E(k.check) + '</li>').join('') + '</ul></details>' +
        '<div style="margin-top:8px">' + btn('View XML', 'view-msg', { case: c.id, i }) + '</div></div>').join('') + '<p class="small muted">Built by deterministic code from typed parameters. The model never writes a message.</p>' : '<div class="empty">No messages on this case.</div>';
    }
    return '<div class="panel"><div class="case-head"><h3>' + E(c.title) + '</h3>' + statusChip(c.status) + '</div><div class="small muted">' + E(c.id) + ', ' + E(processLabel(c.process)) + ', ' + E(pack().domains[c.domain]) + '</div>' +
      '<div class="tabs" role="tablist">' + tabs.map((t) => '<button role="tab" aria-selected="' + (state.caseTab === t[0]) + '" data-act="case-tab" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' + body + '</div>';
  }

  function evidenceCard(e) {
    const open = !!state.evOpen[e.seq];
    let head = '';
    if (e.kind === 'DECISION') head = (e.note ? E(e.note) + ': ' : '') + '<code>' + E(e.proposal.capability) + '</code> ' + verdictChip(e.gate.verdict);
    else if (e.kind === 'HUMAN_DECISION') head = E(roleName(e.actor.replace('HUMAN:', ''))) + ' ' + (e.decision === 'APPROVE' ? 'approved' : 'declined') + ' <code>' + E(e.capability) + '</code>';
    else if (e.kind === 'EXECUTION') head = '<code>' + E(e.capabilityCalled) + '</code> executed, authorised by ' + E(e.authorisedBy);
    else head = E(JSON.stringify(e.change));
    let detail = '';
    if (open) {
      detail = '<dl class="kv" style="margin-top:10px">' +
        '<dt>Actor</dt><dd>' + E(e.actor) + '</dd>' +
        (e.agent ? '<dt>Agent version</dt><dd>' + E(e.agent.id + ' ' + e.agent.version) + '</dd>' : '') +
        (e.model ? '<dt>Reasoner</dt><dd>' + E(e.model.reasoner + ' ' + e.model.version) + '</dd>' : '') +
        (e.policyVersion ? '<dt>Policy pack</dt><dd>' + E(e.policyVersion) + '</dd>' : '') +
        (e.promptVersion ? '<dt>Prompt version</dt><dd>' + E(e.promptVersion) + '</dd>' : '') +
        (e.confidence ? '<dt>Confidence</dt><dd>Prediction set of ' + e.confidence.setSize + ' at α=' + e.confidence.alpha + '</dd>' : '') +
        (e.controlsSnapshot && e.proposal ? '<dt>Autonomy dial</dt><dd>' + E(processLabel(e.proposal.process)) + ' at L' + e.controlsSnapshot.dials[e.proposal.process] + '</dd>' : '') +
        (e.sourceLineage && e.sourceLineage.length ? '<dt>Sources</dt><dd>' + e.sourceLineage.map((s) => E(s.source) + ' <span class="hash">' + E(s.ref) + '</span>').join('<br>') + '</dd>' : '') +
        (e.proposal && e.proposal.facts ? '<dt>Facts used</dt><dd>' + e.proposal.facts.map(E).join('<br>') + '</dd>' : '') +
        (e.inputSnapshotHash ? '<dt>Input snapshot</dt><dd class="hash">' + e.inputSnapshotHash + '</dd>' : '') +
        (e.requestHash ? '<dt>Request hash</dt><dd class="hash">' + e.requestHash + '</dd><dt>Response hash</dt><dd class="hash">' + e.responseHash + '</dd>' : '') +
        (e.response ? '<dt>Result</dt><dd>' + E(e.response) + '</dd>' : '') +
        '<dt>Entry hash</dt><dd class="hash">' + e.hash + '</dd><dt>Previous hash</dt><dd class="hash">' + e.prevHash + '</dd></dl>' +
        (e.gate ? '<details><summary>Gate rules as recorded</summary>' + gateRules(e.gate) + '</details>' : '');
    }
    return '<div class="case-card"><div class="case-head"><span><span class="ev-kind">' + e.kind + '</span> <span class="small muted">entry ' + e.seq + ', ' + E(e.at) + '</span></span></div><div style="margin-top:6px">' + head + '</div>' +
      '<button class="btn-link" style="margin-top:8px" data-act="ev-toggle" data-seq="' + e.seq + '">' + (open ? 'Hide evidence' : 'Why do you believe this?') + '</button>' + detail + '</div>';
  }

  function provenanceTable(h) {
    if (!h) return '';
    const inv = byId(state.cp.world.investors, h.investorId);
    const sc = byId(state.cp.world.shareClasses, h.shareClassId);
    return '<h4>Field-level provenance: units, ' + E(inv.name) + ', ' + E(sc.name) + '</h4><div class="scroll-x"><table><thead><tr><th>Source</th><th class="num">Value</th><th>Record</th><th>Effective</th><th>Received</th><th>Reconciliation</th><th>Quality</th><th>Authoritative</th></tr></thead><tbody>' +
      h.sources.map((s) => '<tr><td>' + E(s.source) + '</td><td class="num">' + T.fmtUnits(s.value) + '</td><td class="hash">' + E(s.recordRef.length > 24 ? s.recordRef.slice(0, 22) + '…' : s.recordRef) + '</td><td>' + E(s.effectiveAt) + '</td><td class="small">' + E(s.receivedAt.replace('T', ' ').replace('Z', '')) + '</td><td>' + (s.reconState === 'BREAK' ? chip('Break', 'deny') : chip('Matched', 'auth')) + '</td><td>' + E(s.quality) + '</td><td>' + (s.authoritative ? '<b>Yes</b>' : 'No') + '</td></tr>').join('') +
      '</tbody></table></div><p class="small muted">The platform never picks a winner silently. The provider register stays the book of record; other sources are shown beside it.</p>';
  }

  function viewRegister() {
    const w = state.cp.world;
    const tabs = '<div class="tabs" role="tablist"><button role="tab" aria-selected="' + (state.regTab === 'holdings') + '" data-act="reg-tab" data-tab="holdings">Holdings across TAs</button><button role="tab" aria-selected="' + (state.regTab === 'tokens') + '" data-act="reg-tab" data-tab="tokens">Tokenized share class</button></div>';
    const breaks = w.holdings.filter((h) => h.openBreaks).length;
    const head = '<div class="page-head"><h1>Federated register</h1><p>One manager-side view of holdings reported by every source, with provenance on every value. The transfer agent’s register remains the legal book of record.</p></div>' +
      '<div class="row small" style="gap:16px;margin-bottom:6px"><span>' + w.holdings.length + ' holdings</span><span>' + w.providers.length + ' transfer agents</span><span>' + w.holdings.reduce((a, h) => a + h.sources.length, 0) + ' source records</span><span>' + breaks + ' open breaks</span></div>';
    if (state.regTab === 'tokens') {
      const rows = w.wallets.map((wl) => { const inv = byId(w.investors, wl.investorId); const diff = wl.chainUnits - wl.registerUnits;
        return '<tr><td>' + E(inv.name) + '</td><td class="hash">' + wl.wallet.slice(0, 14) + '…</td><td class="num">' + wl.registerUnits.toLocaleString('en-GB') + '</td><td class="num">' + wl.chainUnits.toLocaleString('en-GB') + '</td><td class="num' + (diff ? ' flag' : '') + '">' + (diff > 0 ? '+' : '') + diff + '</td><td>' + (wl.whitelisted ? chip('Whitelisted', 'auth') : chip('Not whitelisted', 'deny')) + '</td></tr>'; }).join('');
      const hasCase = w.cases.find((c) => c.type === 'TOKEN_BREAK');
      return head + tabs + '<p>Aurora Global Equity Fund, Tokenized EUR share class. Register units against balances on the token ledger (simulated chain).</p><div class="panel scroll-x"><table><thead><tr><th>Investor</th><th>Wallet</th><th class="num">Register</th><th class="num">On chain</th><th class="num">Difference</th><th>Whitelist</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="small" style="margin-top:10px">One wallet holds tokens without being whitelisted: that is an eligibility breach, so it is a compliance matter, not something an agent repairs. ' + (hasCase ? btn('Open the reconciliation case', 'open-case', { case: hasCase.id }, 'btn-link') : '') + '</p>';
    }
    const sel = state.selHolding ? byId(w.holdings, state.selHolding) : null;
    const rows = w.holdings.filter((h) => !h.id.startsWith('H-T')).map((h) => {
      const inv = byId(w.investors, h.investorId), sc = byId(w.shareClasses, h.shareClassId), prov = byId(w.providers, h.provider);
      return '<tr class="clickable' + (sel && sel.id === h.id ? ' selected' : '') + '" data-act="sel-holding" data-h="' + h.id + '"><td>' + E(inv.name) + '</td><td>' + E(byId(w.funds, sc.fundId).name.replace(' Fund', '')) + ', ' + E(sc.name) + '</td><td>' + E(prov.name) + '</td><td class="num">' + T.fmtUnits(h.sources[0].value) + '</td><td>' + (h.openBreaks ? chip('Break', 'deny') : chip('Matched', 'auth')) + '</td></tr>';
    }).join('');
    return head + tabs + '<div class="grid-2"><div class="panel scroll-x" style="max-height:70vh;overflow:auto;padding:0"><table><thead><tr><th>Investor</th><th>Fund and class</th><th>TA</th><th class="num">Register units</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="panel">' + (sel ? provenanceTable(sel) : '<div class="empty">Select a holding to see every source that reports it.</div>') + '</div></div>';
  }

  function viewLiquidity() {
    const w = state.cp.world;
    const fund = byId(w.funds, state.liqFund);
    const lad = A.liquidityLadder(w, state.liqFund, state.liqCycle);
    const gc = A.gateCalc(w);
    const gateCase = w.cases.find((c) => c.type === 'GATE');
    const fundOpts = ['F-AUR', 'F-MER', 'F-SAF'].map((id) => '<option value="' + id + '"' + (id === state.liqFund ? ' selected' : '') + '>' + E(byId(w.funds, id).name) + '</option>').join('');
    return '<div class="page-head"><h1>Liquidity and gates</h1><p>Rehearse the EU and UK move to T+1 settlement on 11 Oct 2027, and work the semi-liquid fund’s quarterly gate.</p></div>' +
      '<div class="panel"><div class="row" style="justify-content:space-between"><label class="field" style="flex-direction:row;align-items:center">Fund <select data-change="liq-fund">' + fundOpts + '</select></label>' +
      '<div class="seg" role="group" aria-label="Underlying settlement cycle"><button aria-pressed="' + (state.liqCycle === 2) + '" data-act="liq-cycle" data-c="2">Today: T+2</button><button aria-pressed="' + (state.liqCycle === 1) + '" data-act="liq-cycle" data-c="1">From 11 Oct 2027: T+1</button></div></div>' +
      '<p class="small muted" style="margin-top:10px">Trades are placed the day after dealing. Purchases and sales settle on the underlying cycle; subscription cash and redemption payouts follow the fund’s T+' + fund.settleDays + ' cycle. Opening buffer ' + T.fmtMoney(lad.buffer, lad.ccy) + '.</p>' +
      ladderChart(lad) +
      '<div class="verdict ' + (lad.gapDays ? 'v-DENY' : 'v-AUTO_EXECUTE') + '">' + (lad.gapDays ? 'Overdrawn on ' + lad.gapDays + ' day' + (lad.gapDays > 1 ? 's' : '') + ', from ' + lad.firstGap : 'No funding gap in this window') + (lad.gapDays ? '<span class="sub">Largest shortfall ' + T.fmtMoney(lad.maxShortfall, lad.ccy) + '</span>' : '') + '</div>' +
      (lad.gapDays ? '<div style="margin-top:10px">' + btn('Ask the liquidity agent for a funding plan', 'raise-liquidity', { fund: state.liqFund }) + '</div>' : '') + '</div>' +
      '<h2>Kestrel Evergreen Private Credit Fund: Q4 gate</h2><div class="panel"><dl class="kv"><dt>Dealing date</dt><dd>' + w.semiLiquid.dealingDate + ' (notice deadline ' + w.semiLiquid.noticeDeadline + ')</dd><dt>NAV</dt><dd>' + T.fmtMoney(w.semiLiquid.nav, 'EUR') + '</dd><dt>Gate</dt><dd>' + T.fmtPct(w.semiLiquid.gatePct, 0) + ' of NAV: ' + T.fmtMoney(gc.capacity, 'EUR') + '</dd><dt>Requested</dt><dd>' + T.fmtMoney(gc.requested, 'EUR') + '</dd><dt>Pro-rata payout</dt><dd><b>' + T.fmtPct(gc.proRata) + '</b></dd></dl>' +
      '<div class="scroll-x" style="margin-top:12px"><table><thead><tr><th>Investor</th><th>Notice received</th><th class="num">Requested</th><th class="num">Paid this quarter</th><th class="num">Deferred</th></tr></thead><tbody>' +
      gc.allocations.map((a) => '<tr><td>' + E(byId(w.investors, a.investorId).name) + '</td><td>' + a.noticeReceived + '</td><td class="num">' + T.fmtMoney(a.requested) + '</td><td class="num">' + T.fmtMoney(a.paid) + '</td><td class="num">' + T.fmtMoney(a.deferred) + '</td></tr>').join('') +
      '</tbody></table></div><p class="small" style="margin-top:10px">Applying a gate is a fiduciary determination (R4). The agent computes and recommends; the board decides. ' + (gateCase ? btn('Open the gate case', 'open-case', { case: gateCase.id }, 'btn-link') : '') + '</p></div>';
  }

  function viewControl() {
    const p = pack();
    const gov = p.governanceRoles.includes(state.role);
    const ks = p.killSwitchRoles.includes(state.role);
    const dialRows = Object.keys(p.processes).map((k) => {
      const ceil = A.processCeiling(p, k);
      const cur = state.cp.controls.dials[k];
      return '<tr><td>' + E(p.processes[k].label) + '</td><td class="small muted">' + E(p.domains[p.processes[k].domain]) + '</td><td><select data-change="dial" data-process="' + k + '"' + (gov ? '' : ' disabled') + '>' +
        [0, 1, 2, 3, 4].map((l) => '<option value="' + l + '"' + (l === cur ? ' selected' : '') + '>L' + l + ' ' + E(p.autonomyLevels[l].name) + '</option>').join('') + '</select></td><td class="small">' + (cur > ceil ? 'Capped at L' + ceil + ' by risk ceilings' : 'Highest any capability allows: L' + ceil) + '</td></tr>';
    }).join('');
    const killRows = Object.keys(p.domains).map((d) => { const on = state.cp.controls.killSwitches[d];
      return '<tr><td>' + E(p.domains[d]) + '</td><td>' + (on ? chip('Frozen', 'deny') : chip('Live', 'auth')) + '</td><td>' + btn(on ? 'Unfreeze' : 'Freeze', 'kill', { domain: d, on: on ? '0' : '1' }, on ? '' : 'btn-decline') + '</td></tr>'; }).join('');
    const agents = Object.values(state.cp.agents).map((a) => '<tr><td><code>' + E(a.id) + '</code></td><td>' + E(a.name) + '</td><td>' + E(a.version) + '</td><td>L' + a.maxAutonomy + '</td><td class="small">' + a.entitlements.map((e) => '<code>' + E(e) + '</code>').join(' ') + '</td></tr>').join('');
    const rc = Object.keys(p.riskClasses).map((k) => '<tr><td>' + riskTag(k) + '</td><td>' + E(p.riskClasses[k].name) + '</td><td class="small">' + E(p.riskClasses[k].covers) + '</td><td>L' + p.riskClasses[k].ceiling + ' ' + E(p.autonomyLevels[p.riskClasses[k].ceiling].name) + '</td></tr>').join('');
    return '<div class="page-head"><h1>Control plane</h1><p>Autonomy is set per process and capped by risk class. Only Compliance changes autonomy; Operations and Compliance can freeze a domain. Every change is written to the evidence ledger.</p></div>' +
      (gov ? '' : '<div class="note" style="margin-bottom:14px">You are acting as ' + E(roleName(state.role)) + ', so autonomy settings are read-only. ' + btn('Act as Compliance', 'switch-role', { role: 'COMPLIANCE' }, 'btn-link') + '</div>') +
      '<h2 style="margin-top:0">Policy sandbox</h2>' + sandbox() +
      '<h2>Autonomy by process</h2><div class="panel scroll-x"><table><thead><tr><th>Process</th><th>Domain</th><th>Dial</th><th>Ceiling</th></tr></thead><tbody>' + dialRows + '</tbody></table></div>' +
      '<div class="grid-2" style="margin-top:14px"><div class="panel"><h3>Kill switches</h3><table><tbody>' + killRows + '</tbody></table>' + (ks ? '' : '<p class="small muted" style="margin-top:8px">Your role cannot use kill switches.</p>') + '</div>' +
      '<div class="panel"><h3>Calibrated confidence</h3><p class="small">Miscoverage α for the conformal prediction sets. Lower α means larger sets and more escalation of ambiguous cases.</p><label class="field">α <select data-change="alpha"' + (gov ? '' : ' disabled') + '>' + [0.01, 0.05, 0.1, 0.2].map((a) => '<option value="' + a + '"' + (a === state.cp.controls.alpha ? ' selected' : '') + '>' + a + '</option>').join('') + '</select></label></div></div>' +
      '<h2>Action risk classes</h2><div class="panel scroll-x"><table><thead><tr><th>Class</th><th>Name</th><th>Covers</th><th>Ceiling</th></tr></thead><tbody>' + rc + '</tbody></table></div>' +
      '<h2>Agent identities</h2><div class="panel scroll-x"><table><thead><tr><th>Identity</th><th>Agent</th><th>Version</th><th>Max</th><th>Entitlements</th></tr></thead><tbody>' + agents + '</tbody></table></div>' +
      '<h2>Policy rules, in evaluation order</h2><div class="panel"><table><tbody>' + p.rules.map((r) => '<tr><td class="gate-id">' + r.id + '</td><td><span class="chip chip-plain">' + r.effect + '</span></td><td>' + E(r.text) + '</td></tr>').join('') + '</tbody></table>' +
      '<div style="margin-top:12px">' + btn('Download policy pack ' + p.version + ' (JSON)', 'download-pack', {}) + '</div></div>';
  }

  function sandbox() {
    const s = state.sandbox;
    const p = pack();
    const sel = (name, options, cur) => '<select data-change="sandbox" data-k="' + name + '">' + options.map((o) => '<option value="' + E(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + E(o[1]) + '</option>').join('') + '</select>';
    const proposal = {
      caseId: 'SANDBOX', agentId: s.agentId, capability: s.capability, process: s.process, origin: s.origin,
      params: s.capability === 'AMEND_DEALING_DATE' ? { newDealingDate: s.backdate === 'yes' ? '2026-10-07' : '2026-10-08', earliestPermittedDealingDate: '2026-10-08' } : {},
      conformal: { setSize: Number(s.setSize), alpha: state.cp.controls.alpha, qhat: 0.4 },
      dataAuthority: s.data === 'auth' ? { authoritative: true, openBreaks: 0 } : s.data === 'break' ? { authoritative: true, openBreaks: 1 } : { authoritative: false, openBreaks: 0 }
    };
    const g = state.cp.dryRun(proposal);
    return '<div class="panel"><p class="small">Build any proposal and watch the policy decide. Nothing here is recorded.</p><div class="form-grid">' +
      '<label class="field">Agent' + sel('agentId', Object.values(state.cp.agents).map((a) => [a.id, a.name]).concat([['AGENT:UNKNOWN', 'Unregistered agent']]), s.agentId) + '</label>' +
      '<label class="field">Capability' + sel('capability', Object.keys(p.capabilities).map((k) => [k, p.capabilities[k].risk + ' ' + p.capabilities[k].label]), s.capability) + '</label>' +
      '<label class="field">Process' + sel('process', Object.keys(p.processes).map((k) => [k, p.processes[k].label]), s.process) + '</label>' +
      '<label class="field">Prediction set size' + sel('setSize', [['0', '0 (no confident candidate)'], ['1', '1 (one candidate)'], ['2', '2 (ambiguous)']], s.setSize) + '</label>' +
      '<label class="field">Data authority' + sel('data', [['auth', 'Authoritative, no breaks'], ['break', 'Authoritative, open break'], ['non', 'Not authoritative']], s.data) + '</label>' +
      '<label class="field">Origin' + sel('origin', [['AGENT_REASONING', 'Agent reasoning over facts'], ['UNTRUSTED_CONTENT', 'Instruction inside a document']], s.origin) + '</label>' +
      (s.capability === 'AMEND_DEALING_DATE' ? '<label class="field">New dealing date' + sel('backdate', [['no', 'Next dealing date'], ['yes', 'Earlier date (backdate)']], s.backdate) + '</label>' : '') +
      '</div>' + gateVerdict(g) + gateRules(g) + '</div>';
  }

  function viewEvidence() {
    const v = state.cp.ledger.verify();
    const entries = state.cp.ledger.entries.slice().reverse();
    const rows = entries.slice(0, 250).map((e) => {
      let what = '';
      if (e.kind === 'DECISION') what = '<code>' + E(e.proposal.capability) + '</code> ' + verdictChip(e.gate.verdict) + (e.note ? ' <span class="small muted">' + E(e.note) + '</span>' : '');
      else if (e.kind === 'HUMAN_DECISION') what = E(roleName(e.actor.replace('HUMAN:', ''))) + ' ' + (e.decision === 'APPROVE' ? 'approved' : 'declined');
      else if (e.kind === 'EXECUTION') what = '<code>' + E(e.capabilityCalled) + '</code> by ' + E(e.authorisedBy);
      else what = E(e.change.type.replace(/_/g, ' ').toLowerCase()) + ': ' + E(JSON.stringify(Object.assign({}, e.change, { type: undefined })));
      const rp = state.replays[e.seq];
      const rpCell = e.kind === 'DECISION' ? (rp ? (rp.replayable ? (rp.match ? chip('Identical', 'auth') : chip('Differs', 'deny')) : '<span class="small">' + E(rp.reason) + '</span>') : btn('Replay', 'replay', { seq: e.seq })) : '';
      return '<tr class="' + (!v.ok && v.brokenAt === e.seq ? 'broken' : '') + '"><td class="mono">' + e.seq + '</td><td class="small">' + E(e.at.slice(5, 16).replace('T', ' ')) + '</td><td><span class="ev-kind">' + e.kind + '</span></td><td>' + E(e.caseId || '—') + '</td><td>' + what + '</td><td class="hash">' + T.shortHash(e.hash) + '</td><td>' + rpCell + '</td></tr>';
    }).join('');
    return '<div class="page-head"><h1>Evidence and replay</h1><p>Every proposal, verdict, human decision, execution and governance change is an envelope, hash-chained to the one before it. Replay re-runs the policy on the stored inputs.</p></div>' +
      '<div class="panel"><div class="verdict ' + (v.ok ? 'v-AUTO_EXECUTE' : 'v-DENY') + '">' + (v.ok ? 'Chain intact: ' + v.count + ' entries verified' : 'Chain broken at entry ' + v.brokenAt + '. ' + v.reason) + '</div>' +
      '<div class="row" style="margin-top:12px">' + btn('Replay every decision', 'replay-all', {}, 'btn-primary') +
      (state.tamper ? btn('Restore the edited entry', 'restore', {}) : btn('Simulate an edit to a past decision', 'tamper', {}, 'btn-decline')) +
      btn('Download ledger (JSON)', 'download-ledger', {}) + '</div>' +
      (state.tamper ? '<p class="small" style="margin-top:10px">Entry ' + state.tamper.seq + ' had its recorded verdict changed after the fact. Verification now fails at that entry, and every later link depends on it.</p>' : '') + '</div>' +
      (entries.length ? '<div class="panel scroll-x" style="margin-top:14px;padding:0"><table><thead><tr><th>#</th><th>Time</th><th>Kind</th><th>Case</th><th>What</th><th>Hash</th><th>Replay</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="panel empty" style="margin-top:14px">The ledger is empty. Run the story or the agents to create evidence.</div>');
  }

  function viewShadow() {
    const rows = A.shadowAssessment(state.cp.world, pack(), state.cp.controls.dials);
    const P = A.PROMOTION;
    const gov = pack().governanceRoles.includes(state.role);
    return '<div class="page-head"><h1>Shadow mode</h1><p>For four weeks the agents watched real work without acting. This compares their recommendations with what people actually did, process by process, and recommends where autonomy can rise.</p></div>' +
      '<div class="panel">' + agreementChart(rows, P.minMatch) + '</div>' +
      '<div class="panel scroll-x" style="margin-top:14px"><table><thead><tr><th>Process</th><th class="num">Cases</th><th class="num">Same resolution</th><th class="num">Material disagreement</th><th class="num">Agent caught first</th><th class="num">False escalation</th><th>Now</th><th>Recommendation</th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td>' + E(r.label) + '</td><td class="num">' + r.n.toLocaleString('en-GB') + '</td><td class="num">' + T.fmtPct(r.match) + '</td><td class="num">' + T.fmtPct(r.dis) + '</td><td class="num">' + T.fmtPct(r.agentFirst) + '</td><td class="num">' + T.fmtPct(r.fe) + '</td><td>L' + r.current + '</td><td>' +
        (r.recommendation === 'PROMOTE' ? chip('Promote to L' + r.target, 'auth') + ' ' + (gov ? btn('Promote', 'promote', { process: r.process, to: r.target }) : '') : r.recommendation === 'REVIEW' ? chip('Review', 'deny') : chip('Hold', 'plain')) +
        '<div class="small muted">' + E(r.reason) + '</div></td></tr>').join('') + '</tbody></table></div>' +
      '<p class="small muted" style="margin-top:10px">Promotion needs at least ' + P.minCases + ' cases, ' + T.fmtPct(P.minMatch, 0) + ' agreement, at most ' + T.fmtPct(P.maxDisagree, 0) + ' material disagreement and ' + T.fmtPct(P.maxFalseEsc, 0) + ' false escalation. Risk-class ceilings still apply after promotion.' + (gov ? '' : ' Only Compliance can promote.') + '</p>';
  }

  function viewOversight() {
    const w = state.cp.world;
    const sc = A.scorecard(w, state.cohort);
    const head = '<tr><th>Metric</th>' + w.providers.map((p) => '<th class="num">' + E(p.name) + '<div class="small muted" style="font-weight:400">' + E(p.region) + '</div></th>').join('') + '<th class="num">Peer median</th></tr>';
    const rows = sc.rows.map((r) => '<tr><td>' + E(r.metric.label) + '</td>' + r.cells.map((c) => '<td class="num' + (c.flag ? ' flag' : '') + '">' + r.metric.fmt(c.value) + (c.flag ? '<div class="small">' + c.ratio.toFixed(2) + '×</div>' : '') + '</td>').join('') + '<td class="num muted">' + r.metric.fmt(r.median) + '</td></tr>').join('');
    return '<div class="page-head"><h1>Cross-TA oversight</h1><p>The same metrics, normalised across every transfer agent and compared within like-for-like complexity cohorts. No single provider can produce this view of itself.</p></div>' +
      '<div class="row" style="margin-bottom:12px"><div class="seg" role="group" aria-label="Cohort"><button aria-pressed="' + (state.cohort === 'STANDARD') + '" data-act="cohort" data-c="STANDARD">Standard cases</button><button aria-pressed="' + (state.cohort === 'COMPLEX') + '" data-act="cohort" data-c="COMPLEX">Complex cases</button></div>' + btn('Download oversight pack (Markdown)', 'download-oversight', {}) + '</div>' +
      '<div class="panel scroll-x"><table><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
      '<h2>Findings, more than 25% worse than the peer median</h2><div class="panel">' + (sc.findings.length ? '<table><tbody>' + sc.findings.map((f) => '<tr><td>' + E(byId(w.providers, f.providerId).name) + '</td><td>' + E(f.label) + '</td><td class="num">' + f.ratio.toFixed(2) + '× median</td><td>' + btn('Raise a finding case', 'raise-finding', { p: f.providerId, m: f.metric, c: f.cohort }) + '</td></tr>').join('') + '</tbody></table>' : '<div class="empty">No provider is outside tolerance in this cohort.</div>') + '</div>' +
      (w.findings.length ? '<h2>Published findings</h2><div class="panel"><ul class="facts">' + w.findings.map((f) => '<li>' + E(byId(w.providers, f.providerId).name) + ': ' + E(f.metric) + ' at ' + f.ratio + '× median (' + E(f.cohort.toLowerCase()) + ')</li>').join('') + '</ul></div>' : '');
  }

  function viewTrust() {
    const w = state.cp.world;
    const doc = byId(w.documents, state.docId);
    const res = A.trustBoundary(doc, state.cp.ctx());
    const flagged = new Set(res.instructions.map((x) => x.line));
    const text = doc.text.split('\n').map((l, i) => (flagged.has(i) ? '<mark>' + E(l) + '</mark>' : E(l))).join('\n');
    const opts = w.documents.map((d) => '<option value="' + d.id + '"' + (d.id === doc.id ? ' selected' : '') + '>' + E(d.title) + '</option>').join('');
    const suite = state.suite;
    return '<div class="page-head"><h1>Trust boundary</h1><p>Documents, emails and distributor files supply data, never authority. Text that tries to instruct the system is extracted, flagged and refused at the gate.</p></div>' +
      '<div class="panel"><label class="field" style="max-width:420px">Document <select data-change="doc">' + opts + '</select></label><p class="small muted" style="margin-top:8px">' + E(doc.kind) + '</p><div class="doc-text">' + text + '</div></div>' +
      '<div class="grid-3" style="margin-top:14px">' +
      '<div class="panel"><h3>1. Facts extracted</h3><p class="small muted">Schema fields only.</p><dl class="kv">' + res.facts.map((f) => '<dt>' + E(f.field) + '</dt><dd>' + E(f.value) + '</dd>').join('') + '</dl></div>' +
      '<div class="panel"><h3>2. Instructions flagged</h3><p class="small muted">Detection is for visibility. It is not the control.</p>' + (res.instructions.length ? '<ul class="facts">' + res.instructions.map((x) => '<li>' + E(x.intent) + '</li>').join('') + '</ul>' : '<p class="small">None detected.</p>') + '</div>' +
      '<div class="panel"><h3>3. What the gate did</h3><p class="small muted">Each implied action, proposed as if the document had authority.</p>' + (res.attempts.length ? res.attempts.map((a) => '<div style="margin-bottom:10px"><code>' + E(a.proposal.capability) + '</code> ' + verdictChip(a.gate.verdict) + '<div class="small muted">' + a.gate.rules.filter((r) => r.result === 'DENY').map((r) => r.id).join(', ') + '</div></div>').join('') : '<p class="small">No action implied.</p>') + '</div></div>' +
      '<h2>Injection test suite</h2><div class="panel"><p class="small">Twelve hostile payloads run through the same pipeline. A payload passes the test when no action is authorised, whether or not the detector noticed it.</p>' + btn('Run the suite', 'run-suite', {}, 'btn-primary') +
      (suite ? '<div class="verdict ' + (suite.every((s) => s.pass) ? 'v-AUTO_EXECUTE' : 'v-DENY') + '" style="margin-top:12px">' + suite.filter((s) => s.pass).length + ' of ' + suite.length + ' payloads authorised nothing<span class="sub">' + suite.filter((s) => s.detected).length + ' were also flagged by the detector</span></div><div class="scroll-x" style="margin-top:10px"><table><thead><tr><th>Payload</th><th>Flagged</th><th class="num">Implied actions</th><th>Result</th></tr></thead><tbody>' +
        suite.map((s) => '<tr><td class="small">' + E(s.payload) + '</td><td>' + (s.detected ? 'Yes' : 'No') + '</td><td class="num">' + s.attempts + '</td><td>' + (s.pass ? chip('Nothing authorised', 'auth') : chip('Authorised', 'deny')) + '</td></tr>').join('') + '</tbody></table></div>' : '') + '</div>';
  }

  function viewCompliance() {
    const p = pack();
    const map = [
      ['Singapore agentic AI framework (Jan 2026)', 'Bound agent powers upfront', 'Risk classes, process dials, agent entitlements', 'control'],
      ['Singapore agentic AI framework (Jan 2026)', 'Define human checkpoints', 'L1 and L2 verdicts with named deciding roles', 'ops'],
      ['Singapore agentic AI framework (Jan 2026)', 'Control tool and data access', 'Typed capabilities, per-agent allow-lists, data-authority rule', 'control'],
      ['Singapore agentic AI framework (Jan 2026)', 'Keep users informed', 'Decision evidence behind every answer', 'evidence'],
      ['EU AI Act', 'Logging, human oversight, traceability', 'Hash-chained envelopes, replay, kill switches', 'evidence'],
      ['DORA', 'ICT risk and resilience', 'Deterministic workflows keep running without a model; domain kill switches', 'control'],
      ['DORA', 'Exit and portability', 'Policy pack and full ledger export as JSON', 'evidence'],
      ['SEBI circular, 9 May 2019', 'Quarterly reporting of AI/ML applications by mutual funds', 'Register below, generated from agent identities', 'compliance'],
      ['Security', 'Prompt injection through documents', 'R-UNTRUSTED-ORIGIN and the injection test suite', 'trust']
    ];
    const reg = Object.values(state.cp.agents).map((a) => '<tr><td>' + E(a.name) + ' <code>' + E(a.id) + '</code></td><td class="small">' + E(p.domains[a.domain]) + ' cases</td><td class="small">Deterministic reasoning; calibrated confidence (split conformal); optional language-model rationale</td><td>L' + a.maxAutonomy + '</td><td class="small">Policy gate on every action; R4 decisions by people; evidence and replay</td></tr>').join('');
    const circ = state.cp.world.circulars.map((c) => '<tr><td class="small"><code>' + E(c.id) + '</code></td><td>' + E(c.title) + '<div class="small muted">' + E(c.regulator) + '</div></td><td class="small">' + c.processes.map((x) => E(processLabel(x)) + ' (L' + state.cp.controls.dials[x] + ')').join(', ') + '</td><td class="small">' + c.capabilities.map((x) => '<code>' + x + '</code>').join(' ') + '</td></tr>').join('');
    return '<div class="page-head"><h1>Compliance map</h1><p>Where each expectation is met in the product, so an auditor can go straight to the evidence.</p></div>' +
      '<div class="panel scroll-x"><table><thead><tr><th>Framework</th><th>Expectation</th><th>Control in this product</th><th></th></tr></thead><tbody>' + map.map((m) => '<tr><td class="small">' + E(m[0]) + '</td><td>' + E(m[1]) + '</td><td>' + E(m[2]) + '</td><td>' + btn('Open', 'nav', { view: m[3] }, 'btn-link') + '</td></tr>').join('') + '</tbody></table></div>' +
      '<h2>AI/ML application register (draft)</h2><div class="panel scroll-x"><table><thead><tr><th>Application</th><th>Purpose</th><th>Technique</th><th>Max autonomy</th><th>Oversight</th></tr></thead><tbody>' + reg + '</tbody></table>' +
      '<p class="small muted" style="margin-top:8px">Draft layout generated from the agent registry. Map the fields to the circular’s reporting form before filing.</p>' + btn('Download register (CSV)', 'download-register', {}) + '</div>' +
      '<h2>Regulatory watch</h2><div class="panel scroll-x"><p class="small">Illustrative circulars, mapped to the processes and capabilities they touch, with the autonomy each process runs at today.</p><table><thead><tr><th>Reference</th><th>Topic</th><th>Processes (autonomy)</th><th>Capabilities</th></tr></thead><tbody>' + circ + '</tbody></table></div>';
  }

  function viewSettings() {
    const r = state.reasoner;
    return '<div class="page-head"><h1>Settings</h1><p>The model is a replaceable dependency. Without one, every agent runs on deterministic reasoning and the whole product still works.</p></div>' +
      '<div class="panel"><h3>Reasoner</h3><div class="seg" role="group" aria-label="Reasoner"><button aria-pressed="' + (r.mode === 'deterministic') + '" data-act="reasoner" data-m="deterministic">Deterministic</button><button aria-pressed="' + (r.mode === 'claude') + '" data-act="reasoner" data-m="claude">Claude (your API key)</button></div>' +
      (r.mode === 'claude' ? '<div class="form-grid" style="margin-top:12px"><label class="field">Anthropic API key<input type="password" autocomplete="off" data-change="api-key" value="' + E(r.key) + '" placeholder="sk-ant-…"></label><label class="field">Model<input data-change="model" value="' + E(r.model) + '"></label></div>' +
        '<p class="small muted" style="margin-top:8px">The key stays in this browser tab’s memory and is sent only to api.anthropic.com. Claude writes the rationale and can disagree with the top candidate; it cannot choose capabilities, set parameters or authorise anything. The Ops workstation uses it; the Story always runs deterministically.</p>' + btn('Test connection', 'test-claude', {}) : '') + '</div>' +
      '<div class="panel"><h3>Demo data</h3><p class="small">Everything is generated from a fixed seed. Names, ISINs, LEIs and figures are fictional.</p>' + btn('Reset the demo', 'reset', {}, 'btn-decline') + '</div>' +
      '<div class="panel"><h3>About</h3><p class="small">Agentic TA Control Plane is an open-source demonstration of a manager-owned control layer above transfer agents. It is not affiliated with any company named in the accompanying research. Message structures follow ISO 20022 naming but are not certified against the official schemas.</p></div>';
  }

  // ---------- shell ----------
  function render() {
    const root = document.getElementById('app');
    if (!root || !state.cp) return;
    const v = state.cp.ledger.verify();
    const view = { story: viewStory, ops: viewOps, register: viewRegister, liquidity: viewLiquidity, control: viewControl, shadow: viewShadow, trust: viewTrust, evidence: viewEvidence, oversight: viewOversight, compliance: viewCompliance, settings: viewSettings }[state.view] || viewStory;
    let groups = '';
    let last = '';
    VIEWS.forEach((x) => { if (x.group !== last) { groups += '<div class="nav-group">' + E(x.group) + '</div>'; last = x.group; } groups += '<button data-act="nav" data-view="' + x.id + '"' + (x.id === state.view ? ' aria-current="page"' : '') + '>' + E(x.label) + '</button>'; });
    const roles = Object.keys(pack().roles).map((r) => '<option value="' + r + '"' + (r === state.role ? ' selected' : '') + '>' + E(roleName(r)) + '</option>').join('');
    let html;
    try { html = view(); } catch (err) { html = '<div class="panel"><h3>Something went wrong rendering this view</h3><p class="small">' + E(err.message) + '</p>' + btn('Reset the demo', 'reset', {}) + '</div>'; console.error(err); }
    root.innerHTML = '<div class="app"><aside class="side"><div class="brand"><div class="brand-name">TA Control Plane</div><div class="brand-sub">Manager-owned data, decisions and automation across every transfer agent</div></div><nav class="nav" aria-label="Sections">' + groups + '</nav></aside>' +
      '<div class="main"><div class="topbar"><div><b>TA Control Plane</b> <span class="small muted">synthetic data</span></div><span class="spacer"></span><label>Acting as <select data-change="role">' + roles + '</select></label>' +
      '<span class="chain"><span class="dot' + (v.ok ? '' : ' bad') + '"></span>' + (v.ok ? 'Evidence chain intact (' + v.count + ')' : 'Evidence chain broken') + '</span></div>' +
      '<nav class="mobile-nav" aria-label="Sections">' + VIEWS.map((x) => '<button data-act="nav" data-view="' + x.id + '"' + (x.id === state.view ? ' aria-current="page"' : '') + '>' + E(x.label) + '</button>').join('') + '</nav>' +
      '<main class="content">' + html + '</main></div></div>' +
      (state.modal ? '<div class="modal-back" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true" aria-label="' + E(state.modal.title) + '"><div class="modal-head"><h3 style="margin:0">' + E(state.modal.title) + '</h3>' + btn('Close', 'close-modal', {}) + '</div>' + state.modal.body + '</div></div>' : '') +
      (state.toast ? '<div class="toast" role="status">' + E(state.toast) + '</div>' : '');
  }

  function toast(msg) { state.toast = msg; render(); clearTimeout(toast.t); toast.t = setTimeout(() => { state.toast = null; render(); }, 3600); }
  function download(name, text, type) {
    try {
      const blob = new Blob([text], { type: type || 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { toast('Download is not available here.'); }
  }
  function go(view) { state.view = view; if (location.hash !== '#/' + view) history.replaceState(null, '', '#/' + view); render(); window.scrollTo(0, 0); }

  async function claudeRationale(proposal, c) {
    const r = state.reasoner;
    const body = {
      model: r.model, max_tokens: 400,
      system: 'You are a transfer agency operations analyst. Choose exactly one candidate label from the list and explain the choice in at most two sentences. You cannot invent actions or parameters. Reply with JSON only: {"choice":"<label>","rationale":"<text>"}',
      messages: [{ role: 'user', content: JSON.stringify({ case: { type: c.type, title: c.title, facts: proposal.facts || [] }, candidates: proposal.candidates.map((x) => x.label) }) }]
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': r.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('Claude API returned ' + res.status);
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').replace(/```json|```/g, '').trim();
    const out = JSON.parse(text);
    const p = T.clone(proposal);
    p.reasonerName = 'claude:' + r.model; p.reasonerVersion = r.model;
    const agrees = out.choice === proposal.label;
    p.rationale = String(out.rationale || '').slice(0, 600) + (agrees ? '' : ' Model preferred "' + out.choice + '"; the calibrated top candidate stands and the gate decides.');
    return p;
  }

  async function runCase(id) {
    const cp = state.cp;
    let p = cp.propose(id);
    if (state.reasoner.mode === 'claude' && state.reasoner.key) {
      try { p = await claudeRationale(p, cp.getCase(id)); } catch (e) { toast('Claude unavailable (' + e.message + '). Used deterministic reasoning.'); }
    }
    cp.gate(id, p);
  }

  // ---------- actions ----------
  const ACT = {
    nav: (d) => go(d.view),
    'story-run': (d) => { state.story.run(Number(d.i)); render(); },
    decide: (d) => {
      try { state.cp.decide(d.case, state.role, d.d); state.story.refresh(); render(); }
      catch (e) { toast(e.message); }
    },
    'switch-role': (d) => { state.role = d.role; toast('Now acting as ' + roleName(d.role) + '.'); },
    'sel-case': (d) => { state.selCase = d.case; state.caseTab = 'overview'; render(); },
    'open-case': (d) => { state.selCase = d.case; state.caseTab = 'overview'; state.filter = { domain: 'ALL', status: 'ALL' }; go('ops'); },
    'case-tab': (d) => { state.caseTab = d.tab; render(); },
    'run-case': async (d) => { await runCase(d.case); render(); },
    'run-all': async () => {
      const ids = state.cp.world.cases.filter((c) => c.status === 'NEW').map((c) => c.id);
      for (const id of ids) await runCase(id); // eslint-disable-line no-await-in-loop
      toast(ids.length ? 'Agents processed ' + ids.length + ' case' + (ids.length > 1 ? 's' : '') + '.' : 'No new cases.');
    },
    'view-msg': (d) => { const m = state.cp.getCase(d.case).messages[Number(d.i)]; state.modal = { title: m.type + ' ' + (m.direction === 'IN' ? 'received' : 'sent'), body: '<p class="small muted">' + E(m.namespace) + '</p><pre class="xml">' + E(m.xml) + '</pre>' }; render(); },
    'close-modal': (d, el, ev) => { if (ev && el.classList.contains('modal-back') && ev.target !== el) return; state.modal = null; render(); },
    'ev-toggle': (d) => { state.evOpen[d.seq] = !state.evOpen[d.seq]; render(); },
    'reg-tab': (d) => { state.regTab = d.tab; render(); },
    'sel-holding': (d) => { state.selHolding = d.h; render(); },
    'liq-cycle': (d) => { state.liqCycle = Number(d.c); render(); },
    'raise-liquidity': (d) => {
      const c = state.cp.addCase({ id: 'LQ-' + String(state.cp.world.cases.length + 1).padStart(3, '0'), type: 'LIQUIDITY', process: 'LIQUIDITY', domain: 'OPERATIONS', title: byId(state.cp.world.funds, d.fund).name + ' T+1 funding plan', fundId: d.fund, providerId: byId(state.cp.world.funds, d.fund).provider, data: {} });
      state.cp.run(c.id); state.selCase = c.id; state.caseTab = 'overview'; go('ops');
    },
    kill: (d) => { try { state.cp.setKillSwitch(d.domain, d.on === '1', state.role); } catch (e) { toast(e.message); } },
    promote: (d) => { try { state.cp.setDial(d.process, Number(d.to), state.role); toast(processLabel(d.process) + ' promoted to L' + d.to + '. Recorded as evidence.'); } catch (e) { toast(e.message); } },
    replay: (d) => { const e = state.cp.ledger.entries[Number(d.seq)]; state.replays[d.seq] = T.replay(e, pack()); render(); },
    'replay-all': () => {
      let n = 0, ok = 0;
      state.cp.ledger.entries.forEach((e) => { if (e.kind === 'DECISION') { const r = T.replay(e, pack()); state.replays[e.seq] = r; n++; if (r.match) ok++; } });
      toast(n ? ok + ' of ' + n + ' decisions replayed identically.' : 'No decisions to replay yet.');
    },
    tamper: () => {
      const target = state.cp.ledger.entries.find((e) => e.kind === 'DECISION' && e.gate.verdict !== 'AUTO_EXECUTE');
      if (!target) { toast('Run some cases first so there is a decision to edit.'); return; }
      state.tamper = { seq: target.seq, original: T.clone(target) };
      target.gate.verdict = 'AUTO_EXECUTE';
      render();
    },
    restore: () => { if (!state.tamper) return; state.cp.ledger.entries[state.tamper.seq] = state.tamper.original; state.tamper = null; render(); },
    cohort: (d) => { state.cohort = d.c; render(); },
    'raise-finding': (d) => {
      const c = state.cp.addCase({ id: 'OV-' + String(state.cp.world.cases.length + 1).padStart(3, '0'), type: 'OVERSIGHT', process: 'OVERSIGHT', domain: 'OVERSIGHT', title: byId(state.cp.world.providers, d.p).name + ': ' + d.m + ' above peers', providerId: d.p, data: { metric: d.m, cohort: d.c } });
      state.cp.run(c.id); state.selCase = c.id; state.caseTab = 'overview'; go('ops');
    },
    'run-suite': () => { state.suite = A.runInjectionSuite(state.cp.ctx()); render(); },
    reasoner: (d) => { state.reasoner.mode = d.m; render(); },
    'test-claude': async () => {
      if (!state.reasoner.key) { toast('Add an API key first.'); return; }
      try {
        const cp = state.cp; const c = cp.world.cases.find((x) => x.type === 'ORDER');
        const p = await claudeRationale(cp.propose(c.id), c);
        toast('Connected. Sample rationale: ' + p.rationale.slice(0, 140));
      } catch (e) { toast('Connection failed: ' + e.message); }
    },
    reset: () => { reset(); toast('Demo reset.'); go('story'); },
    'download-pack': () => download('policy-pack-' + pack().version + '.json', JSON.stringify(pack(), null, 2), 'application/json'),
    'download-ledger': () => download('evidence-ledger.json', JSON.stringify(state.cp.ledger.entries, null, 2), 'application/json'),
    'download-register': () => {
      const rows = [['Application', 'Identity', 'Version', 'Domain', 'Technique', 'Max autonomy', 'Oversight']].concat(Object.values(state.cp.agents).map((a) => [a.name, a.id, a.version, pack().domains[a.domain], 'Deterministic reasoning; split conformal confidence; optional LLM rationale', 'L' + a.maxAutonomy, 'Policy gate; R4 by people; evidence and replay']));
      download('ai-ml-application-register.csv', rows.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n'), 'text/csv');
    },
    'download-oversight': () => {
      const w = state.cp.world;
      let md = '# Transfer agent oversight pack\n\nGenerated ' + state.cp.now() + ' from normalised provider metrics (synthetic data).\n';
      ['STANDARD', 'COMPLEX'].forEach((co) => {
        const sc = A.scorecard(w, co);
        md += '\n## ' + co.charAt(0) + co.slice(1).toLowerCase() + ' cohort\n\n| Metric | ' + w.providers.map((p) => p.name).join(' | ') + ' | Median |\n|---|' + w.providers.map(() => '---|').join('') + '---|\n';
        sc.rows.forEach((r) => { md += '| ' + r.metric.label + ' | ' + r.cells.map((c) => r.metric.fmt(c.value) + (c.flag ? ' ⚑' : '')).join(' | ') + ' | ' + r.metric.fmt(r.median) + ' |\n'; });
        md += '\nFindings: ' + (sc.findings.length ? sc.findings.map((f) => byId(w.providers, f.providerId).name + ' ' + f.label + ' ' + f.ratio.toFixed(2) + '× median').join('; ') : 'none') + '\n';
      });
      download('oversight-pack.md', md, 'text/markdown');
    }
  };

  const CHANGE = {
    role: (v) => { state.role = v; render(); },
    'filter-domain': (v) => { state.filter.domain = v; render(); },
    'filter-status': (v) => { state.filter.status = v; render(); },
    'liq-fund': (v) => { state.liqFund = v; render(); },
    dial: (v, el) => { try { state.cp.setDial(el.dataset.process, Number(v), state.role); } catch (e) { toast(e.message); } },
    alpha: (v) => { try { state.cp.setAlpha(Number(v), state.role); } catch (e) { toast(e.message); } },
    sandbox: (v, el) => { state.sandbox[el.dataset.k] = v; render(); },
    doc: (v) => { state.docId = v; render(); },
    'api-key': (v) => { state.reasoner.key = v.trim(); },
    model: (v) => { state.reasoner.model = v.trim() || 'claude-sonnet-5-5'; }
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const fn = ACT[el.dataset.act];
    if (!fn) return;
    if (el.dataset.act === 'close-modal' && el.classList.contains('modal-back') && ev.target !== el) return;
    Promise.resolve(fn(el.dataset, el, ev)).catch((e) => { console.error(e); toast(e.message); });
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-change]');
    if (!el) return;
    const fn = CHANGE[el.dataset.change];
    if (fn) fn(el.value, el);
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && state.modal) { state.modal = null; render(); } });
  window.addEventListener('hashchange', () => { const v = location.hash.replace('#/', ''); if (VIEWS.some((x) => x.id === v) && v !== state.view) { state.view = v; render(); } });

  reset();
  const initial = location.hash.replace('#/', '');
  if (VIEWS.some((x) => x.id === initial)) state.view = initial;
  render();
  window.TACP_APP = { state, render, reset };
})();
