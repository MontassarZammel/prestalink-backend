const mysql = require('mysql2/promise');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// Support DATABASE_URL (Railway) or individual vars
let dbConfig;
const dbUrl = process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL;

if (dbUrl) {
  const u = new URL(dbUrl);
  dbConfig = {
    host: u.hostname,
    port: Number(u.port) || 3306,
    user: u.username,
    password: u.password,
    database: u.pathname.replace('/', ''),
  };
} else {
  dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root123',
    database: process.env.DB_NAME || 'prestalink',
  };
}

const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+01:00',
  ...(isProduction && { ssl: { rejectUnauthorized: false } }),
});

const testConnection = async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL connected successfully');
    conn.release();
  } catch (error) {
    console.error('❌ MySQL connection failed:', error.message);
    process.exit(1);
  }
};

module.exports = { pool, testConnection };
