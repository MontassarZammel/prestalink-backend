const { pool } = require('../config/database');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const mailer = require('../services/mailer');

const fmtNum = n => Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const generateQuoteNumber = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `PL-${year}${month}-${rand}`;
};

exports.createQuote = async (req, res) => {
  try {
    const { provider_id, client_name, client_email, client_phone, description, event_date, base_price, advance_percentage } = req.body;
    if (!provider_id || !client_name || !client_email || !description || !base_price) {
      return res.status(400).json({ success: false, message: 'Champs requis manquants' });
    }

    const [providerRows] = await pool.execute(
      `SELECT p.*, pt.discount_percentage FROM providers p LEFT JOIN provider_types pt ON p.type_id = pt.id WHERE p.id = ?`,
      [provider_id]
    );
    if (!providerRows.length) return res.status(404).json({ success: false, message: 'Prestataire non trouvé' });
    const provider = providerRows[0];

    const discountPct = provider.discount_percentage || 0;
    const priceBeforeDiscount = Number(base_price);
    const discountAmount = (priceBeforeDiscount * discountPct) / 100;
    const priceAfterDiscount = priceBeforeDiscount - discountAmount;
    const advancePct = advance_percentage || 30;
    const advancePayment = (priceAfterDiscount * advancePct) / 100;

    const quoteNumber = generateQuoteNumber();
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);

    const [result] = await pool.execute(
      `INSERT INTO quotes (quote_number, client_id, provider_id, client_name, client_email, client_phone, description, event_date,
       price_before_discount, discount_percentage, discount_amount, price_after_discount, advance_payment, advance_percentage, valid_until)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [quoteNumber, req.user?.id || null, provider_id, client_name, client_email, client_phone || null, description,
       event_date || null,
       priceBeforeDiscount, discountPct, discountAmount, priceAfterDiscount, advancePayment, advancePct,
       validUntil.toISOString().split('T')[0]]
    );

    const [quote] = await pool.execute('SELECT * FROM quotes WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: { ...quote[0], provider } });

    // Send emails (non-blocking)
    mailer.sendQuoteConfirmation(quote[0], provider).catch(() => {});
    if (process.env.ADMIN_EMAIL) {
      mailer.sendNewQuoteAlert(process.env.ADMIN_EMAIL, quote[0], provider).catch(() => {});
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.getQuoteSummary = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT q.id, q.quote_number, q.advance_payment, q.payment_status, q.payment_enabled,
              p.name as provider_name
       FROM quotes q LEFT JOIN providers p ON q.provider_id = p.id
       WHERE q.id = ? AND q.payment_enabled = 1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Devis non trouvé' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.generatePDF = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      `SELECT q.*, p.name as provider_name, p.city as provider_city,
       p.phone as provider_phone, p.email as provider_email,
       p.rating as provider_rating, p.short_description as provider_short_desc,
       pt.name as type_name
       FROM quotes q
       LEFT JOIN providers p ON q.provider_id = p.id
       LEFT JOIN provider_types pt ON p.type_id = pt.id
       WHERE q.id = ?`, [id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Devis non trouvé' });
    const q = rows[0];

    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="devis-${q.quote_number}.pdf"`);
    doc.pipe(res);

    const W = 595.28;
    const M = 44;
    const CW = W - M * 2;

    // ── palette ─────────────────────────────────────────────────────
    const DARK   = '#1A0E0E';
    const ROSE   = '#C48C8C';
    const ROSEL  = '#D9A5A5';
    const ROSEBG = '#FDF6F6';
    const SAND   = '#E8DCD5';
    const TXT    = '#3D2B2B';
    const MUTED  = '#9B8E88';
    const BORDER = '#EDE8E6';
    const GREEN  = '#34D399';
    const WHITE  = '#FFFFFF';

    // ── helpers ──────────────────────────────────────────────────────
    const fmt = (n) => {
      const fixed = Number(n).toFixed(3);
      const [int, dec] = fixed.split('.');
      return int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + dec;
    };
    const noteStr  = (r) => `Note : ${Number(r).toFixed(1)}/5`;
    const statLbl  = (s) => s === 'accepted' ? 'Accepte' : s === 'sent' ? 'Envoye' : 'En attente';

    const PAGE_H    = 841.89;
    const FOOTER_H  = 44;
    const CONT_BTM  = PAGE_H - FOOTER_H - 6;

    const hdr = (title, yPos, light) => {
      doc.rect(M, yPos, CW, 22).fill(light ? ROSEBG : DARK);
      doc.rect(M + CW - 3, yPos, 3, 22).fill(ROSE);
      doc.fontSize(8.5).fillColor(light ? DARK : WHITE).font('Helvetica-Bold')
         .text(title, M + 12, yPos + 7, { characterSpacing: 0.7 });
      return yPos + 22;
    };

    const trow = (label, value, bg, lc, vc, bold, yPos) => {
      doc.rect(M, yPos, CW, 24).fill(bg || WHITE);
      doc.rect(M, yPos, CW, 24).strokeColor(BORDER).lineWidth(0.4).stroke();
      doc.fontSize(8.5).fillColor(lc || TXT).font(bold ? 'Helvetica-Bold' : 'Helvetica')
         .text(label, M + 12, yPos + 7);
      doc.font('Helvetica-Bold').fillColor(vc || DARK)
         .text(value, M, yPos + 7, { width: CW - 12, align: 'right' });
      return yPos + 24;
    };

    // ── HEADER (100px) ───────────────────────────────────────────────
    doc.rect(0, 0, W, 100).fill('#4A2020');
    doc.rect(0, 97, W, 3).fill(ROSE);
    doc.fontSize(26).fillColor(WHITE).font('Helvetica-Bold').text('Presta', M, 24, { continued: true });
    doc.fillColor(ROSEL).text('Link');
    doc.fontSize(8.5).fillColor(SAND).font('Helvetica')
       .text('Plateforme de prestataires evenementiels en Tunisie', M, 56);
    doc.fontSize(7.5).fillColor(MUTED).text('www.prestalink.tn  |  contact@prestalink.tn', M, 70);

    const bx = W - M - 145;
    doc.rect(bx, 12, 145, 80).fill('#2D1515');
    doc.rect(bx, 12, 3, 80).fill(ROSE);
    doc.fontSize(7).fillColor(ROSEL).font('Helvetica-Bold')
       .text('DEVIS OFFICIEL', bx + 8, 19, { width: 130, align: 'center', characterSpacing: 1 });
    doc.rect(bx + 8, 30, 129, 0.5).fill('#3D2020');
    doc.fontSize(12).fillColor(WHITE).font('Helvetica-Bold')
       .text(q.quote_number, bx + 8, 35, { width: 130, align: 'center' });
    doc.fontSize(7).fillColor(MUTED).font('Helvetica')
       .text(`Emis le ${new Date(q.created_at).toLocaleDateString('fr-FR')}`, bx + 8, 54, { width: 130, align: 'center' })
       .text(`Valide au ${new Date(q.valid_until).toLocaleDateString('fr-FR')}`, bx + 8, 65, { width: 130, align: 'center' })
       .text(`Statut : ${statLbl(q.status)}`, bx + 8, 76, { width: 130, align: 'center' });

    let y = 108;

    // ── EVENT BANNER ─────────────────────────────────────────────────
    if (q.event_date) {
      const evtStr = new Date(q.event_date).toLocaleDateString('fr-FR',
        { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
      doc.rect(M, y, CW, 26).fill(ROSEBG);
      doc.rect(M, y, 3, 26).fill(ROSE);
      doc.fontSize(7).fillColor(MUTED).font('Helvetica-Bold')
         .text("DATE DE L'EVENEMENT", M + 12, y + 4, { characterSpacing: 0.5 });
      doc.fontSize(9.5).fillColor(DARK).font('Helvetica-Bold')
         .text(evtStr.charAt(0).toUpperCase() + evtStr.slice(1), M + 12, y + 14);
      y += 32;
    }

    // ── CLIENT + PRESTATAIRE ──────────────────────────────────────────
    const hW = (CW - 10) / 2;
    const CH = 84;
    doc.rect(M, y, hW, CH).fill(WHITE).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.rect(M, y, hW, 20).fill(ROSE);
    doc.fontSize(7.5).fillColor(WHITE).font('Helvetica-Bold')
       .text('CLIENT', M + 10, y + 6, { characterSpacing: 1 });
    doc.fontSize(10.5).fillColor(DARK).font('Helvetica-Bold').text(q.client_name, M + 10, y + 26);
    doc.fontSize(8).fillColor(MUTED).font('Helvetica').text(q.client_email, M + 10, y + 41);
    if (q.client_phone) doc.text(q.client_phone, M + 10, y + 53);
    doc.fontSize(7.5).fillColor(ROSE).font('Helvetica-Bold').text(q.quote_number, M + 10, y + 68);

    const px = M + hW + 10;
    doc.rect(px, y, hW, CH).fill(WHITE).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.rect(px, y, hW, 20).fill(DARK);
    doc.fontSize(7.5).fillColor(ROSEL).font('Helvetica-Bold')
       .text('PRESTATAIRE', px + 10, y + 6, { characterSpacing: 1 });
    doc.fontSize(10.5).fillColor(DARK).font('Helvetica-Bold').text(q.provider_name, px + 10, y + 26);
    doc.fontSize(8).fillColor(ROSE).font('Helvetica-Bold').text(q.type_name || '', px + 10, y + 41);
    doc.fontSize(8).fillColor(MUTED).font('Helvetica').text(q.provider_city || '', px + 10, y + 53);
    if (q.provider_phone) doc.text(q.provider_phone, px + 10, y + 65);
    else if (q.provider_rating) {
      doc.fontSize(8).fillColor(ROSE).font('Helvetica-Bold')
         .text(noteStr(q.provider_rating), px + 10, y + 68);
    }
    y += CH + 8;

    // ── DESCRIPTION ──────────────────────────────────────────────────
    y = hdr('DESCRIPTION DU SERVICE', y);
    const rawDescH = doc.heightOfString(q.description || '', { width: CW - 24, lineGap: 2 });
    const descH = Math.min(rawDescH, 72);
    doc.rect(M, y, CW, descH + 14).fill(ROSEBG).strokeColor(BORDER).lineWidth(0.4).stroke();
    doc.fontSize(8.5).fillColor(TXT).font('Helvetica')
       .text(q.description || '', M + 12, y + 7, { width: CW - 24, lineGap: 2, height: descH });
    y += descH + 20;

    // ── FINANCIAL TABLE ───────────────────────────────────────────────
    y = hdr('RECAPITULATIF FINANCIER', y);
    y = trow('Prix de base', `${fmt(q.price_before_discount)} TND`, '#FAFAFA', MUTED, TXT, false, y);
    y = trow(`Remise PrestaLink (${q.discount_percentage}%)`, `- ${fmt(q.discount_amount)} TND`, ROSEBG, ROSE, ROSE, false, y);
    doc.rect(M, y, CW, 32).fill(DARK);
    doc.fontSize(9.5).fillColor(SAND).font('Helvetica-Bold').text('PRIX TOTAL APRES REMISE', M + 12, y + 10);
    doc.fontSize(14).fillColor(ROSEL).font('Helvetica-Bold')
       .text(`${fmt(q.price_after_discount)} TND`, M, y + 8, { width: CW - 12, align: 'right' });
    y += 32;
    const solde = Number(q.price_after_discount) - Number(q.advance_payment);
    y = trow(`Acompte a verser (${q.advance_percentage}%)`, `${fmt(q.advance_payment)} TND`, ROSEBG, ROSE, ROSE, true, y);
    y = trow("Solde le jour de l'evenement", `${fmt(solde)} TND`, '#FAFAFA', MUTED, TXT, false, y);
    y += 8;

    // ── ECHEANCIER ───────────────────────────────────────────────────
    y = hdr('ECHEANCIER DE PAIEMENT', y, true);
    y += 4;
    const mW = (CW - 10) / 2;
    const BH = 58;

    doc.rect(M, y, mW, BH).fill(ROSEBG).strokeColor(ROSEL).lineWidth(0.8).stroke();
    doc.circle(M + 19, y + 19, 9).fill(ROSE);
    doc.fontSize(8).fillColor(WHITE).font('Helvetica-Bold').text('1', M + 16, y + 14);
    doc.fontSize(8).fillColor(DARK).font('Helvetica-Bold').text('ACOMPTE', M + 34, y + 7);
    doc.fontSize(7.5).fillColor(MUTED).font('Helvetica').text('A la signature du devis', M + 34, y + 19);
    doc.fontSize(12).fillColor(ROSE).font('Helvetica-Bold').text(`${fmt(q.advance_payment)} TND`, M + 10, y + 37);

    const s2x = M + mW + 10;
    doc.rect(s2x, y, mW, BH).fill('#F0FFF8').strokeColor('#86EFAC').lineWidth(0.8).stroke();
    doc.circle(s2x + 19, y + 19, 9).fill(GREEN);
    doc.fontSize(8).fillColor(WHITE).font('Helvetica-Bold').text('2', s2x + 16, y + 14);
    doc.fontSize(8).fillColor(DARK).font('Helvetica-Bold').text('SOLDE FINAL', s2x + 34, y + 7);
    const soldeLabel = q.event_date ? new Date(q.event_date).toLocaleDateString('fr-FR') : "Jour de l'evenement";
    doc.fontSize(7.5).fillColor(MUTED).font('Helvetica').text(soldeLabel, s2x + 34, y + 19);
    doc.fontSize(12).fillColor(GREEN).font('Helvetica-Bold').text(`${fmt(solde)} TND`, s2x + 10, y + 37);
    y += BH + 8;

    // ── CONDITIONS ────────────────────────────────────────────────────
    y = hdr('CONDITIONS GENERALES', y, true);
    y += 4;
    const conds = [
      `Ce devis est valable jusqu'au ${new Date(q.valid_until).toLocaleDateString('fr-FR')}.`,
      `L'acompte de ${fmt(q.advance_payment)} TND (${q.advance_percentage}%) est exigible a la validation de la reservation.`,
      `Le solde de ${fmt(solde)} TND sera regle au plus tard le jour de la prestation.`,
      `Toute annulation sous 7 jours entraine la retenue integrale de l'acompte.`,
      `La remise est valable exclusivement via la plateforme PrestaLink.tn.`,
    ];
    conds.forEach(c => {
      doc.rect(M + 12, y + 4, 4, 4).fill(ROSE);
      doc.fontSize(8).fillColor(TXT).font('Helvetica')
         .text(c, M + 24, y, { width: CW - 28, lineGap: 1 });
      y += doc.heightOfString(c, { width: CW - 28 }) + 6;
    });
    y += 6;

    // ── SIGNATURE ────────────────────────────────────────────────────
    if (y + 90 > CONT_BTM) { doc.addPage({ size: 'A4', margin: 0 }); y = 30; }
    y = hdr('ACCEPTATION DU DEVIS', y, true);
    y += 6;
    doc.rect(M, y, CW, 74).fill(WHITE).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fontSize(7.5).fillColor(MUTED).font('Helvetica')
       .text("En signant ce document, les parties declarent avoir lu et accepte l'ensemble des conditions.", M + 12, y + 8, { width: CW - 24 });
    doc.rect(M + 10, y + 26, 170, 34).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fontSize(7).fillColor(MUTED).text('Signature et date — Client', M + 14, y + 62);
    doc.rect(M + CW - 180, y + 26, 170, 34).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fontSize(7).fillColor(MUTED).text('Cachet et signature — Prestataire', M + CW - 176, y + 62);

    // ── FOOTER (pinned to absolute bottom) ────────────────────────────
    const footerY = PAGE_H - FOOTER_H;
    doc.rect(0, footerY, W, FOOTER_H).fill(DARK);
    doc.rect(0, footerY, W, 3).fill(ROSE);
    doc.fontSize(8).fillColor(ROSEL).font('Helvetica-Bold')
       .text('PrestaLink.tn', 0, footerY + 8, { align: 'center' });
    doc.fontSize(7.5).fillColor(MUTED).font('Helvetica')
       .text('contact@prestalink.tn  |  www.prestalink.tn', 0, footerY + 20, { align: 'center' });
    doc.fontSize(7).fillColor('#555555')
       .text('Document genere automatiquement - Devis officiel PrestaLink', 0, footerY + 31, { align: 'center' });

    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur génération PDF' });
  }
};

exports.getMyQuotes = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT q.*, p.name as provider_name, pt.name as type_name FROM quotes q
       LEFT JOIN providers p ON q.provider_id = p.id
       LEFT JOIN provider_types pt ON p.type_id = pt.id
       WHERE q.client_id = ? ORDER BY q.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.getAllQuotes = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    let where = ['1=1'];
    let params = [];
    if (status) { where.push('q.status = ?'); params.push(status); }
    const limitInt  = parseInt(limit, 10)  || 20;
    const offsetInt = (parseInt(page, 10) - 1) * limitInt;
    const [countRows] = await pool.execute(`SELECT COUNT(*) as total FROM quotes q WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.execute(
      `SELECT q.*, p.name as provider_name, pt.name as type_name FROM quotes q
       LEFT JOIN providers p ON q.provider_id = p.id
       LEFT JOIN provider_types pt ON p.type_id = pt.id
       WHERE ${where.join(' AND ')} ORDER BY q.created_at DESC LIMIT ${limitInt} OFFSET ${offsetInt}`, params
    );
    res.json({ success: true, data: rows, pagination: { total: countRows[0].total, page: parseInt(page, 10), limit: limitInt } });
  } catch (error) {
    console.error('getAllQuotes error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, payment_enabled } = req.body;
    const fields = [];
    const values = [];
    if (status) { fields.push('status = ?'); values.push(status); }
    if (payment_enabled !== undefined) { fields.push('payment_enabled = ?'); values.push(payment_enabled); }
    values.push(id);
    await pool.execute(`UPDATE quotes SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true, message: 'Devis mis à jour' });

    // Notify client on meaningful status changes
    if (status && ['sent', 'accepted', 'rejected'].includes(status)) {
      const [rows] = await pool.execute('SELECT * FROM quotes WHERE id = ?', [id]);
      if (rows.length) mailer.sendQuoteStatusUpdate(rows[0], status).catch(() => {});
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};
