/**
 * Razorpay order creation + signature verification — REFERENCE IMPLEMENTATION.
 *
 * This is "Path 2" from docs/BILLING.md: the enforced paywall. The browser can create
 * an order and collect a payment, but only a server can verify the signature, because
 * that needs your key secret. The static site in this repo cannot do it.
 *
 * Deploy this to Cloudflare Workers, Vercel Edge Functions, or Netlify Functions.
 * Set these as environment variables / secrets — NEVER commit them:
 *
 *   RAZORPAY_KEY_ID        (rzp_live_... or rzp_test_...)
 *   RAZORPAY_KEY_SECRET    (never expose this to the browser)
 *   RAZORPAY_WEBHOOK_SECRET (from the Razorpay dashboard, for /webhook)
 *
 * Then point the client at it by setting TACP_ENT.PAY.apiBase (see src/app/entitlements.js
 * and the fetch calls in pricing.html) to this Worker's URL.
 *
 * Routes:
 *   POST /create-order  { amount, currency, receipt }        -> { orderId, keyId, amount }
 *   POST /verify        { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *                                                            -> { verified: true|false }
 *   POST /webhook       (Razorpay -> you)                    -> 200 once signature checks out
 *
 * NOT INCLUDED, and required before this is a real paywall: persistence (D1/Postgres/KV)
 * of which account paid for which plan until when, and issuance of a signed entitlement
 * token the client can present. Without those, verification is correct but nothing
 * remembers it. See docs/BILLING.md.
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // ---- create an order (server-side; keeps the secret off the client) ----
    if (url.pathname === '/create-order' && request.method === 'POST') {
      if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return json({ error: 'not configured' }, 500);
      const { amount, currency = 'INR', receipt } = await request.json().catch(() => ({}));
      if (!Number.isInteger(amount) || amount <= 0) return json({ error: 'amount (in the smallest unit) required' }, 400);

      const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
      const res = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
        body: JSON.stringify({ amount, currency, receipt: receipt || `rcpt_${Date.now()}`, payment_capture: 1 }),
      });
      const order = await res.json();
      if (!res.ok) return json({ error: order?.error?.description || 'order failed' }, res.status);
      return json({ orderId: order.id, keyId: env.RAZORPAY_KEY_ID, amount: order.amount, currency: order.currency });
    }

    // ---- verify the checkout signature (the step a static site cannot do) ----
    if (url.pathname === '/verify' && request.method === 'POST') {
      if (!env.RAZORPAY_KEY_SECRET) return json({ error: 'not configured' }, 500);
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await request.json().catch(() => ({}));
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return json({ error: 'missing fields' }, 400);

      const expected = await hmacHex(env.RAZORPAY_KEY_SECRET, `${razorpay_order_id}|${razorpay_payment_id}`);
      const ok = timingSafeEqual(expected, razorpay_signature);
      // TODO: on success, record the entitlement (account, plan, paid-until) in your store,
      // then issue a signed token the client can present on later visits.
      return json({ verified: ok });
    }

    // ---- webhook (authoritative; do not rely on the browser redirect alone) ----
    if (url.pathname === '/webhook' && request.method === 'POST') {
      if (!env.RAZORPAY_WEBHOOK_SECRET) return json({ error: 'not configured' }, 500);
      const raw = await request.text();
      const signature = request.headers.get('x-razorpay-signature') || '';
      const expected = await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, raw);
      if (!timingSafeEqual(expected, signature)) return json({ error: 'bad signature' }, 400);
      const event = JSON.parse(raw);
      // TODO: handle payment.captured / subscription.charged -> extend entitlement; refunds -> revoke.
      return json({ ok: true, event: event.event });
    }

    return json({ error: 'not found' }, 404);
  },
};
