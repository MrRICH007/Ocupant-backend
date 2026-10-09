require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { initDb, query } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

async function ensureAdmin() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@ocupant.com').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';
  const existing = await query('SELECT id, is_admin FROM users WHERE email = $1', [adminEmail]);
  if (!existing.rowCount) {
    const passwordHash = bcrypt.hashSync(adminPassword, 10);
    await query('INSERT INTO users (name, email, password_hash, is_admin) VALUES ($1, $2, $3, TRUE)',
      ['Admin', adminEmail, passwordHash]);
    console.log('Admin account created:', adminEmail);
  } else if (!existing.rows[0].is_admin) {
    await query('UPDATE users SET is_admin = TRUE WHERE id = $1', [existing.rows[0].id]);
    console.log('Admin privileges enabled for:', adminEmail);
  }
}

app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, service: 'ocupant-api', database: 'postgresql' });
  } catch (e) {
    res.status(503).json({ ok: false, service: 'ocupant-api', database: 'unavailable' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/houses', require('./routes/houses'));
app.use('/api/subscription', require('./routes/subscription'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/roommates', require('./routes/roommates'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;

(async () => {
  try {
    await initDb();
    await ensureAdmin();
    app.listen(PORT, () => console.log('Ocupant API running on port ' + PORT));
  } catch (err) {
    console.error('Failed to start Ocupant API:', err);
    process.exit(1);
  }
})();
