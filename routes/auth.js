const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { query } = require('../db');
const { signToken, requireAuth, isPremium } = require('../middleware/auth1');

const router = express.Router();

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  username: u.username || null,
  state: u.state || null,
  city: u.city || null,
  plan: u.plan,
  premium: isPremium(u),
  premium_until: u.premium_until,
  is_admin: !!u.is_admin,
  created_at: u.created_at,
  last_login_at: u.last_login_at
});

router.post('/register', async (req, res, next) => {
  try {
    const { name, username, email, password, state, city, referralCode } = req.body || {};
    if (!name || !username || !email || !password || !state || !city) {
      return res.status(400).json({ error: 'Full name, username, email, password, state and city are required' });
    }
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedUsername = String(username).trim();
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(normalizedUsername)) {
      return res.status(400).json({ error: 'Username must be 3–30 characters and use only letters, numbers, dots, underscores or hyphens' });
    }
    const validStates = new Set([
      'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno',
      'Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','Federal Capital Territory',
      'Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara',
      'Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers',
      'Sokoto','Taraba','Yobe','Zamfara'
    ]);
    if (!validStates.has(String(state))) return res.status(400).json({ error: 'Please select a valid Nigerian state' });
    const normalizedCity = String(city).trim();
    if (!normalizedCity || normalizedCity.length > 100) return res.status(400).json({ error: 'Please enter a valid city or town' });
    const exists = await query(
      'SELECT id, email, username FROM users WHERE email = $1 OR LOWER(username) = LOWER($2) LIMIT 1',
      [normalizedEmail, normalizedUsername]
    );
    if (exists.rowCount) {
      return res.status(409).json({
        error: exists.rows[0].email === normalizedEmail ? 'Email is already registered' : 'Username is already taken'
      });
    }
    const hash = bcrypt.hashSync(password, 10);
    const result = await query(
      `INSERT INTO users (name, username, email, password_hash, state, city, referral_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [String(name).trim(), normalizedUsername, normalizedEmail, hash, String(state), normalizedCity,
       referralCode ? String(referralCode).trim().slice(0, 50) || null : null]
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


router.post('/forgot-password', async (req, res, next) => {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    // Always return the same response to avoid revealing whether an email is registered.
    const generic = { message: 'If an account exists for that email, password reset instructions will be sent.' };
    if (!email || email.length > 254) return res.json(generic);
    const found = await query('SELECT id, email FROM users WHERE email = $1', [email]);
    if (!found.rowCount) return res.json(generic);
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await query(
      `UPDATE users SET password_reset_token_hash = $1,
       password_reset_expires_at = CURRENT_TIMESTAMP + INTERVAL '30 minutes' WHERE id = $2`,
      [tokenHash, found.rows[0].id]
    );
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || user;
    const frontendUrl = process.env.FRONTEND_URL;
    if (!host || !user || !pass || !from || !frontendUrl) {
      console.error('Password reset email is not configured: set SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM and FRONTEND_URL.');
      return res.status(503).json({ error: 'Password reset email is not configured yet. Please contact support.' });
    }
    const port = Number(process.env.SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({
      host, port, secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass }
    });
    const resetUrl = new URL(frontendUrl);
    resetUrl.searchParams.set('resetToken', token);
    await transporter.sendMail({
      from, to: found.rows[0].email,
      subject: 'Reset your Ocupant password',
      text: `We received a request to reset your Ocupant password. This link expires in 30 minutes: ${resetUrl.toString()}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>We received a request to reset your Ocupant password.</p><p><a href="${resetUrl.toString()}">Reset your password</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>`
    });
    return res.json(generic);
  } catch (e) { next(e); }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string' || token.length > 200) return res.status(400).json({ error: 'Invalid or expired reset link' });
    if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const found = await query(
      `SELECT id FROM users WHERE password_reset_token_hash = $1
       AND password_reset_expires_at > CURRENT_TIMESTAMP LIMIT 1`, [tokenHash]
    );
    if (!found.rowCount) return res.status(400).json({ error: 'Invalid or expired reset link. Please request another one.' });
    const hash = bcrypt.hashSync(String(password), 10);
    await query(
      `UPDATE users SET password_hash = $1, password_reset_token_hash = NULL,
       password_reset_expires_at = NULL WHERE id = $2`, [hash, found.rows[0].id]
    );
    return res.json({ message: 'Password has been reset. You can now log in.' });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = router;
