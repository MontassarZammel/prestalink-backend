const { pool } = require('../config/database');

// ── PUBLIC ────────────────────────────────────────────────────

exports.getByProvider = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM provider_packages WHERE provider_id = ? AND is_active = 1 ORDER BY sort_order ASC, id ASC',
      [req.params.providerId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── ADMIN ─────────────────────────────────────────────────────

exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM provider_packages WHERE provider_id = ? ORDER BY sort_order ASC, id ASC',
      [req.params.providerId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, description, price_per_person, min_persons, max_persons, includes, sort_order } = req.body;
    const { providerId } = req.params;
    const [result] = await pool.execute(
      'INSERT INTO provider_packages (provider_id, name, description, price_per_person, min_persons, max_persons, includes, sort_order) VALUES (?,?,?,?,?,?,?,?)',
      [providerId, name, description || null, price_per_person, min_persons || 1, max_persons || null, includes ? JSON.stringify(includes) : null, sort_order || 0]
    );
    const [rows] = await pool.execute('SELECT * FROM provider_packages WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.update = async (req, res) => {
  try {
    const { name, description, price_per_person, min_persons, max_persons, includes, is_active, sort_order } = req.body;
    await pool.execute(
      'UPDATE provider_packages SET name=?, description=?, price_per_person=?, min_persons=?, max_persons=?, includes=?, is_active=?, sort_order=? WHERE id=? AND provider_id=?',
      [name, description || null, price_per_person, min_persons || 1, max_persons || null, includes ? JSON.stringify(includes) : null, is_active ?? 1, sort_order || 0, req.params.id, req.params.providerId]
    );
    const [rows] = await pool.execute('SELECT * FROM provider_packages WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.delete = async (req, res) => {
  try {
    await pool.execute('DELETE FROM provider_packages WHERE id = ? AND provider_id = ?', [req.params.id, req.params.providerId]);
    res.json({ success: true, message: 'Pack supprimé' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── ADMIN — upsert fixed 5/7/10 traiteur packs ───────────────

exports.saveTraiteurPacks = async (req, res) => {
  try {
    const { packages } = req.body;
    const { providerId } = req.params;

    for (const pkg of packages) {
      const { pieces_count, price_per_person, discount_percentage, is_active } = pkg;
      const name = `${pieces_count} pièces/personne`;
      const sortOrder = pieces_count === 5 ? 1 : pieces_count === 7 ? 2 : 3;

      const [existing] = await pool.execute(
        'SELECT id FROM provider_packages WHERE provider_id = ? AND pieces_count = ?',
        [providerId, pieces_count]
      );

      const fixedItemsJson = pkg.fixed_items && Array.isArray(pkg.fixed_items) && pkg.fixed_items.length
        ? JSON.stringify(pkg.fixed_items)
        : null;

      if (existing.length) {
        await pool.execute(
          'UPDATE provider_packages SET price_per_person=?, discount_percentage=?, is_active=?, name=?, fixed_items=? WHERE id=?',
          [price_per_person || 0, discount_percentage || 0, is_active ? 1 : 0, name, fixedItemsJson, existing[0].id]
        );
      } else {
        await pool.execute(
          'INSERT INTO provider_packages (provider_id, name, pieces_count, price_per_person, discount_percentage, is_active, sort_order, fixed_items) VALUES (?,?,?,?,?,?,?,?)',
          [providerId, name, pieces_count, price_per_person || 0, discount_percentage || 0, is_active ? 1 : 0, sortOrder, fixedItemsJson]
        );
      }
    }

    const [rows] = await pool.execute(
      'SELECT * FROM provider_packages WHERE provider_id = ? ORDER BY sort_order ASC, pieces_count ASC',
      [providerId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};
