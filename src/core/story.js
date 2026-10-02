/* The demo is one investor's story, run through the real control plane:
 * investor → order → exception → control → settlement → oversight → audit. */
(function (g) {
  'use strict';
  const T = (g.TACP = g.TACP || {});

  const INV = 'INV-NW01';
  const WAITING = ['AWAITING_APPROVAL', 'AWAITING_DECISION'];
  const DOCS = ['Trust deed', 'Register of trustees', 'UBO declaration', 'UBO proof of address', 'Tax self-certification (W-8BEN-E)', 'Authorised signatory list'];

  const STEPS = [
    { id: 'pack', title: 'A subscription pack arrives', blurb: 'Northwind Pension Trust applies to invest €25m in the Aurora Global Equity Fund. The lifecycle agent reads the pack and finds two documents missing.' },
    { id: 'screening', title: 'Screening finds a politically exposed person', blurb: 'With the pack complete, screening matches one trustee to a PEP list. The agent records the hit as a fact and recommends; compliance decides.' },
    { id: 'account', title: 'The account opens and the subscription deals', blurb: 'Once compliance accepts, the account-opening instruction needs operations approval. The subscription then arrives as a clean order.' },
    { id: 'late', title: 'Weeks later, a redemption misses the cut-off', blurb: 'A redemption of 60,000 units arrives at 14:02:31 against a 14:00 cut-off. The agent proposes the next dealing date; dealing it today would be backdating.' },
    { id: 'liquidity', title: 'The T+1 rehearsal shows a funding gap', blurb: 'The liquidity agent rebuilds Aurora’s cash ladder with the redemption included. Under the T+1 cycle that starts in the EU and UK on 11 Oct 2027, purchases for heavy subscriptions settle a day before the subscription cash arrives, and the buffer runs out.' },
    { id: 'oversight', title: 'Oversight sees the provider pattern', blurb: 'This was not a one-off. Provider A’s cut-off exceptions run at about twice its peers’ rate in the standard cohort.' },
    { id: 'audit', title: 'An auditor replays every decision', blurb: 'The auditor verifies the evidence chain and re-runs the policy on every recorded decision in this story.' }
  ];

  class Story {
    constructor(cp) { this.cp = cp; this.results = []; this.stopped = null; }
    get steps() { return STEPS; }
    status(i) {
      if (i < this.results.length) return this.results[i].complete ? 'done' : 'waiting';
      if (this.stopped) return 'locked';
      if (i === this.results.length && (i === 0 || this.results[i - 1].complete)) return 'ready';
      return 'locked';
    }
    caseOf(i) { return this.results[i] ? this.results[i].caseIds.map((id) => this.cp.getCase(id)) : []; }

    run(i) {
      if (this.status(i) !== 'ready') throw new Error('Step ' + (i + 1) + ' is not ready.');
      const fn = this['step_' + STEPS[i].id];
      const res = Object.assign({ caseIds: [], notes: [], complete: false }, fn.call(this));
      this.results.push(res);
      this.refresh();
      return res;
    }

    refresh() {
      this.results.forEach((r, i) => {
        const cases = r.caseIds.map((id) => this.cp.getCase(id));
        if (cases.some((c) => c.status === 'REJECTED')) {
          r.complete = true;
          this.stopped = this.stopped || 'A decision in step ' + (i + 1) + ' was declined, so the story ends here. Reset to run it again.';
          return;
        }
        if (r.after && !r.afterDone && cases.length && cases[0].status === 'EXECUTED') { r.afterDone = true; r.after.call(this, r); }
        r.complete = !r.custom && r.caseIds.map((id) => this.cp.getCase(id)).every((c) => !WAITING.includes(c.status)) && (!r.after || r.afterDone);
        if (r.custom) r.complete = true;
      });
    }

    step_pack() {
      const cp = this.cp;
      cp.setClock(T.BUSINESS_DATE + 'T08:12:00Z');
      const c = cp.addCase({ id: 'NW-1', type: 'ONBOARDING', process: 'ONBOARDING', domain: 'LIFECYCLE', title: 'Northwind Pension Trust — application pack', investorId: INV, story: true,
        data: { docsRequired: DOCS, docsProvided: DOCS.filter((d) => d !== 'UBO proof of address' && d !== 'Tax self-certification (W-8BEN-E)'), screening: 'NOT_RUN' } });
      cp.run(c.id);
      return { caseIds: [c.id], notes: ['Two days later, both documents arrive and the pack is complete.'] };
    }

    step_screening() {
      const cp = this.cp;
      cp.setClock('2026-10-09T09:30:00Z');
      const c = cp.addCase({ id: 'NW-2', type: 'ONBOARDING', process: 'ONBOARDING', domain: 'LIFECYCLE', title: 'Northwind Pension Trust — screening result', investorId: INV, story: true,
        data: { docsRequired: DOCS, docsProvided: DOCS.slice(), screening: 'PEP_MATCH', hitDetail: 'trustee M. de Vries matches a PEP list (former municipal councillor)',
          edd: ['Source of wealth: member pension contributions (documented)', 'Board minutes approving the investment', 'Adverse media check: none found'] } });
      cp.run(c.id);
      return { caseIds: [c.id] };
    }

    step_account() {
      const cp = this.cp;
      const decision = cp.ledger.entries.filter((e) => e.caseId === 'NW-2' && e.kind === 'HUMAN_DECISION').pop();
      const c = cp.addCase({ id: 'NW-3', type: 'ACCOUNT_OPEN', process: 'ACCOUNT_MAINTENANCE', domain: 'LIFECYCLE', title: 'Northwind Pension Trust — open account', investorId: INV, story: true,
        data: { currency: 'EUR', kycDecisionRef: decision ? 'EVIDENCE-' + decision.seq : 'n/a' } });
      cp.run(c.id);
      return {
        caseIds: [c.id],
        after(r) {
          const inv = cp.world.investors.find((x) => x.id === INV);
          const sc = cp.world.shareClasses.find((s) => s.id === 'F-AUR-I');
          cp.setClock('2026-10-12T08:41:09Z');
          const order = { orderRef: 'SB-40712', side: 'SUB', investorId: INV, accountId: inv.accountId, shareClassId: sc.id, isin: sc.isin, instrumentName: 'Aurora Global Equity Fund Institutional EUR',
            currency: 'EUR', amount: 25000000, receivedLocal: '2026-10-12T10:41:09', distributorId: 'D-HX', provider: 'TA-A', fundId: 'F-AUR', tz: 'Luxembourg time' };
          const inbound = T.messages.build('setr.010', { msgId: 'HX-ORD-88120', createdAt: cp.now(), accountId: order.accountId, orderRef: order.orderRef, isin: order.isin, instrumentName: order.instrumentName, amount: order.amount, currency: 'EUR' });
          const oc = cp.addCase({ id: 'NW-4', type: 'ORDER', process: 'DEALING', domain: 'DEALING', title: 'Northwind subscription €25m', investorId: INV, fundId: 'F-AUR', providerId: 'TA-A', order, story: true,
            messages: [Object.assign({ direction: 'IN', at: cp.now() }, inbound)] });
          cp.run(oc.id);
          r.caseIds.push(oc.id);
        }
      };
    }

    step_late() {
      const cp = this.cp;
      const inv = cp.world.investors.find((x) => x.id === INV);
      const sc = cp.world.shareClasses.find((s) => s.id === 'F-AUR-I');
      cp.setClock('2026-10-28T13:02:31Z');
      const order = { orderRef: 'RD-98271', side: 'RED', investorId: INV, accountId: inv.accountId, shareClassId: sc.id, isin: sc.isin, instrumentName: 'Aurora Global Equity Fund Institutional EUR',
        currency: 'EUR', units: 60000, receivedLocal: '2026-10-28T14:02:31', distributorId: 'D-HX', provider: 'TA-A', fundId: 'F-AUR', tz: 'Luxembourg time' };
      const inbound = T.messages.build('setr.004', { msgId: 'HX-ORD-90455', createdAt: cp.now(), accountId: order.accountId, orderRef: order.orderRef, isin: order.isin, instrumentName: order.instrumentName, units: order.units });
      const c = cp.addCase({ id: 'NW-5', type: 'ORDER', process: 'DEALING', domain: 'DEALING', title: 'Northwind redemption RD-98271', investorId: INV, fundId: 'F-AUR', providerId: 'TA-A', order, story: true,
        messages: [Object.assign({ direction: 'IN', at: cp.now() }, inbound)] });
      const proposal = cp.propose(c.id);
      // The gate also evaluates the backdating alternative, so the refusal is on the record.
      const alt = proposal.candidates.find((x) => x.label.indexOf('Deal today') === 0);
      const altParams = Object.assign({}, proposal.params, { newDealingDate: order.receivedLocal.slice(0, 10) });
      const altProposal = Object.assign({}, proposal, { capability: alt.capability, params: altParams, label: alt.label });
      const altResult = cp.gate(c.id, altProposal, { alternative: true, note: 'Alternative candidate evaluated: deal today' });
      cp.gate(c.id, proposal);
      return { caseIds: [c.id], alternative: { label: alt.label, gate: altResult.gate, seq: altResult.entry.seq } };
    }

    step_liquidity() {
      const cp = this.cp;
      const nav = cp.world.shareClasses.find((s) => s.id === 'F-AUR-I').nav;
      const c = cp.addCase({ id: 'NW-6', type: 'LIQUIDITY', process: 'LIQUIDITY', domain: 'OPERATIONS', title: 'Aurora T+1 funding gap rehearsal', fundId: 'F-AUR', providerId: 'TA-A', story: true,
        data: { extraRedemption: { date: '2026-10-29', amount: Math.round(60000 * nav) } } });
      cp.run(c.id);
      return { caseIds: [c.id] };
    }

    step_oversight() {
      const cp = this.cp;
      const c = cp.addCase({ id: 'NW-7', type: 'OVERSIGHT', process: 'OVERSIGHT', domain: 'OVERSIGHT', title: 'Provider A cut-off exceptions above peers', providerId: 'TA-A', story: true,
        data: { metric: 'cutoffExceptions', cohort: 'STANDARD' } });
      cp.run(c.id);
      return { caseIds: [c.id] };
    }

    step_audit() {
      const cp = this.cp;
      const ids = new Set(['NW-1', 'NW-2', 'NW-3', 'NW-4', 'NW-5', 'NW-6', 'NW-7']);
      const verify = cp.ledger.verify();
      const replays = cp.ledger.entries.filter((e) => ids.has(e.caseId) && e.kind === 'DECISION').map((e) => {
        const rp = T.replay(e, cp.pack);
        return { seq: e.seq, caseId: e.caseId, capability: e.proposal.capability, recorded: e.gate.verdict, replayed: rp.replayed ? rp.replayed.verdict : '—', match: rp.match };
      });
      const trail = cp.ledger.entries.filter((e) => ids.has(e.caseId)).length;
      return { caseIds: [], custom: true, verify, replays, trail };
    }
  }

  T.Story = Story;
  T.STORY_STEPS = STEPS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
