require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

// Ensure the admin account exists
function ensureAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@ocupant.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';

  const existing = db
    .prepare('SELECT id, is_admin FROM users WHERE email = ?')
    .get(adminEmail.toLowerCase());

  if (!existing) {
    const passwordHash = bcrypt.hashSync(adminPassword, 10);

    db.prepare(`
      INSERT INTO users (name, email, password_hash, is_admin)
      VALUES (?, ?, ?, 1)
    `).run(
      'Admin',
      adminEmail.toLowerCase(),
      passwordHash
    );

    console.log('Admin account created:', adminEmail);
  } else if (!existing.is_admin) {
    // Make sure the configured admin account has admin privileges.
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?')
      .run(existing.id);

    console.log('Admin privileges enabled for:', adminEmail);
  }
}

ensureAdmin();

app.get('/api/health', (req, res) =>
  res.json({ ok: true, service: 'ocupant-api' })
);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/houses', require('./routes/houses'));
app.use('/api/subscription', require('./routes/subscription'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/roommates', require('./routes/roommates'));

// 404 for unknown API routes
app.use('/api', (req, res) =>
  res.status(404).json({ error: 'Not found' })
);

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () =>
  console.log('Ocupant API running on http://localhost:' + PORT)
);
