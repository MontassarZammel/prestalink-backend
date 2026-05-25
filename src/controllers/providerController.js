const { pool } = require('../config/database');
const slugify = require('slugify');

const GRAND_TUNIS_GOVS = ['Tunis', 'Ariana', 'Ben Arous', 'Manouba'];

exports.getAll = async (req, res) => {
  try {
    const { type_slug, city, region, price_min, price_max, search, sort = 'created_at', order = 'DESC', page = 1, limit = 12 } = req.query;
    let where = ['p.is_active = 1'];
    let params = [];

    if (type_slug) {
      where.push('pt.slug = ?');
      params.push(type_slug);
    }
    if (region === 'grand-tunis') {
      where.push(`p.governorate IN (${GRAND_TUNIS_GOVS.map(() => '?').join(',')})`);
      params.push(...GRAND_TUNIS_GOVS);
    } else if (region) {
      where.push('p.governorate = ?');
      params.push(region);
    }
    if (city) {
      where.push('p.city = ?');
      params.push(city);
    }
    if (price_min) {
      where.push('p.price_min >= ?');
      params.push(parseFloat(price_min));
    }
    if (price_max) {
      where.push('p.price_max <= ?');
      params.push(parseFloat(price_max));
    }
    if (search) {
      where.push('(p.name LIKE ? OR p.description LIKE ? OR p.city LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const validSorts = { name: 'p.name', price: 'p.price_min', rating: 'p.rating', created_at: 'p.created_at' };
    const sortCol = validSorts[sort] || 'p.created_at';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';
    const limitInt  = parseInt(limit, 10)  || 12;
    const offsetInt = (parseInt(page, 10) - 1) * limitInt;

    const countQuery = `SELECT COUNT(*) as total FROM providers p 
      LEFT JOIN provider_types pt ON p.type_id = pt.id
      WHERE ${where.join(' AND ')}`;
    const [countRows] = await pool.execute(countQuery, params);
    const total = countRows[0].total;

    const query = `SELECT p.*, pt.name as type_name, pt.slug as type_slug, pt.discount_percentage,
      (SELECT image_url FROM provider_images WHERE provider_id = p.id ORDER BY display_order LIMIT 1) as gallery_image
      FROM providers p
      LEFT JOIN provider_types pt ON p.type_id = pt.id
      WHERE ${where.join(' AND ')}
      ORDER BY p.is_featured DESC, ${sortCol} ${sortOrder}
      LIMIT ${limitInt} OFFSET ${offsetInt}`;
    const [rows] = await pool.execute(query, params);

    res.json({
      success: true,
      data: rows,
      pagination: { total, page: parseInt(page, 10), limit: limitInt, pages: Math.ceil(total / limitInt) }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.getBySlug = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.*, pt.name as type_name, pt.slug as type_slug, pt.discount_percentage
       FROM providers p LEFT JOIN provider_types pt ON p.type_id = pt.id
       WHERE p.slug = ? AND p.is_active = 1`, [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Prestataire non trouvé' });
    const provider = rows[0];

    const [images] = await pool.execute('SELECT * FROM provider_images WHERE provider_id = ? ORDER BY display_order', [provider.id]);
    const [services] = await pool.execute('SELECT * FROM provider_services WHERE provider_id = ?', [provider.id]);
    provider.images = images;
    provider.services = services;

    res.json({ success: true, data: provider });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.create = async (req, res) => {
  try {
    const { type_id, name, description, short_description, email, phone, website, address, city, governorate,
      latitude, longitude, logo, cover_image, price_min, price_max, is_featured, meta_title, meta_description } = req.body;
    const slug = slugify(name, { lower: true, strict: true, locale: 'fr' });
    const [result] = await pool.execute(
      `INSERT INTO providers (type_id, name, slug, description, short_description, email, phone, website, address, city, governorate,
       latitude, longitude, logo, cover_image, price_min, price_max, is_featured, meta_title, meta_description)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [type_id, name, slug, description || null, short_description || null, email || null, phone || null,
       website || null, address || null, city || null, governorate || null,
       latitude || null, longitude || null, logo || null, cover_image || null,
       price_min || null, price_max || null, is_featured || 0,
       meta_title || name, meta_description || short_description || null]
    );
    const [created] = await pool.execute('SELECT * FROM providers WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: created[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const fields = [];
    const values = [];
    const allowed = ['type_id','name','description','short_description','email','phone','whatsapp','website','address',
      'city','governorate','latitude','longitude','logo','cover_image','price_min','price_max','is_featured','is_active','meta_title','meta_description','standard_fee','commission_percentage'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(req.body[key]);
      }
    }
    if (req.body.name) {
      fields.push('slug = ?');
      values.push(slugify(req.body.name, { lower: true, strict: true, locale: 'fr' }));
    }
    values.push(id);
    await pool.execute(`UPDATE providers SET ${fields.join(', ')} WHERE id = ?`, values);
    const [updated] = await pool.execute('SELECT * FROM providers WHERE id = ?', [id]);
    res.json({ success: true, data: updated[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.delete = async (req, res) => {
  try {
    await pool.execute('DELETE FROM providers WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Prestataire supprimé' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.addImage = async (req, res) => {
  try {
    const { provider_id, image_url, caption, display_order } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO provider_images (provider_id, image_url, caption, display_order) VALUES (?,?,?,?)',
      [provider_id, image_url, caption, display_order || 0]
    );
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.getCities = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT DISTINCT city FROM providers WHERE is_active = 1 AND city IS NOT NULL ORDER BY city');
    res.json({ success: true, data: rows.map(r => r.city) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.getAllAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    let where = ['1=1'];
    let params = [];
    if (search) { where.push('(p.name LIKE ? OR p.city LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    const limitInt  = parseInt(limit, 10) || 20;
    const offsetInt = (parseInt(page, 10) - 1) * limitInt;
    const [countRows] = await pool.execute(`SELECT COUNT(*) as total FROM providers p WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.execute(
      `SELECT p.*, pt.name as type_name, pt.slug as type_slug FROM providers p LEFT JOIN provider_types pt ON p.type_id = pt.id WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT ${limitInt} OFFSET ${offsetInt}`, params
    );
    res.json({ success: true, data: rows, pagination: { total: countRows[0].total, page: parseInt(page, 10), limit: limitInt } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};
