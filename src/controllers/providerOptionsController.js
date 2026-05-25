const { pool } = require('../config/database');

// ── PUBLIC ────────────────────────────────────────────────────
exports.getByProvider = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM provider_options WHERE provider_id = ? AND is_active = 1 ORDER BY sort_order ASC, id ASC',
      [req.params.providerId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── ADMIN — all (including inactive) ─────────────────────────
exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM provider_options WHERE provider_id = ? ORDER BY sort_order ASC, id ASC',
      [req.params.providerId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, description, price, category, sort_order, is_active, image_url, includes_standard, includes_items } = req.body;
    if (!name || name.trim() === '') return res.status(400).json({ success: false, message: 'Nom requis' });
    const itemsJson = Array.isArray(includes_items) && includes_items.length ? JSON.stringify(includes_items) : null;
    const [result] = await pool.execute(
      'INSERT INTO provider_options (provider_id, name, description, price, category, sort_order, is_active, image_url, includes_standard, includes_items) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [req.params.providerId, name.trim(), description || null, Number(price) || 0, category?.trim() || 'Standard', Number(sort_order) || 0, is_active !== false ? 1 : 0, image_url || null, includes_standard ? 1 : 0, itemsJson]
    );
    const [rows] = await pool.execute('SELECT * FROM provider_options WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.update = async (req, res) => {
  try {
    const { name, description, price, category, sort_order, is_active, image_url, includes_standard, includes_items } = req.body;
    const itemsJson = Array.isArray(includes_items) && includes_items.length ? JSON.stringify(includes_items) : null;
    await pool.execute(
      'UPDATE provider_options SET name=?, description=?, price=?, category=?, sort_order=?, is_active=?, image_url=?, includes_standard=?, includes_items=? WHERE id=? AND provider_id=?',
      [name?.trim() || '', description || null, Number(price) || 0, category?.trim() || 'Standard', Number(sort_order) || 0, is_active ? 1 : 0, image_url || null, includes_standard ? 1 : 0, itemsJson, req.params.id, req.params.providerId]
    );
    res.json({ success: true, message: 'Option mise à jour' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.delete = async (req, res) => {
  try {
    await pool.execute(
      'DELETE FROM provider_options WHERE id=? AND provider_id=?',
      [req.params.id, req.params.providerId]
    );
    res.json({ success: true, message: 'Option supprimée' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};
