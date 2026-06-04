const multer = require('multer');
const path = require('path');
const fs = require('fs');

const hasCloudinary = process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;

// ── CLOUDINARY (production) ───────────────────────────────────
let cloudinary, streamifier;
if (hasCloudinary) {
  cloudinary = require('cloudinary').v2;
  streamifier = require('streamifier');
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// ── MULTER ────────────────────────────────────────────────────
const storage = hasCloudinary
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(__dirname, '..', '..', 'uploads');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
      },
    });

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images uniquement'));
  },
});

exports.middleware = upload.single('image');

exports.uploadImage = (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier' });

  // Local disk fallback — use relative URL so Vite proxy handles it in dev
  if (!hasCloudinary) {
    return res.json({ success: true, url: `/uploads/${req.file.filename}` });
  }

  // Cloudinary upload
  const uploadStream = cloudinary.uploader.upload_stream(
    { folder: 'prestalink', resource_type: 'image' },
    (error, result) => {
      if (error) {
        console.error('Cloudinary error:', error);
        return res.status(500).json({ success: false, message: 'Erreur upload' });
      }
      res.json({ success: true, url: result.secure_url });
    }
  );
  streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
};
