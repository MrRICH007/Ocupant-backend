const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth1');

const router = express.Router();

router.post('/upgrade', requireAuth, async (req, res) => {
  return res.status(410).json({ error: 'Direct Premium upgrades are disabled. Complete checkout through Paystack.' });
});

router.post('/cancel', requireAuth, async (req, res, next) => {
  try {
    await query("UPDATE users SET plan = 'basic', premium_until = NULL WHERE id = $1", [req.user.id]);
    res.json({ ok: true, plan: 'basic' });
  } catch (e) { next(e); }
});

module.exports = router;
