const express = require('express');
const crypto = require('crypto');
const { pool, query } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth1');

const router = express.Router();
const PAYSTACK_BASE = 'https://api.paystack.co';
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PREMIUM_PRICE = Number(process.env.PREMIUM_PRICE || 10000); // NGN
const CURRENCY = process.env.PAYMENT_CURRENCY || 'NGN';
const PREMIUM_DAYS = 30;

function configured(res) {
  if (!PAYSTACK_SECRET) {
    res.status(503).json({ error: 'Paystack is not configured on the server (PAYSTACK_SECRET_KEY missing)' });
    return false;
  }
  if (!Number.isFinite(PREMIUM_PRICE) || PREMIUM_PRICE <= 0 || CURRENCY !== 'NGN') {
    res.status(503).json({ error: 'Payment configuration is invalid. Premium payments must use NGN.' });
    return false;
  }
  return true;
}

const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const backendUrl = req => (process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

async function paystackRequest(path, options = {}) {
  const response = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.status !== true) {
    const err = new Error((payload && payload.message) || 'Paystack request failed');
    err.status = 502;
    throw err;
  }
  return payload.data;
}

async function verifyAndCredit(reference) {
  const found = await query('SELECT * FROM payments WHERE tx_ref = $1', [reference]);
  const payment = found.rows[0];
  if (!payment) return { ok: false, reason: 'unknown transaction' };
  if (payment.status === 'successful') return { ok: true, already: true };

  const tx = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`);
  const expectedKobo = Math.round(Number(payment.amount) * 100);
  if (tx.reference !== reference || tx.status !== 'success' || tx.currency !== payment.currency ||
      Number(tx.amount) !== expectedKobo || payment.currency !== CURRENCY) {
    // Do not mark a still-pending payment failed solely because a callback arrived early.
    if (tx.status === 'failed' || tx.status === 'abandoned' || tx.status === 'reversed') {
      await query("UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE tx_ref = $1 AND status <> 'successful'", [reference]);
    }
    return { ok: false, reason: 'payment status, amount, or currency did not match' };
  }

  // Credit once only. The row lock + conditional update prevents callback/webhook races
  // from extending the same purchase more than once.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT * FROM payments WHERE tx_ref = $1 FOR UPDATE', [reference]);
    const current = locked.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'unknown transaction' };
    }
    if (current.status === 'successful') {
      await client.query('COMMIT');
      return { ok: true, already: true };
    }
    await client.query(
      "UPDATE payments SET status = 'successful', paystack_transaction_id = $1, provider = 'paystack', updated_at = CURRENT_TIMESTAMP WHERE tx_ref = $2",
      [String(tx.id), reference]
    );
    await client.query(
      `UPDATE users SET plan = 'premium',
       premium_until = GREATEST(COALESCE(premium_until, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) + ($1 * INTERVAL '1 day')
       WHERE id = $2`,
      [PREMIUM_DAYS, current.user_id]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

router.post('/paystack/initialize', requireAuth, async (req, res, next) => {
  if (!configured(res)) return;
  try {
    const reference = `OCUPANT-${req.user.id}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
    await query(
      "INSERT INTO payments (user_id, tx_ref, amount, currency, status, provider) VALUES ($1, $2, $3, $4, 'pending', 'paystack')",
      [req.user.id, reference, PREMIUM_PRICE, CURRENCY]
    );
    const data = await paystackRequest('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: req.user.email,
        amount: String(Math.round(PREMIUM_PRICE * 100)),
        currency: CURRENCY,
        reference,
        callback_url: `${backendUrl(req)}/api/payments/paystack/callback`,
        metadata: { user_id: String(req.user.id), product: 'ocupant_premium_30_days' }
      })
    });
    res.json({ payment_link: data.authorization_url, reference: data.reference });
  } catch (e) {
    next(e);
  }
});

router.get('/paystack/callback', async (req, res) => {
  const reference = typeof req.query.reference === 'string' ? req.query.reference : '';
  if (!reference || !PAYSTACK_SECRET) return res.redirect(`${frontendUrl()}/?payment=failed`);
  try {
    const result = await verifyAndCredit(reference);
    return res.redirect(`${frontendUrl()}/?payment=${result.ok ? 'success' : 'failed'}`);
  } catch (e) {
    console.error('Paystack callback verification failed:', e.message);
    return res.redirect(`${frontendUrl()}/?payment=failed`);
  }
});

// Keep the exact raw request bytes so the Paystack HMAC signature is checked correctly.
router.post('/paystack/webhook', async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(503).end();
  const signature = req.headers['x-paystack-signature'];
  const rawBody = req.rawBody;
  if (!signature || !rawBody) return res.status(401).end();
  const expected = crypto.createHmac('sha512', PAYSTACK_SECRET).update(rawBody).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'hex'); } catch { return res.status(401).end(); }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return res.status(401).end();

  const event = req.body || {};
  if (event.event !== 'charge.success' || !event.data || !event.data.reference) return res.status(200).end();
  try {
    const result = await verifyAndCredit(String(event.data.reference));
    if (!result.ok) console.warn('Paystack webhook not credited:', result.reason);
    return res.status(200).end();
  } catch (e) {
    console.error('Paystack webhook processing failed:', e.message);
    // A non-2xx response asks Paystack to retry the webhook.
    return res.status(500).end();
  }
});

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT p.id, p.tx_ref, p.amount, p.currency, p.status, p.provider,
             p.flutterwave_tx_id, p.paystack_transaction_id, p.created_at, u.email, u.name
      FROM payments p JOIN users u ON u.id = p.user_id
      ORDER BY p.id DESC LIMIT 200
    `);
    res.json({ payments: result.rows });
  } catch (e) { next(e); }
});

module.exports = router;
