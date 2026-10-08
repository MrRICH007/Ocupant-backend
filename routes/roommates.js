const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth1');

const router = express.Router();

router.get('/:houseId', requireAuth, async (req, res, next) => {
  try {
    const house = await query('SELECT id FROM houses WHERE id = $1', [req.params.houseId]);
    if (!house.rowCount) return res.status(404).json({ error: 'House not found' });
    const result = await query(`
      SELECT r.id, r.budget, r.message, r.created_at, u.name
      FROM roommate_requests r JOIN users u ON u.id = r.user_id
      WHERE r.house_id = $1 ORDER BY r.created_at DESC
    `, [house.rows[0].id]);
    res.json({ roommates: result.rows });
  } catch (e) { next(e); }
});

router.post('/:houseId', requireAuth, async (req, res, next) => {
  try {
    const house = await query('SELECT id FROM houses WHERE id = $1', [req.params.houseId]);
    if (!house.rowCount) return res.status(404).json({ error: 'House not found' });
    const { budget, message } = req.body || {};
    await query(`
      INSERT INTO roommate_requests (user_id, house_id, budget, message)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, house_id) DO UPDATE SET budget = EXCLUDED.budget, message = EXCLUDED.message
    `, [req.user.id, house.rows[0].id, budget || null, message || null]);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
