const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth1');
const router = express.Router();

// Roommate discovery and messaging are Premium features. Enforce this on the server too.
function requirePremium(req, res, next) {
  if (!req.premium) return res.status(403).json({ error: 'Premium is required to use Find Roommates.' });
  next();
}
router.use(requireAuth, requirePremium);

async function getConnectionForUser(connectionId, userId) {
  const result = await query(
    `SELECT id, requester_id, recipient_id, status FROM roommate_connections
     WHERE id = $1 AND (requester_id = $2 OR recipient_id = $2)`,
    [connectionId, userId]
  );
  return result.rows[0] || null;
}

// Profile for the signed-in user.
router.get('/profile/me', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM roommate_profiles WHERE user_id = $1', [req.user.id]);
    res.json({ profile: result.rows[0] || null });
  } catch (e) { next(e); }
});

router.put('/profile/me', async (req, res, next) => {
  try {
    const body = req.body || {};
    const location = String(body.location || '').trim();
    const budget = body.budget === '' || body.budget == null ? null : Number(body.budget);
    const accommodationType = String(body.accommodation_type || 'Any').trim().slice(0, 80);
    const moveInDate = body.move_in_date || null;
    const lifestyle = String(body.lifestyle || '').trim().slice(0, 300);
    const bio = String(body.bio || '').trim().slice(0, 1000);
    const looking = body.looking_for_roommate !== false;
    if (!location) return res.status(400).json({ error: 'Preferred location is required.' });
    if (budget !== null && (!Number.isFinite(budget) || budget < 0 || budget > 1000000000)) {
      return res.status(400).json({ error: 'Enter a valid monthly or yearly budget in naira.' });
    }
    if (moveInDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(moveInDate))) {
      return res.status(400).json({ error: 'Move-in date must be a valid date.' });
    }
    const result = await query(`
      INSERT INTO roommate_profiles
        (user_id, location, budget, accommodation_type, move_in_date, lifestyle, bio, looking_for_roommate, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
        location=EXCLUDED.location, budget=EXCLUDED.budget,
        accommodation_type=EXCLUDED.accommodation_type, move_in_date=EXCLUDED.move_in_date,
        lifestyle=EXCLUDED.lifestyle, bio=EXCLUDED.bio,
        looking_for_roommate=EXCLUDED.looking_for_roommate, updated_at=CURRENT_TIMESTAMP
      RETURNING *`,
      [req.user.id, location, budget, accommodationType || 'Any', moveInDate || null, lifestyle, bio, looking]
    );
    res.json({ profile: result.rows[0] });
  } catch (e) { next(e); }
});

// Discover other active profiles. Email and contact details are never exposed here.
router.get('/discover', async (req, res, next) => {
  try {
    const location = String(req.query.location || '').trim();
    const maxBudget = req.query.max_budget ? Number(req.query.max_budget) : null;
    const result = await query(`
      SELECT p.user_id, u.name, p.location, p.budget, p.accommodation_type,
             p.move_in_date, p.lifestyle, p.bio, p.updated_at
      FROM roommate_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.user_id <> $1 AND p.looking_for_roommate = TRUE
        AND u.plan = 'premium' AND u.premium_until > CURRENT_TIMESTAMP
        AND ($2 = '' OR p.location ILIKE '%' || $2 || '%')
        AND ($3::numeric IS NULL OR p.budget IS NULL OR p.budget <= $3)
      ORDER BY CASE WHEN $2 <> '' AND p.location ILIKE '%' || $2 || '%' THEN 0 ELSE 1 END,
               p.updated_at DESC
      LIMIT 100`, [req.user.id, location, Number.isFinite(maxBudget) ? maxBudget : null]);
    const ids = result.rows.map(r => String(r.user_id));
    let connectionMap = {};
    if (ids.length) {
      const links = await query(`SELECT id, requester_id, recipient_id, status FROM roommate_connections
        WHERE (requester_id = $1 AND recipient_id = ANY($2::bigint[]))
           OR (recipient_id = $1 AND requester_id = ANY($2::bigint[]))`, [req.user.id, ids]);
      for (const c of links.rows) {
        const otherId = String(c.requester_id) === String(req.user.id) ? String(c.recipient_id) : String(c.requester_id);
        connectionMap[otherId] = { id: c.id, status: c.status, sent_by_me: String(c.requester_id) === String(req.user.id) };
      }
    }
    res.json({ profiles: result.rows.map(p => ({ ...p, connection: connectionMap[String(p.user_id)] || null })) });
  } catch (e) { next(e); }
});

router.post('/connections/:userId', async (req, res, next) => {
  try {
    const targetId = String(req.params.userId);
    if (targetId === String(req.user.id)) return res.status(400).json({ error: 'You cannot connect with your own profile.' });
    const target = await query(`SELECT p.user_id FROM roommate_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 AND p.looking_for_roommate=TRUE AND u.plan='premium' AND u.premium_until > CURRENT_TIMESTAMP`, [targetId]);
    if (!target.rowCount) return res.status(404).json({ error: 'That roommate profile is no longer available.' });
    const existing = await query(`SELECT id, status FROM roommate_connections
      WHERE (requester_id=$1 AND recipient_id=$2) OR (requester_id=$2 AND recipient_id=$1) LIMIT 1`, [req.user.id, targetId]);
    if (existing.rowCount) return res.status(409).json({ error: `A connection request already exists (${existing.rows[0].status}).` });
    const created = await query(`INSERT INTO roommate_connections (requester_id, recipient_id)
      VALUES ($1,$2) RETURNING id,status,created_at`, [req.user.id, targetId]);
    res.status(201).json({ connection: created.rows[0] });
  } catch (e) { next(e); }
});

router.get('/connections', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT c.id, c.requester_id, c.recipient_id, c.status, c.created_at, c.updated_at,
             u.name AS other_name, p.location, p.budget, p.accommodation_type,
             CASE WHEN c.requester_id=$1 THEN TRUE ELSE FALSE END AS sent_by_me
      FROM roommate_connections c
      JOIN users u ON u.id = CASE WHEN c.requester_id=$1 THEN c.recipient_id ELSE c.requester_id END
      LEFT JOIN roommate_profiles p ON p.user_id = u.id
      WHERE c.requester_id=$1 OR c.recipient_id=$1
      ORDER BY CASE WHEN c.status='pending' THEN 0 ELSE 1 END, c.created_at DESC`, [req.user.id]);
    res.json({ connections: result.rows });
  } catch (e) { next(e); }
});

router.patch('/connections/:id', async (req, res, next) => {
  try {
    const status = String((req.body || {}).status || '').toLowerCase();
    if (!['accepted', 'declined'].includes(status)) return res.status(400).json({ error: 'Status must be accepted or declined.' });
    const connection = await getConnectionForUser(req.params.id, req.user.id);
    if (!connection) return res.status(404).json({ error: 'Connection request not found.' });
    if (String(connection.recipient_id) !== String(req.user.id)) return res.status(403).json({ error: 'Only the recipient can respond to this request.' });
    if (connection.status !== 'pending') return res.status(409).json({ error: 'This request has already been answered.' });
    const updated = await query(`UPDATE roommate_connections SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *`, [status, req.params.id]);
    res.json({ connection: updated.rows[0] });
  } catch (e) { next(e); }
});

router.get('/connections/:id/messages', async (req, res, next) => {
  try {
    const c = await getConnectionForUser(req.params.id, req.user.id);
    if (!c) return res.status(404).json({ error: 'Connection not found.' });
    if (c.status !== 'accepted') return res.status(403).json({ error: 'Accept the connection before messaging.' });
    const result = await query(`SELECT m.id, m.sender_id, m.body, m.created_at, u.name AS sender_name
      FROM roommate_messages m JOIN users u ON u.id=m.sender_id
      WHERE m.connection_id=$1 ORDER BY m.created_at ASC LIMIT 200`, [req.params.id]);
    res.json({ messages: result.rows });
  } catch (e) { next(e); }
});

router.post('/connections/:id/messages', async (req, res, next) => {
  try {
    const c = await getConnectionForUser(req.params.id, req.user.id);
    if (!c) return res.status(404).json({ error: 'Connection not found.' });
    if (c.status !== 'accepted') return res.status(403).json({ error: 'Accept the connection before messaging.' });
    const body = String((req.body || {}).body || '').trim();
    if (!body || body.length > 2000) return res.status(400).json({ error: 'Message must be between 1 and 2000 characters.' });
    const result = await query(`INSERT INTO roommate_messages (connection_id, sender_id, body)
      VALUES ($1,$2,$3) RETURNING id,sender_id,body,created_at`, [req.params.id, req.user.id, body]);
    res.status(201).json({ message: result.rows[0] });
  } catch (e) { next(e); }
});

// Existing property-specific roommate interest feature, now retained alongside profile matching.
router.get('/house/:houseId', async (req, res, next) => {
  try {
    const house = await query('SELECT id FROM houses WHERE id = $1', [req.params.houseId]);
    if (!house.rowCount) return res.status(404).json({ error: 'House not found' });
    const result = await query(`SELECT r.id,r.budget,r.message,r.created_at,u.name
      FROM roommate_requests r JOIN users u ON u.id=r.user_id
      WHERE r.house_id=$1 ORDER BY r.created_at DESC`, [house.rows[0].id]);
    res.json({ roommates: result.rows });
  } catch (e) { next(e); }
});
router.get('/:houseId', async (req, res, next) => {
  try {
    const house = await query('SELECT id FROM houses WHERE id = $1', [req.params.houseId]);
    if (!house.rowCount) return res.status(404).json({ error: 'House not found' });
    const result = await query(`SELECT r.id,r.budget,r.message,r.created_at,u.name
      FROM roommate_requests r JOIN users u ON u.id=r.user_id
      WHERE r.house_id=$1 ORDER BY r.created_at DESC`, [house.rows[0].id]);
    res.json({ roommates: result.rows });
  } catch (e) { next(e); }
});
router.post('/:houseId', async (req, res, next) => {
  try {
    const house = await query('SELECT id FROM houses WHERE id = $1', [req.params.houseId]);
    if (!house.rowCount) return res.status(404).json({ error: 'House not found' });
    const { budget, message } = req.body || {};
    await query(`INSERT INTO roommate_requests (user_id,house_id,budget,message)
      VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,house_id)
      DO UPDATE SET budget=EXCLUDED.budget,message=EXCLUDED.message`,
      [req.user.id, house.rows[0].id, budget || null, message || null]);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});
module.exports = router;
