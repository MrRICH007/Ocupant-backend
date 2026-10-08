const express = require('express');
const { query } = require('../db');
const { requireAdmin } = require('../middleware/auth1');
const { isPremium } = require('../middleware/auth1');

const router = express.Router();

router.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT id, name, email, plan, premium_until, is_admin, created_at, last_login_at
      FROM users
      ORDER BY created_at DESC
    `);
    res.json({ users: result.rows.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      plan: u.plan,
      premium: isPremium(u),
      premium_until: u.premium_until,
      is_admin: !!u.is_admin,
      created_at: u.created_at,
      last_login_at: u.last_login_at
    })) });
  } catch (e) { next(e); }
});

router.put('/users/:id/premium', requireAdmin, async (req, res, next) => {
  try {
    const userId = String(req.params.id);
    const enabled = req.body && (req.body.premium === true || req.body.plan === 'premium');
    const premiumUntilRaw = req.body && req.body.premiumUntil;

    if (userId === String(req.user.id) && !enabled) {
      return res.status(400).json({ error: 'You cannot remove Premium from your own admin account.' });
    }

    let premiumUntil = null;
    if (enabled) {
      if (premiumUntilRaw) {
        const date = new Date(premiumUntilRaw);
        if (Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Invalid Premium expiry date.' });
        premiumUntil = date.toISOString();
      } else {
        premiumUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      }
    }

    const result = await query(`
      UPDATE users
      SET plan = $1, premium_until = $2
      WHERE id = $3
      RETURNING id, name, email, plan, premium_until, is_admin, created_at, last_login_at
    `, [enabled ? 'premium' : 'basic', premiumUntil, userId]);

    if (!result.rowCount) return res.status(404).json({ error: 'User not found' });
    const u = result.rows[0];
    res.json({
      user: {
        id: u.id, name: u.name, email: u.email, plan: u.plan,
        premium: isPremium(u), premium_until: u.premium_until,
        is_admin: !!u.is_admin, created_at: u.created_at, last_login_at: u.last_login_at
      }
    });
  } catch (e) { next(e); }
});

module.exports = router;
