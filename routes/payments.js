// Flutterwave payments for the Ocupant Premium subscription.
// Flow: initialize -> redirect user to Flutterwave checkout -> user returns to
// /callback where we VERIFY server-side before granting premium. Webhook is a
// backup credit path. Never trust the redirect params alone.
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth1');

const router = express.Router();

const FW_SECRET = process.env.FLUTTERWAVE_SECRET_KEY;
const FW_BASE = 'https://api.flutterwave.com/v3';
// Ocupant Premium: NGN 10,000 for 30 days.
// Environment variables may override these values if needed later.
const PREMIUM_PRICE = Number(process.env.PREMIUM_PRICE || 10000);
const CURRENCY = process.env.PAYMENT_CURRENCY || 'NGN';

function fwConfigured(res) {
  if (!FW_SECRET) {
    res.status(503).json({ error: 'Flutterwave is not configured on the server (FLUTTERWAVE_SECRET_KEY missing)' });
    return false;
  }
  return true;
}

const backendUrl = (req) => process.env.BACKEND_URL || req.protocol + '://' + req.get('host');
const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:3000';

// Verify a transaction with Flutterwave and credit premium. Idempotent.
async function verifyAndCredit(txRef, fwTxId) {
  const payment = db.prepare('SELECT * FROM payments WHERE tx_ref = ?').get(txRef);
  if (!payment) return { ok: false, reason: 'unknown transaction' };
  if (payment.status === 'successful') return { ok: true, already: true };

  const res = await fetch(FW_BASE + '/transactions/' + encodeURIComponent(fwTxId) + '/verify', {
    headers: { Authorization: 'Bearer ' + FW_SECRET }
  });
  const data = await res.json().catch(() => null);
  const tx = data && data.data;
  if (!tx || tx.status !== 'successful') {
    db.prepare("UPDATE payments SET status = 'failed', updated_at = datetime('now') WHERE tx_ref = ?").run(txRef);
    return { ok: false, reason: 'payment not successful' };
  }
  if (tx.currency !== payment.currency || Number(tx.amount) < Number(payment.amount)) {
    return { ok: false, reason: 'amount/currency mismatch' };
  }

  db.prepare("UPDATE payments SET status = 'successful', flutterwave_tx_id = ?, updated_at = datetime('now') WHERE tx_ref = ?")
    .run(String(tx.id), txRef);
  db.prepare("UPDATE users SET plan = 'premium', premium_until = datetime('now', '+30 days') WHERE id = ?")
    .run(payment.user_id);
  return { ok: true };
}

// POST /api/payments/flutterwave/initialize  (auth) -> { payment_link }
router.post('/flutterwave/initialize', requireAuth, async (req, res) => {
  if (!fwConfigured(res)) return;

  const tx_ref = 'OCUPANT-' + req.user.id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  db.prepare('INSERT INTO payments (user_id, tx_ref, amount, currency, status) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, tx_ref, PREMIUM_PRICE, CURRENCY, 'pending');

  let fwRes;
  try {
    fwRes = await fetch(FW_BASE + '/payments', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + FW_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_ref,
        amount: PREMIUM_PRICE,
        currency: CURRENCY,
        redirect_url: backendUrl(req) + '/api/payments/flutterwave/callback',
        customer: { email: req.user.email, name: req.user.name },
        meta: { user_id: req.user.id },
        customizations: {
          title: 'Ocupant Premium',
          description: 'Ocupant Premium - 30 days full access'
        }
      })
    });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach Flutterwave. Try again.' });
  }

  const data = await fwRes.json().catch(() => null);
  if (!fwRes.ok || !data || data.status !== 'success' || !data.data || !data.data.link) {
    return res.status(502).json({ error: 'Could not initialize payment: ' + ((data && data.message) || 'gateway error') });
  }
  res.json({ payment_link: data.data.link, tx_ref });
});

// GET /api/payments/flutterwave/callback  (Flutterwave redirects the browser here)
router.get('/flutterwave/callback', async (req, res) => {
  const { status, tx_ref, transaction_id } = req.query;
  const target = frontendUrl();
  if (status === 'cancelled') return res.redirect(target + '?payment=cancelled');
  if (!tx_ref || !transaction_id || !FW_SECRET) return res.redirect(target + '?payment=failed');

  try {
    const result = await verifyAndCredit(String(tx_ref), String(transaction_id));
    res.redirect(target + (result.ok ? '?payment=success' : '?payment=failed'));
  } catch (e) {
    console.error('Payment callback error:', e.message);
    res.redirect(target + '?payment=failed');
  }
});

// POST /api/payments/webhook  (set this URL in your Flutterwave dashboard)
router.post('/webhook', async (req, res) => {
  const hash = req.headers['verif-hash'];
  if (!process.env.FLUTTERWAVE_WEBHOOK_HASH || hash !== process.env.FLUTTERWAVE_WEBHOOK_HASH) {
    return res.status(401).end();
  }
  res.status(200).end(); // acknowledge immediately, process after

  const payload = req.body || {};
  if (payload.event === 'charge.completed' && payload.data && payload.data.status === 'successful') {
    try {
      await verifyAndCredit(payload.data.tx_ref, payload.data.id);
    } catch (e) {
      console.error('Webhook processing error:', e.message);
    }
  }
});

// GET /api/payments  (admin) - transaction history for the admin page
router.get('/', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.tx_ref, p.amount, p.currency, p.status, p.flutterwave_tx_id, p.created_at, u.email, u.name
    FROM payments p JOIN users u ON u.id = p.user_id
    ORDER BY p.id DESC LIMIT 200
  `).all();
  res.json({ payments: rows });
});

module.exports = router;
