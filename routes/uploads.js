const express = require('express');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { requireAdmin } = require('../middleware/auth1');

const router = express.Router();
const MAX_BYTES = 8 * 1024 * 1024;
const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);

function configureCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    const err = new Error('Image uploads are not configured yet. Add the Cloudinary environment variables in Render.');
    err.status = 503;
    throw err;
  }
  cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET, secure: true });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!allowed.has(file.mimetype)) return cb(new Error('Choose a JPG, PNG, or WebP image.'));
    cb(null, true);
  }
});

router.post('/image', requireAdmin, (req, res, next) => {
  upload.single('image')(req, res, async err => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 8 MB or smaller.' : err.message;
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: 'Choose an image to upload.' });
    try {
      configureCloudinary();
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({
          folder: 'ocupant/properties',
          resource_type: 'image',
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
          transformation: [{ quality: 'auto:good', fetch_format: 'auto' }]
        }, (error, uploaded) => error ? reject(error) : resolve(uploaded));
        stream.end(req.file.buffer);
      });
      res.status(201).json({ image: result.secure_url, publicId: result.public_id, width: result.width, height: result.height });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  });
});

module.exports = router;
