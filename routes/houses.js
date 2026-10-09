const express = require('express');
const { query } = require('../db');
const { optionalAuth, requireAdmin } = require('../middleware/auth1');

const router = express.Router();

function parseVideos(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch (_) {}
  }
  return [];
}

function mapEmbedFromUrl(url) {
  if (!url) return '';
  const raw = String(url).trim();
  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?)[,%20]+(-?\d+(?:\.\d+)?)/i,
    /\/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:[/?#]|$)/
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) return `https://www.google.com/maps?q=${encodeURIComponent(m[1] + ',' + m[2])}&output=embed`;
  }
  try {
    const u = new URL(raw);
    const q = u.searchParams.get('q') || u.searchParams.get('query');
    if (q) return `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
  } catch (_) {}
  return '';
}

async function normalizeMapData(url) {
  if (!url) return { url: '', embedUrl: '' };
  let finalUrl = String(url).trim();
  try {
    const response = await fetch(finalUrl, { redirect: 'follow', signal: AbortSignal.timeout(5000) });
    if (response.url) finalUrl = response.url;
  } catch (_) {}
  return { url: String(url).trim(), embedUrl: mapEmbedFromUrl(finalUrl) || mapEmbedFromUrl(url) };
}

function publicHouse(h, premium) {
  const house = {
    id: h.id,
    title: h.title,
    type: h.type,
    status: h.status,
    beds: h.beds,
    baths: h.baths,
    area: h.area || '',
    firstYearPrice: Number(h.first_year_price),
    subsequentPrice: Number(h.subsequent_price),
    image: h.image || '',
    description: h.description || '',
    location: premium ? h.location : h.generic_location,
    genericLocation: h.generic_location,
    exactLocationHidden: !premium,
    videos: parseVideos(h.videos)
  };
  if (premium) {
    house.owner = { name: h.owner_name, phone: h.owner_phone, whatsapp: h.owner_whatsapp };
    house.googleMapsUrl = h.google_maps_url || '';
    house.googleMapsEmbedUrl = h.google_maps_embed_url || '';
  }
  return house;
}

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { search, type, status, minPrice, maxPrice } = req.query;
    const where = ['1=1'];
    const params = [];
    const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
    if (search) add('(title ILIKE ? OR location ILIKE ? OR generic_location ILIKE ?)', `%${search}%`);
    if (search) {
      // Replace the three ? placeholders with the same positional parameter.
      const n = params.length;
      where[where.length - 1] = `(title ILIKE $${n} OR location ILIKE $${n} OR generic_location ILIKE $${n})`;
    }
    if (type) add('type = ?', type);
    if (status) add('status = ?', status);
    if (minPrice) add('first_year_price >= ?', Number(minPrice));
    if (maxPrice) add('first_year_price <= ?', Number(maxPrice));
    const result = await query(`SELECT * FROM houses WHERE ${where.join(' AND ')} ORDER BY id DESC`, params);
    res.json({ premium: !!req.premium, houses: result.rows.map(h => publicHouse(h, req.premium)) });
  } catch (e) { next(e); }
});

router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM houses WHERE id = $1', [req.params.id]);
    const house = result.rows[0];
    if (!house) return res.status(404).json({ error: 'House not found' });
    res.json({ premium: !!req.premium, house: publicHouse(house, req.premium) });
  } catch (e) { next(e); }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const required = ['title', 'location', 'genericLocation', 'type', 'firstYearPrice', 'subsequentPrice', 'ownerName', 'ownerPhone', 'ownerWhatsapp'];
    const missing = required.filter(f => b[f] === undefined || b[f] === '');
    if (missing.length) return res.status(400).json({ error: 'Missing fields: ' + missing.join(', ') });
    const map = await normalizeMapData(b.googleMapsUrl || '');
    const videos = parseVideos(b.videos);
    const result = await query(`
      INSERT INTO houses (title, location, generic_location, type, status, beds, baths, area,
        first_year_price, subsequent_price, image, description, owner_name, owner_phone,
        owner_whatsapp, google_maps_url, google_maps_embed_url, videos)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *
    `, [b.title, b.location, b.genericLocation, b.type, b.status || 'vacant', b.beds || 1, b.baths || 1,
        b.area || '', b.firstYearPrice, b.subsequentPrice, b.image || '', b.description || '', b.ownerName,
        b.ownerPhone, b.ownerWhatsapp, map.url, map.embedUrl, JSON.stringify(videos)]);
    res.status(201).json({ house: publicHouse(result.rows[0], true) });
  } catch (e) { next(e); }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const existingResult = await query('SELECT * FROM houses WHERE id = $1', [req.params.id]);
    const existing = existingResult.rows[0];
    if (!existing) return res.status(404).json({ error: 'House not found' });
    const b = { ...existing, ...req.body };
    const map = await normalizeMapData(req.body.googleMapsUrl !== undefined ? req.body.googleMapsUrl : existing.google_maps_url);
    const videos = req.body.videos !== undefined ? parseVideos(req.body.videos) : parseVideos(existing.videos);
    const result = await query(`
      UPDATE houses SET title=$1, location=$2, generic_location=$3, type=$4, status=$5,
        beds=$6, baths=$7, area=$8, first_year_price=$9, subsequent_price=$10,
        image=$11, description=$12, owner_name=$13, owner_phone=$14, owner_whatsapp=$15,
        google_maps_url=$16, google_maps_embed_url=$17, videos=$18
      WHERE id=$19 RETURNING *
    `, [b.title, b.location, b.generic_location || b.genericLocation, b.type, b.status || 'vacant', b.beds || 1,
        b.baths || 1, b.area || '', b.first_year_price ?? b.firstYearPrice, b.subsequent_price ?? b.subsequentPrice,
        b.image || '', b.description || '', b.owner_name || b.ownerName, b.owner_phone || b.ownerPhone,
        b.owner_whatsapp || b.ownerWhatsapp, map.url, map.embedUrl, JSON.stringify(videos), existing.id]);
    res.json({ house: publicHouse(result.rows[0], true) });
  } catch (e) { next(e); }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const result = await query('DELETE FROM houses WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'House not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/inquire', optionalAuth, async (req, res, next) => {
  try {
    const houseResult = await query('SELECT id FROM houses WHERE id = $1', [req.params.id]);
    if (!houseResult.rowCount) return res.status(404).json({ error: 'House not found' });
    await query('INSERT INTO inquiries (house_id, user_id, channel) VALUES ($1, $2, $3)',
      [houseResult.rows[0].id, req.user ? req.user.id : null, (req.body && req.body.channel) || 'whatsapp']);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
