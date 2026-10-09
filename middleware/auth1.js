const jwt = require('jsonwebtoken');
const { query } = require('../db');

if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set. Using a development-only default.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

function signToken(user) {
  return jwt.sign({ id: String(user.id) }, JWT_SECRET, { expiresIn: '7d' });
}

function isPremium(user) {
  if (!user || user.plan !== 'premium' || !user.premium_until) return false;
  const until = new Date(user.premium_until);
  return !Number.isNaN(until.getTime()) && until > new Date();
}

async function getUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const result = await query(
      'SELECT id, name, email, plan, premium_until, is_admin FROM users WHERE id = $1',
      [payload.id]
    );
    return result.rows[0] || null;
  } catch {
    return null;
  }
}

async function optionalAuth(req, res, next) {
  try {
    req.user = await getUser(req);
    req.premium = isPremium(req.user);
    next();
  } catch (e) { next(e); }
}

async function requireAuth(req, res, next) {
  try {
    req.user = await getUser(req);
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    req.premium = isPremium(req.user);
    next();
  } catch (e) { next(e); }
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

module.exports = { signToken, optionalAuth, requireAuth, requireAdmin, isPremium };
