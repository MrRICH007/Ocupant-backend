const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { signToken, requireAuth, isPremium } = require('../middleware/auth1');

const router = express.Router();

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  plan: u.plan,
  premium: isPremium(u),
  premium_until: u.premium_until,
  is_admin: !!u.is_admin,
  created_at: u.created_at,
  last_login_at: u.last_login_at
});

router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const normalizedEmail = String(email).toLowerCase();
    const exists = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (exists.rowCount) return res.status(409).json({ error: 'Email is already registered' });
    const hash = bcrypt.hashSync(password, 10);
    const result = await query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
      [name, normalizedEmail, hash]
    );
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (e) { next(e); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const result = await query('SELECT * FROM users WHERE email = $1', [String(email || '').toLowerCase()]);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    await query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
    user.last_login_at = new Date().toISOString();
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = router;
