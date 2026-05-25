require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { testConnection } = require('./config/database');
const routes = require('./routes/index');
const setupSocket = require('./socket/chatSocket');
const { setIo } = require('./socketInstance');
const { accessMiddleware, errorMiddleware, info } = require('./utils/logger');

const app = express();
const server = http.createServer(app);

// ── SOCKET.IO ─────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});
setupSocket(io);
setIo(io);

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('dev'));
app.use(accessMiddleware);
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── RATE LIMITING ─────────────────────────────────────────────

// limiter général (plus large)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: 'Too many requests'
});

// limiter strict seulement pour login
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many login attempts'
});

// appliquer
app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);

// ── STATIC FILES ──────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── ROUTES ────────────────────────────────────────────────────
app.use('/api', routes);

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) =>
  res.status(404).json({
    success: false,
    message: 'Route non trouvée'
  })
);

// ── ERROR HANDLER ─────────────────────────────────────────────
app.use(errorMiddleware);

// ── START SERVER ──────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

const runMigrations = async () => {
  const { pool } = require('./config/database');
  const migrations = [
    `ALTER TABLE quote_requests ADD COLUMN group_id VARCHAR(36) NULL`,
    `ALTER TABLE quote_requests ADD COLUMN description TEXT NULL`,
    `ALTER TABLE quote_requests ADD COLUMN type_slug VARCHAR(100) NULL`,
    `ALTER TABLE quote_requests MODIFY COLUMN event_date DATE NULL DEFAULT NULL`,
    `ALTER TABLE quote_requests MODIFY COLUMN guest_count INT NULL DEFAULT NULL`,
    `ALTER TABLE quotes ADD COLUMN group_items TEXT NULL`,
    `ALTER TABLE quotes ADD COLUMN request_id INT NULL`,
    `CREATE TABLE IF NOT EXISTS provider_options (id INT AUTO_INCREMENT PRIMARY KEY, provider_id INT NOT NULL, name VARCHAR(255) NOT NULL, description TEXT, price DECIMAL(10,2) NOT NULL DEFAULT 0, category VARCHAR(100) DEFAULT 'Standard', is_active TINYINT(1) DEFAULT 1, sort_order INT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE)`,
    `ALTER TABLE provider_options ADD COLUMN image_url VARCHAR(500) NULL`,
    `ALTER TABLE provider_options ADD COLUMN includes_standard TINYINT(1) DEFAULT 0`,
    `ALTER TABLE providers ADD COLUMN standard_fee DECIMAL(10,2) DEFAULT 0`,
    `ALTER TABLE quote_requests MODIFY COLUMN status ENUM('pending','quoted','cancelled','date_unavailable') NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE provider_availability MODIFY COLUMN status ENUM('available','reserved','blocked','pending') NOT NULL DEFAULT 'available'`,
    `UPDATE quotes SET payment_enabled = 1 WHERE payment_enabled = 0 OR payment_enabled IS NULL`,
    `INSERT IGNORE INTO settings (setting_key, setting_value, setting_type) VALUES ('whatsapp_number', '', 'text')`,
    `ALTER TABLE providers ADD COLUMN whatsapp VARCHAR(30) NULL`,
    `INSERT IGNORE INTO settings (setting_key, setting_value, setting_type) VALUES ('homepage_slide_1', 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1920&q=85&auto=format&fit=crop', 'text')`,
    `INSERT IGNORE INTO settings (setting_key, setting_value, setting_type) VALUES ('homepage_slide_2', 'https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=1920&q=85&auto=format&fit=crop', 'text')`,
    `INSERT IGNORE INTO settings (setting_key, setting_value, setting_type) VALUES ('homepage_slide_3', 'https://images.unsplash.com/photo-1555244162-803834f70033?w=1920&q=85&auto=format&fit=crop', 'text')`,
    `INSERT IGNORE INTO settings (setting_key, setting_value, setting_type) VALUES ('homepage_slide_4', 'https://images.unsplash.com/photo-1478146896981-b80fe463b330?w=1920&q=85&auto=format&fit=crop', 'text')`,
    `INSERT IGNORE INTO settings (setting_key, setting_value, setting_type) VALUES ('category_discount_enabled', '0', 'boolean')`,
    `ALTER TABLE providers ADD COLUMN commission_percentage DECIMAL(5,2) NOT NULL DEFAULT 15.00`,
    `ALTER TABLE quotes ADD COLUMN commission_percentage DECIMAL(5,2) NOT NULL DEFAULT 15.00`,
    `CREATE TABLE IF NOT EXISTS event_briefs (id INT AUTO_INCREMENT PRIMARY KEY, quote_id INT NOT NULL UNIQUE, prohibited_items TEXT NULL, not_to_bring TEXT NULL, juice_rounds INT DEFAULT 0, tea_rounds INT DEFAULT 0, alcohol_included TINYINT(1) DEFAULT 0, savory_rounds INT DEFAULT 0, comments TEXT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE)`,
    `ALTER TABLE provider_options ADD COLUMN includes_items TEXT NULL`,
    `CREATE TABLE IF NOT EXISTS reviews (id INT AUTO_INCREMENT PRIMARY KEY, provider_id INT NOT NULL, user_id INT NOT NULL, quote_id INT NOT NULL, rating TINYINT NOT NULL DEFAULT 5, comment TEXT NULL, is_approved TINYINT(1) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE)`,
    `UPDATE provider_types SET discount_percentage = 15`,
    `UPDATE settings SET setting_value = '1' WHERE setting_key = 'category_discount_enabled'`,
    `UPDATE reviews SET is_approved = 1 WHERE is_approved = 0`,
    `ALTER TABLE provider_packages ADD COLUMN fixed_items TEXT NULL`,
    `ALTER TABLE users ADD COLUMN google_id VARCHAR(255) NULL`,
    `ALTER TABLE users ADD COLUMN avatar VARCHAR(500) NULL`,
  ];
  for (const sql of migrations) {
    try { await pool.execute(sql); } catch (_) {}
  }
};

server.listen(PORT, async () => {
  await testConnection();
  await runMigrations();
  info(`PrestaLink Backend running on port ${PORT}`);
  console.log(`📡 Socket.io ready`);
  console.log(`🌍 Frontend: ${process.env.FRONTEND_URL}`);
});