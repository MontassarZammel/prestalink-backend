const { pool } = require('../config/database');
const slugify = require('slugify');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM provider_types WHERE is_active = 1 ORDER BY display_order ASC'
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.getBySlug = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM provider_types WHERE slug = ? AND is_active = 1', [req.params.slug]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Type non trouvé' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, description, icon, image, discount_percentage, display_order, meta_title, meta_description } = req.body;
    const slug = slugify(name, { lower: true, strict: true, locale: 'fr' });
    const [result] = await pool.execute(
      'INSERT INTO provider_types (name, slug, description, icon, image, discount_percentage, display_order, meta_title, meta_description) VALUES (?,?,?,?,?,?,?,?,?)',
      [name, slug, description, icon, image, discount_percentage || 0, display_order || 0, meta_title || name, meta_description || description]
    );
    const [created] = await pool.execute('SELECT * FROM provider_types WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: created[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, icon, image, discount_percentage, display_order, is_active, meta_title, meta_description } = req.body;
    const slug = name ? slugify(name, { lower: true, strict: true, locale: 'fr' }) : undefined;
    const fields = [];
    const values = [];
    if (name) { fields.push('name = ?'); values.push(name); }
    if (slug) { fields.push('slug = ?'); values.push(slug); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }
    if (icon !== undefined) { fields.push('icon = ?'); values.push(icon); }
    if (image !== undefined) { fields.push('image = ?'); values.push(image); }
    if (discount_percentage !== undefined) { fields.push('discount_percentage = ?'); values.push(discount_percentage); }
    if (display_order !== undefined) { fields.push('display_order = ?'); values.push(display_order); }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active); }
    if (meta_title !== undefined) { fields.push('meta_title = ?'); values.push(meta_title); }
    if (meta_description !== undefined) { fields.push('meta_description = ?'); values.push(meta_description); }
    values.push(id);
    await pool.execute(`UPDATE provider_types SET ${fields.join(', ')} WHERE id = ?`, values);
    const [updated] = await pool.execute('SELECT * FROM provider_types WHERE id = ?', [id]);
    res.json({ success: true, data: updated[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.delete = async (req, res) => {
  try {
    await pool.execute('DELETE FROM provider_types WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Type supprimé' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.updateDiscount = async (req, res) => {
  try {
    const { id } = req.params;
    const { discount_percentage } = req.body;
    if (discount_percentage === undefined || discount_percentage < 0 || discount_percentage > 100) {
      return res.status(400).json({ success: false, message: 'Remise invalide (0-100)' });
    }
    await pool.execute('UPDATE provider_types SET discount_percentage = ? WHERE id = ?', [discount_percentage, id]);
    res.json({ success: true, message: 'Remise mise à jour' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};
