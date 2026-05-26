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
    // ── BASE SCHEMA ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL, full_name VARCHAR(255) NOT NULL, phone VARCHAR(50) NULL, role ENUM('client','admin') NOT NULL DEFAULT 'client', is_active TINYINT(1) DEFAULT 1, google_id VARCHAR(255) NULL, avatar VARCHAR(500) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS provider_types (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, slug VARCHAR(100) NOT NULL UNIQUE, description TEXT NULL, discount_percentage DECIMAL(5,2) DEFAULT 0, icon VARCHAR(100) NULL, image VARCHAR(500) NULL, is_active TINYINT(1) DEFAULT 1, display_order INT DEFAULT 0, meta_title VARCHAR(255) NULL, meta_description TEXT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS providers (id INT AUTO_INCREMENT PRIMARY KEY, type_id INT NOT NULL, name VARCHAR(255) NOT NULL, slug VARCHAR(255) NOT NULL UNIQUE, short_description VARCHAR(500) NULL, description TEXT NULL, email VARCHAR(255) NULL, phone VARCHAR(50) NULL, website VARCHAR(500) NULL, city VARCHAR(100) NULL, governorate VARCHAR(100) NULL, address TEXT NULL, latitude DECIMAL(10,7) NULL, longitude DECIMAL(10,7) NULL, price_min DECIMAL(10,2) DEFAULT 0, price_max DECIMAL(10,2) DEFAULT 0, is_featured TINYINT(1) DEFAULT 0, is_active TINYINT(1) DEFAULT 1, rating DECIMAL(3,2) DEFAULT 0, logo VARCHAR(500) NULL, cover_image VARCHAR(500) NULL, standard_fee DECIMAL(10,2) DEFAULT 0, commission_percentage DECIMAL(5,2) DEFAULT 15.00, whatsapp VARCHAR(30) NULL, meta_title VARCHAR(255) NULL, meta_description TEXT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (type_id) REFERENCES provider_types(id) ON DELETE CASCADE)`,
    `ALTER TABLE providers ADD COLUMN website VARCHAR(500) NULL`,
    `ALTER TABLE providers ADD COLUMN latitude DECIMAL(10,7) NULL`,
    `ALTER TABLE providers ADD COLUMN longitude DECIMAL(10,7) NULL`,
    `CREATE TABLE IF NOT EXISTS provider_images (id INT AUTO_INCREMENT PRIMARY KEY, provider_id INT NOT NULL, image_url VARCHAR(500) NOT NULL, display_order INT DEFAULT 0, sort_order INT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE)`,
    `ALTER TABLE provider_images ADD COLUMN display_order INT DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS provider_services (id INT AUTO_INCREMENT PRIMARY KEY, provider_id INT NOT NULL, name VARCHAR(255) NOT NULL, description TEXT NULL, price DECIMAL(10,2) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS provider_packages (id INT AUTO_INCREMENT PRIMARY KEY, provider_id INT NOT NULL, name VARCHAR(255) NOT NULL, pieces_count INT NULL, description TEXT NULL, price_per_person DECIMAL(10,2) DEFAULT 0, discount_percentage DECIMAL(5,2) DEFAULT 0, min_persons INT DEFAULT 1, max_persons INT NULL, includes TEXT NULL, fixed_items TEXT NULL, is_active TINYINT(1) DEFAULT 1, sort_order INT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS provider_availability (id INT AUTO_INCREMENT PRIMARY KEY, provider_id INT NOT NULL, date DATE NOT NULL, status ENUM('available','reserved','blocked','pending') NOT NULL DEFAULT 'available', note VARCHAR(255) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY unique_provider_date (provider_id, date), FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS settings (id INT AUTO_INCREMENT PRIMARY KEY, setting_key VARCHAR(100) NOT NULL UNIQUE, setting_value TEXT NULL, setting_type VARCHAR(50) DEFAULT 'text', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS quotes (id INT AUTO_INCREMENT PRIMARY KEY, quote_number VARCHAR(50) NULL, client_id INT NULL, provider_id INT NOT NULL, client_name VARCHAR(255) NOT NULL, client_email VARCHAR(255) NOT NULL, client_phone VARCHAR(50) NULL, description TEXT NULL, event_date DATE NULL, guest_count INT NULL, price_before_discount DECIMAL(10,2) DEFAULT 0, discount_percentage DECIMAL(5,2) DEFAULT 0, discount_amount DECIMAL(10,2) DEFAULT 0, price_after_discount DECIMAL(10,2) DEFAULT 0, advance_payment DECIMAL(10,2) DEFAULT 0, advance_percentage DECIMAL(5,2) DEFAULT 30, valid_until DATE NULL, status ENUM('draft','sent','accepted','rejected','cancelled') DEFAULT 'draft', payment_status ENUM('pending','partial','paid') DEFAULT 'pending', payment_enabled TINYINT(1) DEFAULT 1, notes TEXT NULL, commission_percentage DECIMAL(5,2) DEFAULT 15.00, group_items TEXT NULL, request_id INT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE)`,
    `ALTER TABLE quotes ADD COLUMN guest_count INT NULL`,
    `CREATE TABLE IF NOT EXISTS quote_requests (id INT AUTO_INCREMENT PRIMARY KEY, provider_id INT NOT NULL, package_id INT NULL, user_id INT NULL, client_name VARCHAR(255) NULL, client_email VARCHAR(255) NULL, client_phone VARCHAR(50) NULL, group_id VARCHAR(36) NULL, type_slug VARCHAR(100) NULL, description TEXT NULL, notes TEXT NULL, event_date DATE NULL, guest_count INT NULL, status ENUM('pending','quoted','cancelled','date_unavailable') NOT NULL DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE)`,
    `ALTER TABLE quote_requests ADD COLUMN package_id INT NULL`,
    `ALTER TABLE quote_requests ADD COLUMN client_name VARCHAR(255) NULL`,
    `ALTER TABLE quote_requests ADD COLUMN client_email VARCHAR(255) NULL`,
    `ALTER TABLE quote_requests ADD COLUMN client_phone VARCHAR(50) NULL`,
    `ALTER TABLE quote_requests ADD COLUMN notes TEXT NULL`,
    `ALTER TABLE quote_requests ADD COLUMN quote_id INT NULL`,
    `CREATE TABLE IF NOT EXISTS payments (id INT AUTO_INCREMENT PRIMARY KEY, quote_id INT NOT NULL, payment_ref VARCHAR(255) NOT NULL, gateway VARCHAR(50) NOT NULL, amount DECIMAL(10,2) NOT NULL, status ENUM('pending','completed','failed') DEFAULT 'pending', payment_type VARCHAR(50) NULL, paid_at TIMESTAMP NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS conversations (id INT AUTO_INCREMENT PRIMARY KEY, client_id INT NULL, visitor_session_id VARCHAR(255) NULL, client_name VARCHAR(255) NULL, client_email VARCHAR(255) NULL, subject VARCHAR(500) NULL, status ENUM('open','closed') DEFAULT 'open', last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `ALTER TABLE conversations ADD COLUMN last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
    `CREATE TABLE IF NOT EXISTS messages (id INT AUTO_INCREMENT PRIMARY KEY, conversation_id INT NOT NULL, sender_role ENUM('client','admin','visitor') NOT NULL, content TEXT NOT NULL, is_read TINYINT(1) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)`,
    `UPDATE users SET password='$2a$12$uZpUwAZeN8ZMapu6vKUP0.6Ddikno8LheYsmbXu9.F5D5A2qP.aGG', role='admin' WHERE email='admin@mywedding.tn'`,
    `ALTER TABLE provider_types ADD COLUMN is_active TINYINT(1) DEFAULT 1`,
    `ALTER TABLE provider_types ADD COLUMN display_order INT DEFAULT 0`,
    `ALTER TABLE provider_types ADD COLUMN image VARCHAR(500) NULL`,
    // ── END BASE SCHEMA ──────────────────────────────────────────
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

const runSeed = async () => {
  const { pool } = require('./config/database');
  try {
    const [rows] = await pool.execute('SELECT COUNT(*) as cnt FROM provider_types');
    if (rows[0].cnt > 0) return;
  } catch (_) { return; }

  const seeds = [
    `INSERT IGNORE INTO provider_types (name, slug, description, discount_percentage, icon, meta_title, meta_description) VALUES ('Photographes','photographes','Photographes et vidéastes professionnels pour vos événements',10,'camera','Photographes événementiels Tunisie | PrestaLink','Trouvez les meilleurs photographes de mariage en Tunisie'),('Traiteurs','traiteurs','Traiteurs et chefs cuisiniers pour vos réceptions',12,'chef-hat','Traiteurs mariage Tunisie | PrestaLink','Les meilleurs traiteurs pour vos mariages en Tunisie'),('Décorateurs','decorateurs','Décorateurs et stylistes pour sublimer vos événements',8,'palette','Décorateurs événementiels Tunisie | PrestaLink','Décorateurs de mariage professionnels en Tunisie'),('Animateurs','animateurs','DJ, orchestres et animateurs pour vos fêtes',10,'music','Animateurs mariage Tunisie | PrestaLink','Animateurs et DJ professionnels pour vos événements'),('Fleuristes','fleuristes','Fleuristes spécialisés en décoration florale événementielle',8,'flower','Fleuristes mariage Tunisie | PrestaLink','Bouquets et décorations florales pour mariages'),('Salles de Fêtes','locations-salles','Salles de réception et espaces événementiels',5,'building','Salles de fêtes Tunisie | PrestaLink','Location de salles de fêtes et espaces événementiels')`,
    `INSERT IGNORE INTO users (email, password, full_name, role) VALUES ('admin@mywedding.tn','$2a$12$uZpUwAZeN8ZMapu6vKUP0.6Ddikno8LheYsmbXu9.F5D5A2qP.aGG','Admin MyWedding','admin')`,
    `INSERT INTO providers (type_id, name, slug, short_description, description, email, phone, city, governorate, price_min, price_max, is_featured, is_active, rating, meta_title, meta_description) VALUES ((SELECT id FROM provider_types WHERE slug='photographes'),'Adem Photographe','adem-photographe','Photographe de mariage haut de gamme à Tunis','Adem capture chaque émotion avec une sensibilité artistique unique.','adem@photo.tn','+216 22 111 000','Tunis','Tunis',2500,8000,1,1,4.9,'Adem Photographe Mariage Tunis | PrestaLink','Photographe mariage professionnel à Tunis'),((SELECT id FROM provider_types WHERE slug='photographes'),'Studio Lumière Sousse','studio-lumiere-sousse','Studio photo & vidéo mariage à Sousse','Studio Lumière réunit une équipe de 3 photographes et 2 vidéastes.','contact@studiolumiere.tn','+216 73 000 111','Sousse','Sousse',3000,10000,1,1,4.8,'Studio Lumière Sousse — Photo & Vidéo Mariage','Studio photo et vidéo mariage à Sousse'),((SELECT id FROM provider_types WHERE slug='photographes'),'Hamza Vision','hamza-vision','Photographe naturaliste basé à Sfax','Un regard naturel et discret pour capturer vos moments.','hamza@vision.tn','+216 98 222 333','Sfax','Sfax',1800,5000,0,1,4.7,'Hamza Vision — Photographe Sfax','Photographe naturaliste pour mariages à Sfax')`,
    `INSERT INTO providers (type_id, name, slug, short_description, description, email, phone, city, governorate, price_min, price_max, is_featured, is_active, rating, meta_title, meta_description) VALUES ((SELECT id FROM provider_types WHERE slug='traiteurs'),'Saveurs du Bosphore','saveurs-du-bosphore','Cuisine orientale raffinée pour vos grandes occasions','Saveurs du Bosphore propose une cuisine orientale et méditerranéenne d''exception.','contact@saveursbosphore.tn','+216 71 555 666','Tunis','Tunis',8000,50000,1,1,4.8,'Traiteur Mariage Tunis — Saveurs du Bosphore','Traiteur cuisine orientale pour mariages à Tunis'),((SELECT id FROM provider_types WHERE slug='traiteurs'),'Chef Karim Traiteur','chef-karim-traiteur','Gastronomie tunisienne et internationale, Nabeul','Chef Karim et son équipe proposent des buffets gastronomiques.','karim@traiteur.tn','+216 72 888 999','Nabeul','Nabeul',6000,30000,0,1,4.6,'Chef Karim Traiteur Nabeul — Gastronomie','Traiteur gastronomique pour mariages à Nabeul'),((SELECT id FROM provider_types WHERE slug='traiteurs'),'Le Banquet Royal','le-banquet-royal','Traiteur prestige pour événements d''exception à Sfax','Le Banquet Royal est la référence traiteur à Sfax depuis 15 ans.','info@banquetroyal.tn','+216 74 000 555','Sfax','Sfax',10000,60000,1,1,4.9,'Le Banquet Royal — Traiteur Prestige Sfax','Traiteur haut de gamme pour mariages à Sfax')`,
    `INSERT INTO providers (type_id, name, slug, short_description, description, email, phone, city, governorate, price_min, price_max, is_featured, is_active, rating, meta_title, meta_description) VALUES ((SELECT id FROM provider_types WHERE slug='decorateurs'),'Art & Déco Événements','art-deco-evenements','Décoration florale et scénographie mariage, Tunis','Notre atelier crée des ambiances uniques et personnalisées pour chaque couple.','contact@artdeco.tn','+216 20 111 222','Tunis','Tunis',3000,20000,1,1,4.9,'Art & Déco Événements Tunis — Décoration Mariage','Décorateur mariage Tunis'),((SELECT id FROM provider_types WHERE slug='decorateurs'),'Bloom Décoration','bloom-decoration','Décoration florale contemporaine, Sousse','Bloom crée des compositions florales de saison.','hello@bloom.tn','+216 73 444 555','Sousse','Sousse',2000,12000,0,1,4.7,'Bloom Décoration Florale Sousse','Décoration florale pour mariages à Sousse')`,
    `INSERT INTO providers (type_id, name, slug, short_description, description, email, phone, city, governorate, price_min, price_max, is_featured, is_active, rating, meta_title, meta_description) VALUES ((SELECT id FROM provider_types WHERE slug='animateurs'),'DJ Rafik','dj-rafik','DJ mariage et soirées privées, toute la Tunisie','DJ Rafik anime vos mariages et événements depuis 10 ans.','rafik@dj.tn','+216 55 777 888','Tunis','Tunis',1500,6000,1,1,4.8,'DJ Rafik — Animation Mariage Tunisie','DJ professionnel pour mariages en Tunisie'),((SELECT id FROM provider_types WHERE slug='animateurs'),'Orchestre El Farah','orchestre-el-farah','Orchestre traditionnel et moderne pour mariages','L''orchestre El Farah propose des concerts live.','elfarah@orchestre.tn','+216 71 333 444','Tunis','Tunis',3000,15000,0,1,4.6,'Orchestre El Farah — Musique Mariage Tunisie','Orchestre live pour mariages tunisiens')`,
    `INSERT INTO providers (type_id, name, slug, short_description, description, email, phone, city, governorate, price_min, price_max, is_featured, is_active, rating, meta_title, meta_description) VALUES ((SELECT id FROM provider_types WHERE slug='fleuristes'),'Les Roses de Tunis','les-roses-de-tunis','Bouquets et compositions florales haut de gamme','Les Roses de Tunis crée des bouquets de mariée et arches florales de prestige.','contact@rosesdetunis.tn','+216 71 222 333','Tunis','Tunis',800,5000,1,1,4.9,'Les Roses de Tunis — Fleuriste Mariage','Fleuriste mariage Tunis'),((SELECT id FROM provider_types WHERE slug='fleuristes'),'Fleurs & Sens Hammamet','fleurs-sens-hammamet','Fleuriste événementiel spécialisé en mariages bohèmes','Fleurs & Sens propose des créations florales bohèmes.','fleursens@hammamet.tn','+216 72 999 000','Hammamet','Nabeul',600,3500,0,1,4.7,'Fleurs & Sens Hammamet — Fleuriste Mariage Bohème','Fleuriste bohème pour mariages à Hammamet')`,
    `INSERT INTO providers (type_id, name, slug, short_description, description, email, phone, city, governorate, price_min, price_max, is_featured, is_active, rating, meta_title, meta_description) VALUES ((SELECT id FROM provider_types WHERE slug='locations-salles'),'Palais des Mille et Une Nuits','palais-mille-nuits','Salle de réception de luxe, Tunis Nord','Un cadre somptueux inspiré de l''architecture andalouse.','reservations@palais1001.tn','+216 71 900 800','La Marsa','Tunis',15000,80000,1,1,4.8,'Palais des Mille et Une Nuits — Salle Mariage Tunis','Salle de mariage luxueuse à Tunis'),((SELECT id FROM provider_types WHERE slug='locations-salles'),'Villa Jasmine Events','villa-jasmine-events','Espace événementiel en plein air, Hammamet','Villa Jasmine offre un cadre enchanteur en bord de mer.','info@villajasmine.tn','+216 72 700 600','Hammamet','Nabeul',12000,50000,1,1,4.9,'Villa Jasmine Events Hammamet — Mariage Bord de Mer','Salle de mariage vue mer à Hammamet'),((SELECT id FROM provider_types WHERE slug='locations-salles'),'Salle El Kods Sfax','salle-el-kods-sfax','Grande salle de réception au cœur de Sfax','Salle El Kods accueille vos mariages jusqu''à 600 personnes.','elkods@sfax.tn','+216 74 500 400','Sfax','Sfax',8000,35000,0,1,4.6,'Salle El Kods Sfax — Location Salle Mariage','Location salle de fête à Sfax')`,
  ];
  for (let i = 0; i < seeds.length; i++) {
    try { await pool.query(seeds[i]); } catch (e) { console.error(`Seed[${i}] error:`, e.message); }
  }
  console.log('✅ Seed data inserted');
};

server.listen(PORT, async () => {
  await testConnection();
  await runMigrations();
  await runSeed();
  info(`PrestaLink Backend running on port ${PORT}`);
  console.log(`📡 Socket.io ready`);
  console.log(`🌍 Frontend: ${process.env.FRONTEND_URL}`);
});