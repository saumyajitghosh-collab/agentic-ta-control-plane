/* Agentic TA Control Plane — shared utilities.
 * Plain script: attaches to globalThis.TACP so it runs in the browser (GitHub Pages)
 * and in Node tests without a build step. */
(function (g) {
  'use strict';
  const T = (g.TACP = g.TACP || {});

  // ---------- SHA-256 (synchronous, dependency-free) ----------
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const ror = (x, n) => (x >>> n) | (x << (32 - n));

  function sha256(message) {
    const bytes = new TextEncoder().encode(String(message));
    const len = bytes.length;
    const total = (((len + 9) + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000));
    dv.setUint32(total - 4, (len << 3) >>> 0);
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, gg = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
        const ch = (e & f) ^ (~e & gg);
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = gg; gg = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + gg) >>> 0; h7 = (h7 + h) >>> 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('');
  }

  // ---------- Canonical JSON (sorted keys) for stable hashing ----------
  function canonicalJSON(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
    if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(value[k])).join(',') + '}';
  }

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  // ---------- Seeded PRNG (mulberry32) ----------
  function rng(seed) {
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      chance: (p) => next() < p,
      normal: (mu, sd) => {
        const u = Math.max(next(), 1e-12), v = next();
        return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      }
    };
  }

  // ---------- ISIN (ISO 6166) check digit ----------
  function isinDigits(s) {
    return s.toUpperCase().split('').map((ch) => (/[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55))).join('');
  }
  function isinCheckDigit(body11) {
    const digits = isinDigits(body11);
    let sum = 0;
    for (let i = digits.length - 1, k = 0; i >= 0; i--, k++) {
      let d = Number(digits[i]);
      if (k % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    return String((10 - (sum % 10)) % 10);
  }
  function validIsin(isin) {
    if (typeof isin !== 'string' || !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false;
    return isinCheckDigit(isin.slice(0, 11)) === isin[11];
  }
  function makeIsin(country, r) {
    const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let body = country;
    for (let i = 0; i < 9; i++) body += chars[Math.floor(r.next() * chars.length)];
    return body + isinCheckDigit(body);
  }

  // ---------- Dates (business days, ISO strings, no time zones) ----------
  function parseDate(d) { const [y, m, dd] = d.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); }
  function fmtDate(dt) { return dt.toISOString().slice(0, 10); }
  function isBusinessDay(d) { const day = parseDate(d).getUTCDay(); return day !== 0 && day !== 6; }
  function addBusinessDays(d, n) {
    let dt = parseDate(d);
    let left = n;
    const step = n >= 0 ? 1 : -1;
    while (left !== 0) {
      dt = new Date(dt.getTime() + step * 86400000);
      const day = dt.getUTCDay();
      if (day !== 0 && day !== 6) left -= step;
    }
    return fmtDate(dt);
  }
  function nextBusinessDay(d) { return addBusinessDays(d, 1); }
  function businessDaysFrom(d, count) {
    const out = [];
    let cur = isBusinessDay(d) ? d : nextBusinessDay(d);
    for (let i = 0; i < count; i++) { out.push(cur); cur = nextBusinessDay(cur); }
    return out;
  }

  // ---------- Formatting ----------
  function fmtMoney(n, ccy) {
    const v = Number(n);
    const s = Math.abs(v).toLocaleString('en-GB', { maximumFractionDigits: 0 });
    return (ccy ? ccy + ' ' : '') + (v < 0 ? '−' : '') + s;
  }
  function fmtUnits(n) { return Number(n).toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }
  function fmtPct(x, dp) { return (x * 100).toFixed(dp === undefined ? 1 : dp) + '%'; }
  function shortHash(h) { return h ? h.slice(0, 10) : '—'; }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  Object.assign(T, {
    sha256, canonicalJSON, clone, rng,
    isinCheckDigit, validIsin, makeIsin,
    parseDate, fmtDate, isBusinessDay, addBusinessDays, nextBusinessDay, businessDaysFrom,
    fmtMoney, fmtUnits, fmtPct, shortHash, esc
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
