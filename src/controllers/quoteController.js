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
       p.address as provider_address,
       p.rating as provider_rating, p.short_description as provider_short_desc,
       pt.name as type_name
       FROM quotes q
       LEFT JOIN providers p ON q.provider_id = p.id
       LEFT JOIN provider_types pt ON p.type_id = pt.id
       WHERE q.id = ?`, [id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Devis non trouvé' });
    const q = rows[0];
    const groupItems = q.group_items ? (() => { try { return JSON.parse(q.group_items); } catch(_) { return null; } })() : null;
    const isGroupQuote = Array.isArray(groupItems) && groupItems.length > 0;

    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="devis-${q.quote_number}.pdf"`);
    doc.pipe(res);

    const W      = 595.28;
    const PAGE_H = 841.89;
    const M      = 44;
    const CW     = W - M * 2;

    // ── Palette (charcoal + or / gold) ─────────────────────────────
    const INK     = '#0F172A';   // very dark navy-slate
    const SLATE   = '#1E293B';   // header bg
    const GOLD    = '#B8973A';   // primary accent
    const GOLDL   = '#D4AF5A';   // light gold
    const GOLDBG  = '#FFFBF0';   // warm cream bg
    const TXT     = '#1E293B';   // body text
    const MUTED   = '#64748B';   // secondary text
    const BORDER  = '#CBD5E1';   // dividers
    const BORDER2 = '#E2E8F0';   // light dividers
    const GREEN   = '#059669';   // emerald
    const GREENBG = '#ECFDF5';   // light green bg
    const WHITE   = '#FFFFFF';
    const OFFWHITE= '#F8FAFC';

    const FOOTER_H = 50;
    const CONT_BTM = PAGE_H - FOOTER_H - 10;

    const fmt = (n) => {
      const fixed = Number(n).toFixed(3);
      const [int, dec] = fixed.split('.');
      return int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + dec;
    };
    const statLbl = (s) =>
      s === 'accepted' ? 'Accepte' : s === 'sent' ? 'Envoye' : s === 'cancelled' ? 'Annule' : 'En attente';

    // Section header bar
    const sectionHdr = (title, yPos, light = false) => {
      if (light) {
        doc.rect(M, yPos, CW, 24).fill(OFFWHITE).strokeColor(BORDER2).lineWidth(0.5).stroke();
        doc.rect(M, yPos, 4, 24).fill(GOLD);
        doc.fontSize(8).fillColor(MUTED).font('Helvetica-Bold')
           .text(title, M + 16, yPos + 8, { characterSpacing: 1 });
      } else {
        doc.rect(M, yPos, CW, 24).fill(SLATE);
        doc.rect(M, yPos, 4, 24).fill(GOLD);
        doc.fontSize(8).fillColor(WHITE).font('Helvetica-Bold')
           .text(title, M + 16, yPos + 8, { characterSpacing: 1 });
      }
      return yPos + 24;
    };

    // Table row
    const trow = (label, value, bg, lc, vc, bold, yPos, rowH = 26) => {
      doc.rect(M, yPos, CW, rowH).fill(bg || WHITE).strokeColor(BORDER2).lineWidth(0.3).stroke();
      doc.fontSize(8.5).fillColor(lc || TXT).font(bold ? 'Helvetica-Bold' : 'Helvetica')
         .text(label, M + 14, yPos + (rowH - 10) / 2);
      doc.font('Helvetica-Bold').fillColor(vc || INK)
         .text(value, M, yPos + (rowH - 10) / 2, { width: CW - 14, align: 'right' });
      return yPos + rowH;
    };

    // Divider line
    const divider = (yPos, color = BORDER2) => {
      doc.rect(M, yPos, CW, 0.5).fill(color);
      return yPos + 0.5;
    };

    // ── HEADER ──────────────────────────────────────────────────────
    const HDR_H = 110;
    doc.rect(0, 0, W, HDR_H).fill(SLATE);
    // Subtle diagonal pattern strip on the right
    doc.rect(W - 160, 0, 160, HDR_H).fill('#263148');
    // Gold bottom border
    doc.rect(0, HDR_H - 3, W, 3).fill(GOLD);

    // Logo image on white pill background
    const logoPath = require('path').join(__dirname, '../assets/logo.png');
    const logoW = 130, logoH = 52;
    const logoPad = 8;
    doc.roundedRect(M - logoPad, 16, logoW + logoPad * 2, logoH + logoPad * 2, 6).fill(WHITE);
    doc.image(logoPath, M, 20, { width: logoW, height: logoH, fit: [logoW, logoH], align: 'center', valign: 'center' });
    doc.fontSize(8).fillColor('#64748B').font('Helvetica')
       .text('www.mywedding.tn   |   contact@mywedding.tn', M, 84);

    // Quote badge (top-right)
    const bx = W - M - 140;
    doc.rect(bx, 14, 140, 82).fill('#0F1C33').strokeColor(GOLD).lineWidth(0.8).stroke();
    doc.rect(bx, 14, 4, 82).fill(GOLD);
    doc.fontSize(7).fillColor(GOLDL).font('Helvetica-Bold')
       .text('DEVIS OFFICIEL', bx + 10, 21, { width: 126, align: 'center', characterSpacing: 1.5 });
    doc.rect(bx + 10, 33, 120, 0.5).fill('#263148');
    doc.fontSize(13).fillColor(WHITE).font('Helvetica-Bold')
       .text(q.quote_number, bx + 10, 38, { width: 126, align: 'center' });
    doc.fontSize(7.5).fillColor('#94A3B8').font('Helvetica')
       .text(`Emis le  ${new Date(q.created_at).toLocaleDateString('fr-FR')}`, bx + 10, 58, { width: 126, align: 'center' })
       .text(`Valide jusqu'au  ${new Date(q.valid_until).toLocaleDateString('fr-FR')}`, bx + 10, 70, { width: 126, align: 'center' });
    const statusColor = q.status === 'accepted' ? GREEN : q.status === 'sent' ? GOLD : MUTED;
    doc.fontSize(7.5).fillColor(statusColor).font('Helvetica-Bold')
       .text(statLbl(q.status).toUpperCase(), bx + 10, 82, { width: 126, align: 'center' });

    let y = HDR_H + 12;

    // ── INTRO TEXT ───────────────────────────────────────────────────
    doc.fontSize(8.5).fillColor(MUTED).font('Helvetica')
       .text(
         `MyWedding.tn est une plateforme de mise en relation entre clients et prestataires evenementiels en Tunisie. ` +
         `Ce document constitue un devis officiel etabli conformement aux conditions convenues entre les parties. ` +
         `Il recapitule l'ensemble des prestations, tarifs, remises et modalites de paiement applicables.`,
         M, y, { width: CW, lineGap: 2 }
       );
    y += doc.heightOfString(
      `MyWedding.tn est une plateforme de mise en relation entre clients et prestataires evenementiels en Tunisie. Ce document constitue un devis officiel etabli conformement aux conditions convenues entre les parties. Il recapitule l'ensemble des prestations, tarifs, remises et modalites de paiement applicables.`,
      { width: CW }
    ) + 10;

    // ── EVENT BANNER ──────────────────────────────────────────────────
    if (q.event_date) {
      const evtStr = new Date(q.event_date).toLocaleDateString('fr-FR',
        { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
      doc.rect(M, y, CW, 30).fill(GOLDBG).strokeColor(GOLD).lineWidth(0.6).stroke();
      doc.rect(M, y, 4, 30).fill(GOLD);
      doc.fontSize(7).fillColor(MUTED).font('Helvetica-Bold')
         .text("DATE DE L'EVENEMENT", M + 16, y + 5, { characterSpacing: 0.8 });
      doc.fontSize(10.5).fillColor(INK).font('Helvetica-Bold')
         .text(evtStr.charAt(0).toUpperCase() + evtStr.slice(1), M + 16, y + 16);
      y += 38;
    }

    // ── CLIENT + PRESTATAIRE(S) ──────────────────────────────────────
    const hW = (CW - 12) / 2;
    const CH = 98;

    // Client card (always shown)
    doc.rect(M, y, hW, CH).fill(WHITE).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.rect(M, y, hW, 22).fill(INK);
    doc.rect(M, y, 4, 22).fill(GOLD);
    doc.fontSize(7.5).fillColor(WHITE).font('Helvetica-Bold')
       .text('INFORMATIONS CLIENT', M + 14, y + 7, { characterSpacing: 0.8 });
    doc.fontSize(10).fillColor(TXT).font('Helvetica-Bold').text(q.client_name, M + 10, y + 29);
    doc.fontSize(8).fillColor(MUTED).font('Helvetica').text(q.client_email, M + 10, y + 44);
    if (q.client_phone) doc.fontSize(8).fillColor(MUTED).text(q.client_phone, M + 10, y + 56);
    doc.rect(M + 8, y + CH - 22, hW - 16, 0.5).fill(BORDER2);
    doc.fontSize(7).fillColor(MUTED).font('Helvetica').text('Reference devis', M + 10, y + CH - 18);
    doc.fontSize(7.5).fillColor(GOLD).font('Helvetica-Bold').text(q.quote_number, M + 10, y + CH - 9);

    if (!isGroupQuote) {
      // Single provider card
      const px = M + hW + 12;
      doc.rect(px, y, hW, CH).fill(WHITE).strokeColor(BORDER).lineWidth(0.5).stroke();
      doc.rect(px, y, hW, 22).fill(SLATE);
      doc.rect(px, y, 4, 22).fill(GOLD);
      doc.fontSize(7.5).fillColor(WHITE).font('Helvetica-Bold')
         .text('INFORMATIONS PRESTATAIRE', px + 14, y + 7, { characterSpacing: 0.8 });
      doc.fontSize(10).fillColor(TXT).font('Helvetica-Bold').text(q.provider_name, px + 10, y + 29);
      doc.fontSize(8).fillColor(GOLD).font('Helvetica-Bold').text(q.type_name || 'Prestataire', px + 10, y + 44);
      const provDetail = [q.provider_city, q.provider_phone].filter(Boolean).join('  |  ');
      if (provDetail) doc.fontSize(8).fillColor(MUTED).font('Helvetica').text(provDetail, px + 10, y + 56);
      if (q.provider_email) doc.fontSize(8).fillColor(MUTED).text(q.provider_email, px + 10, y + 68);
      if (q.provider_rating) {
        doc.rect(px + 8, y + CH - 22, hW - 16, 0.5).fill(BORDER2);
        doc.fontSize(7).fillColor(MUTED).font('Helvetica').text('Evaluation', px + 10, y + CH - 18);
        doc.fontSize(7.5).fillColor(GOLD).font('Helvetica-Bold')
           .text(`${Number(q.provider_rating).toFixed(1)} / 5  ★`, px + 10, y + CH - 9);
      }
      y += CH + 12;
    } else {
      // Group: show badge on right
      const px = M + hW + 12;
      doc.rect(px, y, hW, CH).fill(GOLDBG).strokeColor(GOLD).lineWidth(0.8).stroke();
      doc.rect(px, y, 4, CH).fill(GOLD);
      doc.fontSize(7.5).fillColor(GOLD).font('Helvetica-Bold')
         .text('DEVIS GROUPE', px + 14, y + 12, { characterSpacing: 1 });
      doc.fontSize(22).fillColor(INK).font('Helvetica-Bold')
         .text(String(groupItems.length), px + 14, y + 28);
      doc.fontSize(9).fillColor(MUTED).font('Helvetica').text('prestataires', px + 14, y + 54);
      doc.fontSize(7.5).fillColor(MUTED).text('selectionnes pour votre evenement', px + 14, y + 66, { width: hW - 24 });
      y += CH + 12;
    }

    if (!isGroupQuote) {
      // ── DESCRIPTION DU SERVICE (single) ───────────────────────────
      y = sectionHdr('DESCRIPTION DES PRESTATIONS', y);
      const descText = q.description || 'Aucune description fournie.';
      const rawDescH = doc.heightOfString(descText, { width: CW - 28, lineGap: 3 });
      const descH = Math.max(rawDescH, 24);
      doc.rect(M, y, CW, descH + 20).fill(OFFWHITE).strokeColor(BORDER2).lineWidth(0.3).stroke();
      doc.rect(M, y, 4, descH + 20).fill(GOLDL);
      doc.fontSize(8.5).fillColor(TXT).font('Helvetica')
         .text(descText, M + 16, y + 10, { width: CW - 28, lineGap: 3 });
      y += descH + 28;
    } else {
      // ── DETAIL PAR PRESTATAIRE (group) ────────────────────────────
      y = sectionHdr('DETAIL PAR PRESTATAIRE', y);
      y += 6;

      groupItems.forEach((item, idx) => {
        if (y + 90 > CONT_BTM) { doc.addPage({ size: 'A4', margin: 0 }); y = 30; }

        const CARD_H = 80;
        const LEFT_W = CW * 0.55;
        const RIGHT_W = CW - LEFT_W - 4;

        // Card background
        doc.rect(M, y, CW, CARD_H).fill(WHITE).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.rect(M, y, 4, CARD_H).fill(GOLD);

        // Index circle
        doc.circle(M + 18, y + CARD_H / 2, 11).fill(INK);
        doc.fontSize(9).fillColor(GOLD).font('Helvetica-Bold').text(String(idx + 1), M + 15, y + CARD_H / 2 - 5);

        // Provider info (left side)
        const lx = M + 36;
        doc.fontSize(10).fillColor(INK).font('Helvetica-Bold').text(item.provider_name, lx, y + 10, { width: LEFT_W - 40 });
        doc.fontSize(8).fillColor(GOLD).font('Helvetica-Bold').text(item.type_name || 'Prestataire', lx, y + 24);
        const meta = [
          item.package_name ? `Pack: ${item.package_name}` : null,
          item.guest_count  ? `${item.guest_count} personnes` : null,
          item.event_date   ? `Le ${new Date(item.event_date).toLocaleDateString('fr-FR')}` : null,
        ].filter(Boolean).join('   •   ');
        if (meta) doc.fontSize(7.5).fillColor(MUTED).font('Helvetica').text(meta, lx, y + 37, { width: LEFT_W - 40 });

        // Financials (right side)
        const rx = M + LEFT_W + 4;
        const colW = RIGHT_W - 10;

        doc.rect(rx, y, RIGHT_W, CARD_H).fill(OFFWHITE);
        doc.rect(rx, y, 1, CARD_H).fill(BORDER2);

        doc.fontSize(7).fillColor(MUTED).font('Helvetica').text('Base', rx + 6, y + 8);
        doc.fontSize(8).fillColor(TXT).font('Helvetica-Bold')
           .text(`${fmt(item.base)} TND`, rx + 6, y + 17, { width: colW, align: 'right' });

        if (item.disc > 0) {
          doc.fontSize(7).fillColor(MUTED).font('Helvetica').text(`Remise (${item.disc}%)`, rx + 6, y + 30);
          doc.fontSize(8).fillColor(GOLD).font('Helvetica-Bold')
             .text(`- ${fmt(item.discAmt)} TND`, rx + 6, y + 39, { width: colW, align: 'right' });
        }

        doc.rect(rx, y + CARD_H - 28, RIGHT_W, 0.5).fill(BORDER2);
        doc.fontSize(7).fillColor(MUTED).font('Helvetica').text('Net prestataire', rx + 6, y + CARD_H - 24);
        doc.fontSize(9).fillColor(INK).font('Helvetica-Bold')
           .text(`${fmt(item.net)} TND`, rx + 6, y + CARD_H - 14, { width: colW, align: 'right' });

        // Acompte badge (bottom-right of left section)
        doc.rect(lx, y + CARD_H - 20, LEFT_W - 40, 16).fill(GOLDBG).strokeColor(GOLD).lineWidth(0.4).stroke();
        doc.fontSize(7).fillColor(GOLD).font('Helvetica-Bold')
           .text(`Acompte: ${fmt(item.advance)} TND`, lx + 4, y + CARD_H - 14, { width: LEFT_W - 50 });

        y += CARD_H + 6;
      });
      y += 8;
    }

    // ── RECAPITULATIF FINANCIER ──────────────────────────────────────
    y = sectionHdr('RECAPITULATIF FINANCIER', y);

    // Columns header
    doc.rect(M, y, CW, 20).fill('#F1F5F9').strokeColor(BORDER2).lineWidth(0.3).stroke();
    doc.fontSize(7.5).fillColor(MUTED).font('Helvetica-Bold')
       .text('DESIGNATION', M + 14, y + 6)
       .text('MONTANT', M, y + 6, { width: CW - 14, align: 'right' });
    y += 20;

    y = trow('Prix de base (tarif prestataire)', `${fmt(q.price_before_discount)} TND`, WHITE, MUTED, TXT, false, y);
    if (Number(q.discount_percentage) > 0) {
      y = trow(
        `Remise categorie (${q.discount_percentage}% de reduction)`,
        `- ${fmt(q.discount_amount)} TND`,
        GOLDBG, GOLD, GOLD, false, y
      );
    }
    const commPct = Number(q.commission_percentage || 0);
    if (commPct > 0) {
      const clientDiscPct  = commPct / 2;
      const platformFeePct = commPct / 2;
      const clientDiscAmt  = (Number(q.price_before_discount) * clientDiscPct) / 100;
      const platformFeeAmt = (Number(q.price_before_discount) * platformFeePct) / 100;
      y = trow(
        `Remise plateforme MyWedding (-${clientDiscPct}% offert)`,
        `- ${fmt(clientDiscAmt)} TND`,
        GREENBG, GREEN, GREEN, false, y
      );
      y = trow(
        `Frais de service MyWedding (+${platformFeePct}%)`,
        `+ ${fmt(platformFeeAmt)} TND`,
        OFFWHITE, MUTED, MUTED, false, y
      );
    }
    // Total bar
    doc.rect(M, y, CW, 36).fill(INK);
    doc.rect(M, y, 4, 36).fill(GOLD);
    doc.fontSize(9).fillColor('#94A3B8').font('Helvetica-Bold')
       .text('TOTAL NET APRES REMISE', M + 16, y + 7, { characterSpacing: 0.5 });
    doc.fontSize(15).fillColor(GOLDL).font('Helvetica-Bold')
       .text(`${fmt(q.price_after_discount)} TND`, M, y + 8, { width: CW - 14, align: 'right' });
    y += 36;

    const solde = Number(q.price_after_discount) - Number(q.advance_payment);
    y = trow(
      `Acompte a verser a la reservation (${q.advance_percentage}%)`,
      `${fmt(q.advance_payment)} TND`,
      GOLDBG, GOLD, GOLD, true, y
    );
    y = trow(
      "Solde restant — a regler au plus tard le jour de la prestation",
      `${fmt(solde)} TND`,
      OFFWHITE, MUTED, TXT, false, y
    );
    y += 12;

    // ── ECHEANCIER DE PAIEMENT ───────────────────────────────────────
    y = sectionHdr('ECHEANCIER DE PAIEMENT', y, true);
    y += 6;
    const eW = (CW - 10) / 2;
    const EH = 70;

    // Step 1 — Acompte
    doc.rect(M, y, eW, EH).fill(GOLDBG).strokeColor(GOLD).lineWidth(0.8).stroke();
    doc.rect(M, y, 4, EH).fill(GOLD);
    doc.circle(M + eW - 20, y + EH / 2, 14).fill(GOLD);
    doc.fontSize(13).fillColor(WHITE).font('Helvetica-Bold').text('1', M + eW - 25, y + EH / 2 - 7);
    doc.fontSize(9).fillColor(INK).font('Helvetica-Bold').text('ACOMPTE', M + 14, y + 12);
    doc.fontSize(8).fillColor(MUTED).font('Helvetica').text('Versement a la signature', M + 14, y + 26);
    doc.fontSize(7.5).fillColor(MUTED).text('Mode : virement ou cheque', M + 14, y + 38);
    doc.fontSize(13).fillColor(GOLD).font('Helvetica-Bold').text(`${fmt(q.advance_payment)} TND`, M + 14, y + 51);

    // Step 2 — Solde
    const s2x = M + eW + 10;
    doc.rect(s2x, y, eW, EH).fill(GREENBG).strokeColor(GREEN).lineWidth(0.8).stroke();
    doc.rect(s2x, y, 4, EH).fill(GREEN);
    doc.circle(s2x + eW - 20, y + EH / 2, 14).fill(GREEN);
    doc.fontSize(13).fillColor(WHITE).font('Helvetica-Bold').text('2', s2x + eW - 25, y + EH / 2 - 7);
    doc.fontSize(9).fillColor(INK).font('Helvetica-Bold').text('SOLDE FINAL', s2x + 14, y + 12);
    const soldeLabel = q.event_date
      ? `Le ${new Date(q.event_date).toLocaleDateString('fr-FR')}`
      : "Jour de l'evenement";
    doc.fontSize(8).fillColor(MUTED).font('Helvetica').text(soldeLabel, s2x + 14, y + 26);
    doc.fontSize(7.5).fillColor(MUTED).text('Mode : especes ou virement', s2x + 14, y + 38);
    doc.fontSize(13).fillColor(GREEN).font('Helvetica-Bold').text(`${fmt(solde)} TND`, s2x + 14, y + 51);
    y += EH + 14;

    // ── AVANTAGES MYWEDDING ─────────────────────────────────────────
    y = sectionHdr('POURQUOI MYWEDDING ?', y, true);
    y += 8;
    const avantages = [
      { icon: '✓', text: 'Prestataires verifies et notes par des clients reels — qualite garantie' },
      { icon: '✓', text: `Remise plateforme de ${commPct > 0 ? commPct / 2 : q.discount_percentage}% negociee pour vous via MyWedding` },
      { icon: '✓', text: 'Suivi en ligne de votre devis et de vos paiements en temps reel' },
      { icon: '✓', text: 'Support client disponible jusqu\'au jour de votre evenement' },
    ];
    const aColW = (CW - 10) / 2;
    avantages.forEach((a, i) => {
      const ax = i % 2 === 0 ? M : M + aColW + 10;
      const ay = y + Math.floor(i / 2) * 22;
      doc.fontSize(9).fillColor(GOLD).font('Helvetica-Bold').text(a.icon, ax, ay);
      doc.fontSize(8).fillColor(TXT).font('Helvetica').text(a.text, ax + 14, ay, { width: aColW - 18, lineGap: 1 });
    });
    y += Math.ceil(avantages.length / 2) * 22 + 12;

    // ── CONDITIONS GENERALES ─────────────────────────────────────────
    y = sectionHdr('CONDITIONS GENERALES', y, true);
    y += 8;
    const conds = [
      `Validite du devis : Ce devis est valable jusqu'au ${new Date(q.valid_until).toLocaleDateString('fr-FR')}. Passe cette date, MyWedding se reserve le droit de revoir les tarifs proposes.`,
      `Acompte de reservation : Un acompte de ${fmt(q.advance_payment)} TND representant ${q.advance_percentage}% du montant total est exige a la confirmation de la commande. Aucune reservation n'est consideree ferme sans versement de cet acompte.`,
      `Solde : Le solde de ${fmt(solde)} TND devra etre regle au plus tard le jour de la prestation, avant le debut des services.`,
      `Politique d'annulation : Toute annulation effectuee moins de 7 jours avant la date de l'evenement entraine la retenue integrale de l'acompte verse. Une annulation entre 7 et 30 jours donne lieu a un remboursement partiel selon les conditions du prestataire.`,
      `Remise MyWedding : La remise accordee est valable exclusivement pour les reservations effectuees via la plateforme MyWedding.tn. Elle ne peut etre cumulee avec d'autres offres promotionnelles.`,
      `Responsabilite : MyWedding agit en tant qu'intermediaire et ne peut etre tenu responsable d'evenements de force majeure empechant la realisation de la prestation. En cas de litige, les parties s'engagent a rechercher une solution amiable.`,
    ];
    conds.forEach((c, i) => {
      if (y + 40 > CONT_BTM) { doc.addPage({ size: 'A4', margin: 0 }); y = 30; }
      doc.rect(M + 10, y + 3, 5, 5).fill(GOLD);
      doc.fontSize(8).fillColor(TXT).font('Helvetica')
         .text(c, M + 24, y, { width: CW - 30, lineGap: 2 });
      y += doc.heightOfString(c, { width: CW - 30, lineGap: 2 }) + 10;
    });
    y += 6;

    // ── SIGNATURE ────────────────────────────────────────────────────
    if (y + 100 > CONT_BTM) { doc.addPage({ size: 'A4', margin: 0 }); y = 30; }
    y = sectionHdr('ACCEPTATION ET SIGNATURES', y, true);
    y += 8;
    doc.rect(M, y, CW, 84).fill(WHITE).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fontSize(8.5).fillColor(MUTED).font('Helvetica')
       .text(
         "En apposant leur signature, les deux parties reconnaissent avoir pris connaissance et accepte l'integralite des " +
         "conditions decrites dans ce devis. Ce document fait foi de contrat entre le client et le prestataire.",
         M + 14, y + 10, { width: CW - 28, lineGap: 2 }
       );
    // Signature boxes
    doc.rect(M + 10, y + 40, 175, 30).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fontSize(7).fillColor(MUTED).font('Helvetica-Bold')
       .text('Signature du client + date', M + 14, y + 72, { characterSpacing: 0.3 });
    doc.fontSize(7.5).fillColor(TXT).font('Helvetica').text(q.client_name, M + 14, y + 44);

    doc.rect(M + CW - 185, y + 40, 175, 30).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fontSize(7).fillColor(MUTED).font('Helvetica-Bold')
       .text('Cachet + signature du prestataire', M + CW - 181, y + 72, { characterSpacing: 0.3 });
    doc.fontSize(7.5).fillColor(TXT).font('Helvetica').text(q.provider_name, M + CW - 181, y + 44);
    y += 90;

    // ── NOTES ────────────────────────────────────────────────────────
    if (q.notes) {
      if (y + 60 > CONT_BTM) { doc.addPage({ size: 'A4', margin: 0 }); y = 30; }
      y = sectionHdr('NOTES ET REMARQUES', y, true);
      const notesH = doc.heightOfString(q.notes, { width: CW - 28, lineGap: 2 });
      doc.rect(M, y, CW, notesH + 20).fill(OFFWHITE).strokeColor(BORDER2).lineWidth(0.3).stroke();
      doc.rect(M, y, 4, notesH + 20).fill(GOLDL);
      doc.fontSize(8.5).fillColor(TXT).font('Helvetica')
         .text(q.notes, M + 16, y + 10, { width: CW - 28, lineGap: 2 });
      y += notesH + 28;
    }

    // ── FOOTER ───────────────────────────────────────────────────────
    const footerY = PAGE_H - FOOTER_H;
    doc.rect(0, footerY, W, FOOTER_H).fill(SLATE);
    doc.rect(0, footerY, W, 3).fill(GOLD);
    doc.fontSize(9).fillColor(WHITE).font('Helvetica-Bold')
       .text('MyWedding.tn', 0, footerY + 10, { align: 'center' });
    doc.fontSize(7.5).fillColor('#94A3B8').font('Helvetica')
       .text('contact@mywedding.tn   |   www.mywedding.tn', 0, footerY + 23, { align: 'center' });
    doc.fontSize(7).fillColor('#475569')
       .text(
         `Devis N° ${q.quote_number}  —  Document genere automatiquement le ${new Date().toLocaleDateString('fr-FR')}`,
         0, footerY + 36, { align: 'center' }
       );

    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur génération PDF' });
  }
};

exports.getNewCount = async (req, res) => {
  try {
    const since = req.query.since ? new Date(Number(req.query.since)) : new Date(0);
    const [[row]] = await pool.execute(
      "SELECT COUNT(*) as count FROM quotes WHERE client_id = ? AND status = 'sent' AND created_at > ?",
      [req.user.id, since]
    );
    res.json({ success: true, count: row.count });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
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
