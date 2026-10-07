const jwt = require('jsonwebtoken');
const db = require('../db');

if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set. Using a development-only default.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

function signToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

function getUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return db
      .prepare('SELECT id, name, email, plan, premium_until, is_admin FROM users WHERE id = ?')
      .get(payload.id) || null;
  } catch {
    return null;
  }
}

function isPremium(user) {
  if (!user || user.plan !== 'premium' || !user.premium_until) return false;
  return new Date(user.premium_until.replace(' ', 'T') + 'Z') > new Date();
}

function optionalAuth(req, res, next) {
  req.user = getUser(req);
  req.premium = isPremium(req.user);
  next();
}

function requireAuth(req, res, next) {
  req.user = getUser(req);
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  req.premium = isPremium(req.user);
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

module.exports = { signToken, optionalAuth, requireAuth, requireAdmin, isPremium };
