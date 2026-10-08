const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth1');

const router = express.Router();

// GET /api/roommates/:houseId — roommate requests for a house (auth required)
router.get('/:houseId', requireAuth, (req, res) => {
  const house = db.prepare('SELECT id FROM houses WHERE id = ?').get(req.params.houseId);
  if (!house) return res.status(404).json({ error: 'House not found' });

  const rows = db.prepare(`
    SELECT r.id, r.budget, r.message, r.created_at, u.name
    FROM roommate_requests r JOIN users u ON u.id = r.user_id
    WHERE r.house_id = ?
    ORDER BY r.created_at DESC
  `).all(house.id);

  res.json({ roommates: rows });
});

// POST /api/roommates/:houseId — express interest (auth required)
router.post('/:houseId', requireAuth, (req, res) => {
  const house = db.prepare('SELECT id FROM houses WHERE id = ?').get(req.params.houseId);
  if (!house) return res.status(404).json({ error: 'House not found' });

  const { budget, message } = req.body || {};
  try {
    db.prepare(`
      INSERT INTO roommate_requests (user_id, house_id, budget, message)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, house_id) DO UPDATE SET budget = excluded.budget, message = excluded.message
    `).run(req.user.id, house.id, budget || null, message || null);
  } catch (e) {
    return res.status(500).json({ error: 'Could not save roommate request' });
  }
  res.status(201).json({ ok: true });
});

module.exports = router;
