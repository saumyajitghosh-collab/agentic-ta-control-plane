/* Entitlements — what a visitor may do without paying.
 *
 *   FREE     Explore the whole control model on synthetic data: the Story, every
 *            read-only view, and the policy sandbox (dry-run).
 *   OPERATOR Run it: agents on the operational queue, human decisions on real cases,
 *            governance changes (autonomy dials, kill switches, alpha), shadow-mode
 *            promotion, every export, and the Claude reasoner.
 *
 * The first 30 days of Operator are free, tied to the device (not the account), so a
 * new account on the same device does not restart the clock.
 *
 * IMPORTANT: this is a client-side gate on a static site. It is a clear "what is paid"
 * signal and a deterrent, not a security boundary — anyone can read the source and
 * call the unlock. A real paywall needs server-side payment verification. See
 * docs/BILLING.md for the Razorpay path that does that properly.
 */
(function (g) {
  'use strict';

  var DAY = 86400000;
  var TRIAL_DAYS = 30;
  var OWNER_EMAIL = 'saumyajit.ghosh@gmail.com';

  var K = {
    did: 'tacp_did', anc: 'tacp_anc', paid: 'tacp_paid_until',
    users: 'tacp_users', session: 'tacp_session', prefs: 'tacp_prefs'
  };

  // ---- plans (single source of truth for the app and pricing.html) ----
  var PLANS = [
    { id: 'monthly', name: 'Operator', tag: 'Monthly', price: 2999, period: '/ month', days: 30,
      note: 'Full operator access, billed monthly.' },
    { id: 'yearly', name: 'Operator', tag: 'Yearly', price: 29999, period: '/ year', days: 365,
      badge: 'Save 17%', note: 'Everything in Monthly. Works out at \u20b92,500/month.' }
  ];

  // ---- payment endpoints ----
  // Razorpay payment page: one link takes UPI and cards, so it covers India and abroad.
  // Set razorpayAmountParam to true only if your page accepts ?amount=<rupees> to pre-fill.
  var PAY = {
    upi: '9836296103@upi',
    razorpay: 'https://razorpay.me/@saumyajitghosh8959',
    razorpayAmountParam: false,
    supportEmail: 'saumyajit.ghosh@gmail.com'
  };

  // Actions that need the Operator tier.
  var PREMIUM_ACTIONS = [
    'run-case', 'run-all',              // operate the queue
    'kill', 'promote',                  // governance changes
    'raise-liquidity', 'raise-finding', // create new cases
    'download-pack', 'download-ledger', 'download-register', 'download-oversight',
    'reasoner', 'test-claude'           // bring your own model
  ];
  // Governance selects that need the tier.
  var PREMIUM_CHANGES = ['dial', 'alpha'];
  // `decide` is free inside the guided Story (it drives the tour); paid on your own cases.

  // ---- storage helpers ----
  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }
  function lsj(k, d) { try { return JSON.parse(ls(k) || 'null') || d; } catch (e) { return d; } }

  // ---- device marker (localStorage x2 + cookie; earliest wins) ----
  function readM(k) { try { return JSON.parse(ls(k) || 'null'); } catch (e) { return null; } }
  function writeM(ts) {
    var v = JSON.stringify({ t: ts });
    ls(K.did, v); ls(K.anc, v);
    try { document.cookie = 'tacp_v=' + encodeURIComponent(v) + ';max-age=315360000;path=/;SameSite=Lax'; } catch (e) {}
  }
  function cookieM() {
    try { var m = document.cookie.match(/(?:^|;\s*)tacp_v=([^;]+)/); return m ? JSON.parse(decodeURIComponent(m[1])) : null; }
    catch (e) { return null; }
  }
  function deviceTs() {
    var cands = [readM(K.did), readM(K.anc), cookieM()].filter(function (x) { return x && x.t; }).map(function (x) { return x.t; });
    if (!cands.length) { writeM(Date.now()); return Date.now(); }
    return Math.min.apply(null, cands);
  }
  function deviceTrialEnd() { return deviceTs() + TRIAL_DAYS * DAY; }

  // ---- plan state ----
  function users() { return lsj(K.users, {}); }
  function session() { return lsj(K.session, null); }

  function state() {
    var now = Date.now();
    var paidUntil = parseInt(ls(K.paid, '0'), 10) || 0;
    var ses = session();
    var acct = ses && ses.uid ? users()[ses.uid] : null;
    var plan = 'free', entitled = false, daysLeft = 0, trial = false, owner = false;

    if (acct && acct.plan === 'owner') {
      entitled = true; owner = true; plan = 'owner'; daysLeft = -1;
    } else {
      var until = Math.max((acct && acct.planExpires) || 0, paidUntil);
      if (until > now) {
        entitled = true; plan = 'operator'; daysLeft = Math.max(0, Math.ceil((until - now) / DAY));
      } else if (deviceTrialEnd() > now) {
        entitled = true; plan = 'trial'; trial = true;
        daysLeft = Math.max(0, Math.ceil((deviceTrialEnd() - now) / DAY));
      }
    }
    return { plan: plan, entitled: entitled, daysLeft: daysLeft, trial: trial, owner: owner,
      deviceTrialEnd: deviceTrialEnd(), trialDays: TRIAL_DAYS, user: acct ? acct.email : null };
  }

  // ---- gating ----
  function isPremiumAction(action) { return PREMIUM_ACTIONS.indexOf(action) !== -1; }
  function isPremiumChange(kind) { return PREMIUM_CHANGES.indexOf(kind) !== -1; }

  // Returns { allowed, reason }. `ctx` may carry { storyCase: true } for the guided tour.
  function gate(action, ctx) {
    var st = state();
    if (st.entitled) return { allowed: true, state: st };
    if (action === 'decide' && ctx && ctx.storyCase) return { allowed: true, state: st };
    if (!isPremiumAction(action)) return { allowed: true, state: st };
    return { allowed: false, reason: 'premium', state: st };
  }

  function subscribeUrl(planId) {
    var p = PLANS.filter(function (x) { return x.id === planId; })[0] || PLANS[0];
    if (!PAY.razorpay) return null;
    return PAY.razorpay + (PAY.razorpayAmountParam ? '?amount=' + p.price : '');
  }

  // Activate locally from a payment reference. Provisional: this cannot verify the
  // payment without a server, so it is the same honour-system step the UTR flow uses.
  function activate(planId, reference, email) {
    var p = PLANS.filter(function (x) { return x.id === planId; })[0] || PLANS[0];
    var now = Date.now();
    var uid = (email || 'local').toLowerCase();
    var us = users();
    us[uid] = { uid: uid, email: email || '', plan: (email || '').toLowerCase() === OWNER_EMAIL ? 'owner' : 'operator',
      planExpires: (email || '').toLowerCase() === OWNER_EMAIL ? 4102444800000 : now + p.days * DAY,
      reference: reference || '', activatedAt: now };
    ls(K.users, JSON.stringify(us));
    ls(K.session, JSON.stringify({ uid: uid, sessionExpires: now + 400 * DAY }));
    if (us[uid].plan === 'operator') ls(K.paid, String(now + p.days * DAY));
    return state();
  }

  function signOut() { ls(K.session, 'null'); }
  function reset() { [K.did, K.anc, K.paid, K.users, K.session].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} }); }

  g.TACP_ENT = {
    TRIAL_DAYS: TRIAL_DAYS, PLANS: PLANS, PAY: PAY, OWNER_EMAIL: OWNER_EMAIL,
    state: state, gate: gate, entitled: function () { return state().entitled; },
    isPremiumAction: isPremiumAction, isPremiumChange: isPremiumChange,
    subscribeUrl: subscribeUrl, activate: activate, signOut: signOut, reset: reset,
    freeLine: 'Free: explore the control model \u2014 the Story, every read-only view, the policy sandbox.',
    paidLine: 'Operator: run agents on your own cases, change governance, export evidence, bring your own model.'
  };
})(typeof window !== 'undefined' ? window : this);
