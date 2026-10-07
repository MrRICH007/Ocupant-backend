const express = require('express');
const db = require('../db');
const { optionalAuth, requireAdmin } = require('../middleware/auth1');

const router = express.Router();

function parseVideos(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).map(v => v.trim()).filter(Boolean);
  } catch (_) {}
  return String(value).split(/\r?\n|,/).map(v => v.trim()).filter(Boolean);
}

function serializeVideos(value) {
  return JSON.stringify(parseVideos(value));
}

function publicHouse(h, premium) {
  const house = {
    id: h.id,
    title: h.title,
    type: h.type,
    status: h.status,
    beds: h.beds,
    baths: h.baths,
    area: h.area,
    firstYearPrice: h.first_year_price,
    subsequentPrice: h.subsequent_price,
    image: h.image,
    description: h.description,
    location: premium ? h.location : h.generic_location,
    genericLocation: h.generic_location,
    exactLocationHidden: !premium,
    videos: parseVideos(h.videos)
  };

  if (premium) {
    house.googleMapsUrl = h.google_maps_url || '';
    house.owner = { name: h.owner_name, phone: h.owner_phone, whatsapp: h.owner_whatsapp };
  }
  return house;
}

router.get('/', optionalAuth, (req, res) => {
  const { search, type, status, minPrice, maxPrice } = req.query;
  let sql = 'SELECT * FROM houses WHERE 1=1';
  const params = {};

  if (search) {
    sql += ' AND (title LIKE @search OR location LIKE @search OR generic_location LIKE @search)';
    params.search = '%' + search + '%';
  }
  if (type) { sql += ' AND type = @type'; params.type = type; }
  if (status) { sql += ' AND status = @status'; params.status = status; }
  if (minPrice) { sql += ' AND first_year_price >= @minPrice'; params.minPrice = Number(minPrice); }
  if (maxPrice) { sql += ' AND first_year_price <= @maxPrice'; params.maxPrice = Number(maxPrice); }

  sql += ' ORDER BY id DESC';
  const rows = db.prepare(sql).all(params);
  res.json({ premium: !!req.premium, houses: rows.map(h => publicHouse(h, req.premium)) });
});

router.get('/:id', optionalAuth, (req, res) => {
  const house = db.prepare('SELECT * FROM houses WHERE id = ?').get(req.params.id);
  if (!house) return res.status(404).json({ error: 'House not found' });
  res.json({ premium: !!req.premium, house: publicHouse(house, req.premium) });
});

router.post('/', requireAdmin, (req, res) => {
  const b = req.body || {};
  const required = ['title', 'location', 'genericLocation', 'type', 'firstYearPrice', 'subsequentPrice', 'ownerName', 'ownerPhone', 'ownerWhatsapp'];
  const missing = required.filter(f => b[f] === undefined || b[f] === '');
  if (missing.length) return res.status(400).json({ error: 'Missing fields: ' + missing.join(', ') });

  const info = db.prepare(`
    INSERT INTO houses (
      title, location, generic_location, type, status, beds, baths, area,
      first_year_price, subsequent_price, image, description,
      owner_name, owner_phone, owner_whatsapp, google_maps_url, videos
    ) VALUES (
      @title, @location, @genericLocation, @type, @status, @beds, @baths, @area,
      @firstYearPrice, @subsequentPrice, @image, @description,
      @ownerName, @ownerPhone, @ownerWhatsapp, @googleMapsUrl, @videos
    )
  `).run({
    title: b.title,
    location: b.location,
    genericLocation: b.genericLocation,
    type: b.type,
    status: b.status || 'vacant',
    beds: b.beds || 1,
    baths: b.baths || 1,
    area: b.area || '',
    firstYearPrice: b.firstYearPrice,
    subsequentPrice: b.subsequentPrice,
    image: b.image || '',
    description: b.description || '',
    ownerName: b.ownerName,
    ownerPhone: b.ownerPhone,
    ownerWhatsapp: b.ownerWhatsapp,
    googleMapsUrl: b.googleMapsUrl || b.googleMapUrl || b.mapsUrl || '',
    videos: serializeVideos(b.videos)
  });

  const house = db.prepare('SELECT * FROM houses WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ house: publicHouse(house, true) });
});

router.put('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM houses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'House not found' });

  const b = { ...existing, ...req.body };
  const googleMapsUrl = b.googleMapsUrl ?? b.googleMapUrl ?? b.mapsUrl ?? existing.google_maps_url ?? '';
  const videos = b.videos === undefined ? existing.videos : serializeVideos(b.videos);

  db.prepare(`
    UPDATE houses SET
      title=@title, location=@location, generic_location=@generic_location,
      type=@type, status=@status, beds=@beds, baths=@baths, area=@area,
      first_year_price=@first_year_price, subsequent_price=@subsequent_price,
      image=@image, description=@description, owner_name=@owner_name,
      owner_phone=@owner_phone, owner_whatsapp=@owner_whatsapp,
      google_maps_url=@google_maps_url, videos=@videos
    WHERE id=@id
  `).run({
    id: existing.id,
    title: b.title,
    location: b.location,
    generic_location: b.generic_location,
    type: b.type,
    status: b.status,
    beds: b.beds,
    baths: b.baths,
    area: b.area,
    first_year_price: b.first_year_price,
    subsequent_price: b.subsequent_price,
    image: b.image,
    description: b.description,
    owner_name: b.owner_name,
    owner_phone: b.owner_phone,
    owner_whatsapp: b.owner_whatsapp,
    google_maps_url: googleMapsUrl,
    videos
  });

  const house = db.prepare('SELECT * FROM houses WHERE id = ?').get(existing.id);
  res.json({ house: publicHouse(house, true) });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM houses WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'House not found' });
  res.json({ ok: true });
});

router.post('/:id/inquire', optionalAuth, (req, res) => {
  const house = db.prepare('SELECT id FROM houses WHERE id = ?').get(req.params.id);
  if (!house) return res.status(404).json({ error: 'House not found' });
  db.prepare('INSERT INTO inquiries (house_id, user_id, channel) VALUES (?, ?, ?)')
    .run(house.id, req.user ? req.user.id : null, (req.body && req.body.channel) || 'whatsapp');
  res.status(201).json({ ok: true });
});

module.exports = router;
