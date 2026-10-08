const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth1');

const router = express.Router();

router.post('/upgrade', requireAuth, async (req, res, next) => {
  try {
    const result = await query("UPDATE users SET plan = 'premium', premium_until = CURRENT_TIMESTAMP + INTERVAL '30 days' WHERE id = $1 RETURNING plan, premium_until", [req.user.id]);
    res.json({ ok: true, ...result.rows[0] });
  } catch (e) { next(e); }
});

router.post('/cancel', requireAuth, async (req, res, next) => {
  try {
    await query("UPDATE users SET plan = 'basic', premium_until = NULL WHERE id = $1", [req.user.id]);
    res.json({ ok: true, plan: 'basic' });
  } catch (e) { next(e); }
});

module.exports = router;
