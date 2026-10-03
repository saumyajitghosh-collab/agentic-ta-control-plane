/* Admin (maker) sign-in.
 *
 * One account: the owner. The password is never stored here — only a salt and a
 * salted, iterated SHA-256 digest of it. Sign-in derives the same digest and compares.
 *
 * HONEST LIMIT — read this before trusting it:
 * This runs in the browser on a static site. The digest in this file is public, so the
 * gate can be bypassed by anyone who sets the session key by hand, and the digest could
 * be brute-forced offline. What it does buy you: the password itself is not in the repo
 * and not on the page, and a strong password is impractical to reverse. That is
 * obfuscation, not access control. A real admin gate needs a server that verifies the
 * credential and issues a session — see docs/BILLING.md.
 */
(function (g) {
  'use strict';
  var T = g.TACP;
  var KEY = 'tacp_owner';
  var FOREVER = 4102444800000; // 2100-01-01

  // Generated credential. Only the salt and digest are stored — never the password.
  var ADMIN = {
    user: 'maker-785010fe',
    salt: '75b1fc6cc07c16bc0b27f91857891ad1',
    hash: '217c570a6b55fcc1c4d803431b2d353c42ce3ab2b43a09c63c5556d11ea77fe9',
    iterations: 12000
  };

  function derive(salt, password, iters) {
    var h = T.sha256(salt + ':' + password);
    for (var i = 0; i < iters; i++) h = T.sha256(h + ':' + salt);
    return h;
  }

  function verify(user, password) {
    if (!user || !password) return false;
    if (String(user).trim().toLowerCase() !== ADMIN.user.toLowerCase()) return false;
    return derive(ADMIN.salt, password, ADMIN.iterations) === ADMIN.hash;
  }

  function session() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }

  function isOwner() {
    var s = session();
    return !!(s && s.user === ADMIN.user && s.token === ADMIN.hash && s.exp > Date.now());
  }

  function login(user, password) {
    if (!verify(user, password)) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify({ user: ADMIN.user, token: ADMIN.hash, at: Date.now(), exp: FOREVER }));
    } catch (e) {}
    return true;
  }

  function logout() { try { localStorage.removeItem(KEY); } catch (e) {} }

  g.TACP_AUTH = {
    ADMIN: { user: ADMIN.user },
    verify: verify, login: login, logout: logout, isOwner: isOwner, session: session
  };
})(typeof window !== 'undefined' ? window : this);
