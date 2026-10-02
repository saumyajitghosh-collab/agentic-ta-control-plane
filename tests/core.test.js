// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./load.js');

const T = loadCore();

test('SHA-256 matches published test vectors', () => {
  assert.equal(T.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(T.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(T.sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('ISIN check digits validate and generated ISINs are valid', () => {
  assert.equal(T.validIsin('US0378331005'), true);
  assert.equal(T.validIsin('US0378331006'), false);
  const r = T.rng(7);
  for (let i = 0; i < 200; i++) assert.equal(T.validIsin(T.makeIsin('LU', r)), true);
});

test('split conformal quantile follows ceil((n+1)(1-alpha))', () => {
  const scores = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  assert.equal(T.conformal.qhat(scores, 0.2), 0.9);
  assert.equal(T.conformal.qhat(scores, 0.01), Infinity);
  const set = T.conformal.predictionSet([{ p: 0.95 }, { p: 0.3 }], 0.4);
  assert.equal(set.length, 1);
});

test('policy invariants hold across 20,000 fuzzed proposals', () => {
  const pack = T.POLICY_PACK;
  const r = T.rng(424242);
  const agentIds = Object.keys(T.AGENTS).concat(['AGENT:ROGUE']);
  const caps = Object.keys(pack.capabilities);
  const procs = Object.keys(pack.processes);
  for (let i = 0; i < 20000; i++) {
    const agentId = r.pick(agentIds);
    const capability = r.pick(caps);
    const process = r.pick(procs);
    const setSize = r.pick([0, 1, 1, 1, 2]);
    const origin = r.chance(0.1) ? 'UNTRUSTED_CONTENT' : 'AGENT_REASONING';
    const dials = Object.fromEntries(procs.map((p) => [p, r.int(0, 4)]));
    const killSwitches = Object.fromEntries(Object.keys(pack.domains).map((d) => [d, r.chance(0.05)]));
    const backdate = r.chance(0.3);
    const proposal = {
      agentId, capability, process, origin,
      params: capability === 'AMEND_DEALING_DATE' ? { newDealingDate: backdate ? '2026-10-07' : '2026-10-08', earliestPermittedDealingDate: '2026-10-08' } : {},
      conformal: { setSize, alpha: 0.05, qhat: 0.4 },
      dataAuthority: r.chance(0.2) ? { authoritative: true, openBreaks: 1 } : { authoritative: true, openBreaks: 0 }
    };
    const g = T.evaluate(proposal, { pack, controls: { dials, killSwitches, alpha: 0.05 }, agents: T.AGENTS });
    const cap = pack.capabilities[capability];
    const agent = T.AGENTS[agentId];
    const domain = pack.processes[process].domain;

    if (!agent || !agent.entitlements.includes(capability)) assert.equal(g.verdict, 'DENY', 'unentitled must be denied');
    if (origin === 'UNTRUSTED_CONTENT') assert.equal(g.verdict, 'DENY', 'untrusted origin must be denied');
    if (killSwitches[domain]) assert.equal(g.verdict, 'DENY', 'frozen domain must deny');
    if (capability === 'AMEND_DEALING_DATE' && backdate) assert.equal(g.verdict, 'DENY', 'backdating must be denied');
    if (g.verdict === 'DENY') continue;

    assert.ok(g.level <= pack.riskClasses[cap.risk].ceiling, 'never above risk ceiling');
    assert.ok(g.level <= dials[process], 'never above process dial');
    assert.ok(g.level <= agent.maxAutonomy, 'never above agent maximum');
    if (cap.risk === 'R4') assert.ok(g.level <= 1, 'R4 is always decided by a person');
    if (setSize !== 1) assert.ok(g.level <= 1, 'ambiguous confidence escalates');
    if (proposal.dataAuthority.openBreaks) assert.ok(g.level <= 1, 'open breaks escalate');
    if (cap.makerChecker) assert.ok(g.level <= 2, 'maker-checker never auto-executes');

    // Confidence can lower autonomy but never raise it.
    const without = T.evaluate(Object.assign({}, proposal, { conformal: { setSize: 1, alpha: 0.05, qhat: 0.4 } }), { pack, controls: { dials, killSwitches, alpha: 0.05 }, agents: T.AGENTS });
    assert.ok(g.level <= without.level, 'a worse confidence result never yields more autonomy');
  }
});

test('evidence chain verifies, detects tampering and replays identically', () => {
  const cp = new T.ControlPlane();
  cp.runAll();
  assert.equal(cp.ledger.verify().ok, true);
  const decisions = cp.ledger.entries.filter((e) => e.kind === 'DECISION');
  assert.ok(decisions.length > 10);
  decisions.forEach((e) => assert.equal(T.replay(e, cp.pack).match, true, 'replay of entry ' + e.seq));
  const victim = decisions[3];
  const original = T.clone(victim);
  victim.gate.verdict = 'AUTO_EXECUTE';
  const v = cp.ledger.verify();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, victim.seq);
  cp.ledger.entries[victim.seq] = original;
  assert.equal(cp.ledger.verify().ok, true);
});

test('human decisions require the right role', () => {
  const cp = new T.ControlPlane();
  cp.runAll();
  const kyc = cp.world.cases.find((c) => c.proposal && c.proposal.capability === 'ACCEPT_INVESTOR_KYC');
  assert.equal(kyc.status, 'AWAITING_DECISION');
  assert.throws(() => cp.decide(kyc.id, 'OPS', 'APPROVE'), /cannot decide/);
  cp.decide(kyc.id, 'COMPLIANCE', 'APPROVE');
  assert.equal(kyc.status, 'EXECUTED');
  assert.throws(() => cp.setDial('DEALING', 4, 'OPS'), /cannot change autonomy/);
});

test('governance changes are evidenced and change outcomes', () => {
  const cp = new T.ControlPlane();
  cp.setKillSwitch('DEALING', true, 'OPS');
  const late = cp.world.cases.find((c) => c.process === 'DEALING');
  const res = cp.run(late.id);
  assert.equal(res.gate.verdict, 'DENY');
  assert.ok(cp.ledger.entries.some((e) => e.kind === 'GOVERNANCE_CHANGE' && e.change.type === 'KILL_SWITCH'));
});

test('message builders validate structure and semantics', () => {
  const ok = T.messages.build('setr.010', { msgId: 'M1', createdAt: '2026-10-07T10:00:00Z', accountId: 'ACC-1', orderRef: 'SB-1', isin: 'US0378331005', instrumentName: 'Test', amount: 1000, currency: 'EUR' });
  assert.equal(ok.valid, true);
  assert.match(ok.xml, /<SbcptOrdr>/);
  const bad = T.messages.build('setr.010', { msgId: 'M2', createdAt: '2026-10-07T10:00:00Z', accountId: 'ACC-1', orderRef: 'SB-2', isin: 'US0378331006', instrumentName: 'Test', amount: 1000, currency: 'EUR' });
  assert.equal(bad.valid, false, 'a well-formed message with a wrong ISIN must still fail');
  const sts = T.messages.build('setr.016', { msgId: 'S1', createdAt: '2026-10-07T10:00:00Z', relatedRef: 'SB-1', relatedMsg: 'setr.010.001.04', orderRef: 'SB-1', status: 'PACK' });
  assert.equal(sts.valid, true);
});

test('the seven-step story completes and every decision replays', () => {
  const cp = new T.ControlPlane();
  const s = new T.Story(cp);
  s.run(0); s.run(1); cp.decide('NW-2', 'COMPLIANCE', 'APPROVE'); s.refresh();
  s.run(2); cp.decide('NW-3', 'OPS', 'APPROVE'); s.refresh();
  const late = s.run(3);
  assert.equal(late.alternative.gate.verdict, 'DENY');
  assert.ok(late.alternative.gate.rules.some((r) => r.id === 'R-NO-BACKDATING' && r.result === 'DENY'));
  cp.decide('NW-5', 'OPS', 'APPROVE'); s.refresh();
  s.run(4); cp.decide('NW-6', 'OPS', 'APPROVE'); s.refresh();
  s.run(5); cp.decide('NW-7', 'OPS', 'APPROVE'); s.refresh();
  const audit = s.run(6);
  assert.equal(audit.verify.ok, true);
  assert.ok(audit.replays.length >= 7);
  assert.ok(audit.replays.every((r) => r.match));
  assert.equal(cp.getCase('NW-5').order.dealingDate, '2026-10-29');
});

test('T+1 rehearsal opens a funding gap that T+2 does not', () => {
  const cp = new T.ControlPlane();
  const t2 = T.analytics.liquidityLadder(cp.world, 'F-AUR', 2);
  const t1 = T.analytics.liquidityLadder(cp.world, 'F-AUR', 1);
  assert.equal(t2.gapDays, 0);
  assert.ok(t1.gapDays > 0);
});

test('every injection payload authorises nothing', () => {
  const cp = new T.ControlPlane();
  const results = T.analytics.runInjectionSuite(cp.ctx());
  assert.equal(results.length, 12);
  assert.ok(results.every((r) => r.pass));
});

test('the synthetic world is deterministic for a seed', () => {
  const a = T.sha256(T.canonicalJSON(T.buildWorld(20261001)));
  const b = T.sha256(T.canonicalJSON(T.buildWorld(20261001)));
  const c = T.sha256(T.canonicalJSON(T.buildWorld(1)));
  assert.equal(a, b);
  assert.notEqual(a, c);
});
