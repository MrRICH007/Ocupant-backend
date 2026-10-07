const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth1');

const router = express.Router();

// POST /api/subscription/upgrade
// In production, verify the payment here FIRST (Stripe, M-Pesa, Flutterwave...)
// before activating the plan. See README "Payments".
router.post('/upgrade', requireAuth, (req, res) => {
  db.prepare("UPDATE users SET plan = 'premium', premium_until = datetime('now', '+30 days') WHERE id = ?")
    .run(req.user.id);
  const user = db.prepare('SELECT plan, premium_until FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, plan: user.plan, premium_until: user.premium_until });
});

// POST /api/subscription/cancel
router.post('/cancel', requireAuth, (req, res) => {
  db.prepare("UPDATE users SET plan = 'basic', premium_until = NULL WHERE id = ?").run(req.user.id);
  res.json({ ok: true, plan: 'basic' });
});

module.exports = router;
