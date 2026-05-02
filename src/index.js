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

server.listen(PORT, async () => {
  await testConnection();
  info(`PrestaLink Backend running on port ${PORT}`);
  console.log(`📡 Socket.io ready`);
  console.log(`🌍 Frontend: ${process.env.FRONTEND_URL}`);
});