const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (user) => jwt.sign(
  { id: user.id, email: user.email, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });

    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
    if (!rows.length) return res.status(401).json({ success: false, message: 'Identifiants incorrects' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ success: false, message: 'Identifiants incorrects' });

    const token = generateToken(user);
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.register = async (req, res) => {
  try {
    const { email, password, full_name, phone } = req.body;
    if (!email || !password || !full_name) return res.status(400).json({ success: false, message: 'Champs requis manquants' });

    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) return res.status(409).json({ success: false, message: 'Email déjà utilisé' });

    const hashed = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO users (email, password, full_name, phone, role) VALUES (?, ?, ?, ?, "client")',
      [email, hashed, full_name, phone || null]
    );
    const [user] = await pool.execute('SELECT id, email, full_name, role FROM users WHERE id = ?', [result.insertId]);
    const token = generateToken(user[0]);
    res.status(201).json({ success: true, token, user: user[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.me = async (req, res) => {
  res.json({ success: true, user: req.user });
};

exports.updateProfile = async (req, res) => {
  try {
    const { full_name, phone, current_password, new_password } = req.body;
    const userId = req.user.id;

    if (new_password) {
      const [rows] = await pool.execute('SELECT password FROM users WHERE id = ?', [userId]);
      const valid = await bcrypt.compare(current_password || '', rows[0]?.password || '');
      if (!valid) return res.status(400).json({ success: false, message: 'Mot de passe actuel incorrect' });
      const hashed = await bcrypt.hash(new_password, 10);
      await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, userId]);
    }

    if (full_name || phone !== undefined) {
      const fields = [];
      const vals = [];
      if (full_name) { fields.push('full_name = ?'); vals.push(full_name); }
      if (phone !== undefined) { fields.push('phone = ?'); vals.push(phone || null); }
      if (fields.length) { vals.push(userId); await pool.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, vals); }
    }

    const [rows] = await pool.execute('SELECT id, email, full_name, phone, role FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.googleAuth = async (req, res) => {
  try {
    const { access_token, profile } = req.body;
    if (!access_token || !profile) return res.status(400).json({ success: false, message: 'Token Google manquant' });

    const { email, name, picture, sub: googleId } = profile;

    let [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    let user;

    if (rows.length) {
      user = rows[0];
      if (!user.google_id) {
        await pool.execute('UPDATE users SET google_id = ?, avatar = ? WHERE id = ?', [googleId, picture || user.avatar, user.id]);
      }
    } else {
      const [result] = await pool.execute(
        'INSERT INTO users (email, password, full_name, role, google_id, avatar) VALUES (?, ?, ?, "client", ?, ?)',
        [email, await bcrypt.hash(googleId + process.env.JWT_SECRET, 10), name, googleId, picture || null]
      );
      const [newUser] = await pool.execute('SELECT * FROM users WHERE id = ?', [result.insertId]);
      user = newUser[0];
    }

    if (!user.is_active) return res.status(403).json({ success: false, message: 'Compte désactivé' });

    const token = generateToken(user);
    res.json({ success: true, token, user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, avatar: user.avatar } });
  } catch (error) {
    console.error('Google auth error:', error.message);
    res.status(401).json({ success: false, message: 'Token Google invalide' });
  }
};
