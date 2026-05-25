const { pool } = require('../config/database');
const nodemailer = require('nodemailer');
const mailer = require('../services/mailer');
const { getIo } = require('../socketInstance');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const generateQuoteNumber = () => {
  const d = new Date();
  return `PL-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}-${Math.floor(Math.random()*9000)+1000}`;
};

// ── CLIENT — soumettre une demande ────────────────────────────

exports.create = async (req, res) => {
  try {
    const { provider_id, package_id, client_name, client_email, client_phone, event_date, guest_count, notes, group_id, description, type_slug } = req.body;
    const user_id = req.user?.id || null;

    // Vérifier disponibilité uniquement si date fournie
    if (event_date) {
      const [taken] = await pool.execute(
        "SELECT id, status FROM provider_availability WHERE provider_id = ? AND date = ? AND status IN ('reserved','blocked','pending')",
        [provider_id, event_date]
      );
      if (taken.length) {
        const st = taken[0].status;
        const msg = st === 'pending'
          ? 'Cette date est déjà en cours de vérification pour un autre client'
          : 'Cette date n\'est pas disponible';
        return res.status(409).json({ success: false, message: msg });
      }
    }

    const [result] = await pool.execute(
      'INSERT INTO quote_requests (provider_id, package_id, user_id, client_name, client_email, client_phone, event_date, guest_count, notes, group_id, description, type_slug) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [provider_id, package_id || null, user_id, client_name, client_email, client_phone || null, event_date || null, guest_count || null, notes || null, group_id || null, description || null, type_slug || null]
    );

    // Marquer la date comme "en attente de vérification"
    if (event_date) {
      try {
        await pool.execute(
          'INSERT INTO provider_availability (provider_id, date, status, note) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE status=?, note=?',
          [provider_id, event_date, 'pending', `Demande #${result.insertId}`, 'pending', `Demande #${result.insertId}`]
        );
      } catch (_) {}
    }

    // Notifier l'admin
    try {
      const [providers] = await pool.execute('SELECT name FROM providers WHERE id = ?', [provider_id]);
      transporter.sendMail({
        from: '"PrestaLink" <no-reply@prestalink.tn>',
        to: process.env.ADMIN_EMAIL,
        subject: `Nouvelle demande de devis — ${providers[0]?.name}`,
        html: `
          <h2>Nouvelle demande de devis</h2>
          <p><strong>Client :</strong> ${client_name} (${client_email})</p>
          <p><strong>Prestataire :</strong> ${providers[0]?.name}</p>
          <p><strong>Date événement :</strong> ${event_date} <span style="color:#F59E0B">(⏳ en attente de vérification)</span></p>
          <p><strong>Nombre de personnes :</strong> ${guest_count}</p>
          ${notes ? `<p><strong>Notes :</strong> ${notes}</p>` : ''}
          <p style="margin-top:16px;padding:12px;background:#FEF3C7;border-radius:8px;">
            <strong>Action requise :</strong> Vérifier la disponibilité avec le prestataire et confirmer ou décliner la date depuis l'espace admin.
          </p>
        `,
      });
    } catch (_) {}

    res.status(201).json({ success: true, message: 'Demande envoyée avec succès', data: { id: result.insertId } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── CLIENT — mes demandes ─────────────────────────────────────

exports.getMy = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT qr.*, p.name as provider_name, p.slug as provider_slug,
              pp.name as package_name, pp.price_per_person
       FROM quote_requests qr
       LEFT JOIN providers p ON qr.provider_id = p.id
       LEFT JOIN provider_packages pp ON qr.package_id = pp.id
       WHERE qr.client_email = ? OR qr.user_id = ?
       ORDER BY qr.created_at DESC`,
      [req.user.email, req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── ADMIN — toutes les demandes ───────────────────────────────

exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT qr.*, p.name as provider_name, p.slug as provider_slug,
              p.price_min, p.price_max,
              pt.discount_percentage as provider_discount,
              pp.name as package_name, pp.price_per_person
       FROM quote_requests qr
       LEFT JOIN providers p ON qr.provider_id = p.id
       LEFT JOIN provider_types pt ON p.type_id = pt.id
       LEFT JOIN provider_packages pp ON qr.package_id = pp.id
       ORDER BY qr.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status, quote_id } = req.body;
    await pool.execute(
      'UPDATE quote_requests SET status = ?, quote_id = ? WHERE id = ?',
      [status, quote_id || null, req.params.id]
    );
    res.json({ success: true, message: 'Statut mis à jour' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── ADMIN — décliner une date (date non disponible) ───────────
exports.declineDate = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT provider_id, event_date, client_name, client_email FROM quote_requests WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Demande introuvable' });
    const { provider_id, event_date, client_name, client_email } = rows[0];

    // Libérer la date (supprimer le pending)
    if (event_date) {
      await pool.execute(
        "DELETE FROM provider_availability WHERE provider_id = ? AND date = ? AND status = 'pending'",
        [provider_id, event_date]
      );
    }

    // Mettre la demande en statut "date_unavailable"
    await pool.execute(
      "UPDATE quote_requests SET status = 'date_unavailable' WHERE id = ?",
      [req.params.id]
    );

    // Notifier le client par email
    try {
      const dateFormatted = event_date
        ? new Date(event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
        : '';
      transporter.sendMail({
        from: '"PrestaLink" <no-reply@prestalink.tn>',
        to: client_email,
        subject: `Mise à jour de votre demande de devis — PrestaLink`,
        html: `
          <h2>Bonjour ${client_name},</h2>
          <p>Après vérification avec le prestataire, la date du <strong>${dateFormatted}</strong> n'est malheureusement pas disponible.</p>
          <p>Nous vous invitons à soumettre une nouvelle demande avec une date alternative. Notre équipe reste à votre disposition.</p>
          <p style="margin-top:16px;">Cordialement,<br/><strong>L'équipe PrestaLink</strong></p>
        `,
      });
    } catch (_) {}

    res.json({ success: true, message: 'Date déclinée, client notifié' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── ADMIN — générer UN devis pour un groupe de demandes ──────

exports.generateGroupQuote = async (req, res) => {
  try {
    // items = [{ request_id, base_price, discount_percentage }]
    const { items, advance_percentage, valid_until_days, notes } = req.body;
    const { groupId } = req.params;

    if (!items || !items.length) return res.status(400).json({ success: false, message: 'Items manquants' });

    const [allRequests] = await pool.execute(
      `SELECT qr.*, p.name as provider_name, p.commission_percentage, pt.name as type_name,
              pp.name as package_name
       FROM quote_requests qr
       LEFT JOIN providers p ON qr.provider_id = p.id
       LEFT JOIN provider_types pt ON p.type_id = pt.id
       LEFT JOIN provider_packages pp ON qr.package_id = pp.id
       WHERE qr.group_id = ? AND qr.status != 'cancelled'
       ORDER BY qr.created_at ASC`,
      [groupId]
    );

    if (!allRequests.length) return res.status(404).json({ success: false, message: 'Groupe introuvable' });
    const first = allRequests[0];

    // Build per-item financials — always apply discount (default 15%)
    const itemsData = items.map(item => {
      const r    = allRequests.find(r => r.id === Number(item.request_id)) || {};
      const base = Number(item.base_price) || 0;
      const disc = Number(item.discount_percentage) || 15;
      const discAmt = Math.round((base * disc) / 100);
      const net  = base - discAmt;
      return { r, base, disc, discAmt, net };
    });

    const totalBase     = itemsData.reduce((s, i) => s + i.base, 0);
    const totalDiscount = itemsData.reduce((s, i) => s + i.discAmt, 0);
    const totalNet      = itemsData.reduce((s, i) => s + i.net, 0);
    const avgDiscPct    = totalBase > 0 ? Math.round((totalDiscount / totalBase) * 100) : 0;
    const advPct        = Number(advance_percentage ?? 30);
    const advPayment    = Math.round((totalNet * advPct) / 100);

    const quoteNumber = generateQuoteNumber();
    const validUntil  = new Date();
    validUntil.setDate(validUntil.getDate() + (valid_until_days || 30));

    const fmtN = n => Math.round(n).toLocaleString('fr-TN');
    const description = `Devis groupe — ${allRequests.length} prestataire(s)`;

    // Serialize per-provider data for PDF rendering
    const groupItems = JSON.stringify(itemsData.map(({ r, base, disc, discAmt, net }) => ({
      provider_name: r.provider_name || '',
      type_name:     r.type_name || '',
      package_name:  r.package_name || null,
      guest_count:   r.guest_count || null,
      event_date:    r.event_date ? String(r.event_date).slice(0, 10) : null,
      base,
      disc,
      discAmt,
      net,
      advance: Math.round((net * advPct) / 100),
    })));

    const avgCommissionPct = allRequests.length > 0
      ? allRequests.reduce((s, r) => s + Number(r.commission_percentage || 15), 0) / allRequests.length
      : 15;

    const [result] = await pool.execute(
      `INSERT INTO quotes (quote_number, client_id, provider_id, client_name, client_email, client_phone,
       description, event_date, guest_count, price_before_discount, discount_percentage, discount_amount,
       price_after_discount, advance_payment, advance_percentage, valid_until, notes, status, group_items, payment_enabled, commission_percentage)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'sent',?,1,?)`,
      [quoteNumber, first.user_id || null, first.provider_id, first.client_name, first.client_email,
       first.client_phone || null, description, first.event_date || null, first.guest_count || null,
       totalBase, avgDiscPct, totalDiscount, totalNet, advPayment, advPct,
       validUntil.toISOString().split('T')[0], notes || null, groupItems, Math.round(avgCommissionPct * 100) / 100]
    );

    const quoteId = result.insertId;
    await pool.execute('UPDATE quote_requests SET status = "quoted", quote_id = ? WHERE group_id = ?', [quoteId, groupId]);

    // Date stays 'pending' until client pays — reservation happens on payment

    const pdfUrl = `${process.env.BACKEND_URL}/api/quotes/${quoteId}/pdf`;

    // Socket notification
    try {
      let convId = null;
      if (first.user_id) {
        const [convRows] = await pool.execute('SELECT id FROM conversations WHERE client_id = ? ORDER BY created_at DESC LIMIT 1', [first.user_id]);
        if (convRows.length) {
          convId = convRows[0].id;
        } else {
          const [cr] = await pool.execute('INSERT INTO conversations (client_id, client_name, client_email, subject, status) VALUES (?,?,?,?,?)',
            [first.user_id, first.client_name, first.client_email, 'Votre devis PrestaLink', 'open']);
          convId = cr.insertId;
        }
      }
      if (convId) {
        const notifMsg = `🎉 Votre devis groupé est prêt ! N° ${quoteNumber} — Total : ${fmtN(totalNet)} TND pour ${allRequests.length} prestataire(s). Consultez-le ici : ${pdfUrl}`;
        const [msgResult] = await pool.execute('INSERT INTO messages (conversation_id, sender_role, sender_name, content, is_read) VALUES (?,?,?,?,?)',
          [convId, 'admin', 'PrestaLink', notifMsg, 0]);
        await pool.execute('UPDATE conversations SET last_message_at = NOW() WHERE id = ?', [convId]);
        const io = getIo();
        if (io) io.to(`conv_${convId}`).emit('new_message', { id: msgResult.insertId, conversation_id: convId, sender_role: 'admin', sender_name: 'PrestaLink', content: notifMsg, is_read: false, created_at: new Date().toISOString() });
      }
    } catch (_) {}

    transporter.sendMail({
      from: '"PrestaLink" <no-reply@prestalink.tn>',
      to: first.client_email,
      subject: `Votre devis groupé PrestaLink — ${allRequests.length} prestataires`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#C48C8C">Votre devis groupé est prêt !</h2><p>Bonjour <strong>${first.client_name}</strong>,</p><p>Votre devis pour <strong>${allRequests.length} prestataire(s)</strong> est disponible.</p><table style="width:100%;border-collapse:collapse;margin:20px 0"><tr><td style="padding:8px;color:#666">N° devis</td><td style="padding:8px;font-weight:bold">${quoteNumber}</td></tr><tr style="border-top:2px solid #eee"><td style="padding:8px;color:#666">Total net</td><td style="padding:8px;font-weight:bold">${fmtN(totalNet)} TND</td></tr><tr><td style="padding:8px;color:#666">Acompte (${advPct}%)</td><td style="padding:8px;color:#C48C8C;font-weight:bold">${fmtN(advPayment)} TND</td></tr></table><a href="${pdfUrl}" style="display:inline-block;background:#C48C8C;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">Télécharger mon devis PDF</a></div>`,
    }).catch(() => {});

    res.json({ success: true, data: { quote_id: quoteId, quote_number: quoteNumber, pdf_url: pdfUrl } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── ADMIN — générer le devis depuis une demande ───────────────

exports.generateQuote = async (req, res) => {
  try {
    const { base_price, discount_percentage, advance_percentage, notes, valid_until_days } = req.body;
    const requestId = req.params.id;

    // Load request
    const [requests] = await pool.execute(
      `SELECT qr.*, p.name as provider_name, p.rating, p.commission_percentage,
              pt.discount_percentage as type_discount,
              pp.name as package_name, pp.includes as package_includes, pp.price_per_person
       FROM quote_requests qr
       LEFT JOIN providers p ON qr.provider_id = p.id
       LEFT JOIN provider_types pt ON p.type_id = pt.id
       LEFT JOIN provider_packages pp ON qr.package_id = pp.id
       WHERE qr.id = ?`,
      [requestId]
    );
    if (!requests.length) return res.status(404).json({ success: false, message: 'Demande introuvable' });
    const req_ = requests[0];

    if (req_.status === 'cancelled') return res.status(400).json({ success: false, message: 'Demande annulée' });

    // Financial calc — always apply discount (default 15%)
    const priceBase      = Number(base_price);
    const discountPct    = Number(discount_percentage ?? 15);
    const discountAmt    = (priceBase * discountPct) / 100;
    const commissionPct  = Number(req_.commission_percentage ?? 15);
    const priceAfter     = priceBase - discountAmt;
    const advPct         = Number(advance_percentage ?? 30);
    const advPayment     = (priceAfter * advPct) / 100;

    const quoteNumber = generateQuoteNumber();
    const validUntil  = new Date();
    validUntil.setDate(validUntil.getDate() + (valid_until_days || 30));

    // Build description from pack info
    let description = `Prestation traiteur pour ${req_.guest_count} personnes`;
    if (req_.package_name) description += ` — ${req_.package_name}`;

    // Create quote
    const [result] = await pool.execute(
      `INSERT INTO quotes (quote_number, client_id, provider_id, client_name, client_email, client_phone,
       description, event_date, guest_count, price_before_discount, discount_percentage, discount_amount,
       price_after_discount, advance_payment, advance_percentage, valid_until, notes, status, request_id, payment_enabled, commission_percentage)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'sent',?,1,?)`,
      [quoteNumber, req_.user_id || null, req_.provider_id, req_.client_name, req_.client_email,
       req_.client_phone || null, description, req_.event_date, req_.guest_count,
       priceBase, discountPct, discountAmt, priceAfter, advPayment, advPct,
       validUntil.toISOString().split('T')[0], notes || null, requestId, commissionPct]
    );

    const quoteId = result.insertId;

    // Update request status
    await pool.execute(
      'UPDATE quote_requests SET status = "quoted", quote_id = ? WHERE id = ?',
      [quoteId, requestId]
    );

    // Date stays 'pending' until client pays — reservation happens on payment

    // Load full quote + provider for email
    const [quotes] = await pool.execute('SELECT * FROM quotes WHERE id = ?', [quoteId]);
    const [providers] = await pool.execute(
      'SELECT p.*, pt.discount_percentage FROM providers p LEFT JOIN provider_types pt ON p.type_id = pt.id WHERE p.id = ?',
      [req_.provider_id]
    );

    const quote    = quotes[0];
    const provider = providers[0];

    // ── In-app chat notification ──────────────────────────────
    const pdfUrl = `${process.env.BACKEND_URL}/api/quotes/${quoteId}/pdf`;
    try {
      // Find or create a conversation for this client
      let convId = null;
      if (req_.user_id) {
        const [convRows] = await pool.execute(
          'SELECT id FROM conversations WHERE client_id = ? ORDER BY created_at DESC LIMIT 1',
          [req_.user_id]
        );
        if (convRows.length) {
          convId = convRows[0].id;
        } else {
          const [convResult] = await pool.execute(
            'INSERT INTO conversations (client_id, client_name, client_email, subject, status) VALUES (?,?,?,?,?)',
            [req_.user_id, req_.client_name, req_.client_email, 'Votre devis PrestaLink', 'open']
          );
          convId = convResult.insertId;
        }
      } else {
        const [convRows] = await pool.execute(
          'SELECT id FROM conversations WHERE client_email = ? ORDER BY created_at DESC LIMIT 1',
          [req_.client_email]
        );
        if (convRows.length) convId = convRows[0].id;
      }

      if (convId) {
        const notifMsg = `🎉 Votre devis est prêt ! Numéro : ${quoteNumber} — Montant : ${Math.round(priceAfter).toLocaleString('fr-TN')} TND. Consultez-le dans « Mes Devis » ou téléchargez-le ici : ${pdfUrl}`;
        const [msgResult] = await pool.execute(
          'INSERT INTO messages (conversation_id, sender_role, sender_name, content, is_read) VALUES (?,?,?,?,?)',
          [convId, 'admin', 'PrestaLink', notifMsg, 0]
        );
        await pool.execute('UPDATE conversations SET last_message_at = NOW() WHERE id = ?', [convId]);

        // Emit real-time event if client is connected
        const io = getIo();
        if (io) {
          io.to(`conv_${convId}`).emit('new_message', {
            id: msgResult.insertId,
            conversation_id: convId,
            sender_role: 'admin',
            sender_name: 'PrestaLink',
            content: notifMsg,
            is_read: false,
            created_at: new Date().toISOString(),
          });
        }
      }
    } catch (_) {}

    // Send email to client (non-blocking)
    transporter.sendMail({
      from: '"PrestaLink" <no-reply@prestalink.tn>',
      to: req_.client_email,
      subject: `Votre devis PrestaLink — ${provider.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#C48C8C">Votre devis est prêt !</h2>
          <p>Bonjour <strong>${req_.client_name}</strong>,</p>
          <p>Suite à votre demande, votre devis personnalisé pour <strong>${provider.name}</strong> est disponible.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0">
            <tr><td style="padding:8px;color:#666">Numéro de devis</td><td style="padding:8px;font-weight:bold">${quoteNumber}</td></tr>
            <tr><td style="padding:8px;color:#666">Pack</td><td style="padding:8px">${req_.package_name || '—'}</td></tr>
            <tr><td style="padding:8px;color:#666">Date de l'événement</td><td style="padding:8px">${new Date(req_.event_date).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}</td></tr>
            <tr><td style="padding:8px;color:#666">Nombre de personnes</td><td style="padding:8px">${req_.guest_count}</td></tr>
            <tr style="border-top:2px solid #eee"><td style="padding:8px;color:#666">Montant total</td><td style="padding:8px;font-weight:bold;font-size:1.1em">${Math.round(priceAfter).toLocaleString('fr-TN')} TND</td></tr>
            <tr><td style="padding:8px;color:#666">Acompte (${advPct}%)</td><td style="padding:8px;color:#C48C8C;font-weight:bold">${Math.round(advPayment).toLocaleString('fr-TN')} TND</td></tr>
          </table>
          <a href="${pdfUrl}" style="display:inline-block;background:#C48C8C;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
            Télécharger mon devis PDF
          </a>
          <p style="margin-top:24px;color:#999;font-size:0.9em">Ce devis est valable jusqu'au ${validUntil.toLocaleDateString('fr-FR')}.</p>
        </div>
      `,
    }).catch(() => {});

    res.json({ success: true, data: { quote_id: quoteId, quote_number: quoteNumber, pdf_url: pdfUrl } });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};
