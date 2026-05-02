const fs   = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', '..', '..', 'logs');

// Ensure logs dir exists at startup
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

const FILES = {
  access: path.join(LOGS_DIR, 'backend-access.log'),
  error:  path.join(LOGS_DIR, 'backend-error.log'),
};

const ts = () => new Date().toISOString();

const write = (file, line) =>
  fs.appendFile(file, line + '\n', (err) => { if (err) console.error('[Logger]', err.message); });

// Log HTTP request after response
const accessMiddleware = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms   = Date.now() - start;
    const line = `[${ts()}] ${req.method} ${res.statusCode} ${req.originalUrl} ${ms}ms | ip:${req.ip} | ua:${(req.headers['user-agent'] || '-').slice(0, 80)}`;
    write(FILES.access, line);
  });
  next();
};

// Log errors
const logError = (err, req = null) => {
  const ctx  = req ? `${req.method} ${req.originalUrl}` : 'SYSTEM';
  const line = `[${ts()}] ERROR ${ctx} | ${err.message} | stack:${err.stack?.split('\n')[1]?.trim() || '-'}`;
  write(FILES.error, line);
};

// Express error handler middleware
const errorMiddleware = (err, req, res, next) => {
  logError(err, req);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Erreur serveur interne' });
};

// Info log
const info = (msg) => {
  const line = `[${ts()}] INFO  ${msg}`;
  write(FILES.access, line);
  console.log(line);
};

module.exports = { accessMiddleware, errorMiddleware, logError, info };
