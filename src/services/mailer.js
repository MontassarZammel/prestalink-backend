const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const logo = 'MyWedding';

const wrap = (content) => `
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MyWedding</title>
</head>
<body style="margin:0;padding:0;background:#FAF8F7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#C48C8C,#D9A5A5);border-radius:16px 16px 0 0;padding:28px 40px;text-align:center;">
            <span style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-0.03em;">✦ MyWedding</span>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#fff;padding:40px;border-radius:0 0 16px 16px;border:1px solid #EDE8E6;border-top:none;">
            ${content}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 0;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9B8E88;">© ${new Date().getFullYear()} MyWedding. Tous droits réservés.</p>
            <p style="margin:6px 0 0;font-size:12px;color:#9B8E88;">Cet email a été envoyé automatiquement, ne pas répondre.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

const fmtPrice = (n) => Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const send = async (to, subject, html) => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return;
  try {
    await transporter.sendMail({
      from: `"MyWedding" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error('[Mailer] Failed to send email:', err.message);
  }
};

// ── Email templates ────────────────────────────────────────────────────────────

exports.sendQuoteConfirmation = async (quote, provider) => {
  const html = wrap(`
    <h2 style="margin:0 0 8px;color:#1A0E0E;font-size:22px;font-weight:700;">Votre devis a été créé ✦</h2>
    <p style="margin:0 0 24px;color:#6B5E5A;font-size:15px;">Bonjour <strong>${quote.client_name}</strong>, votre demande de devis a bien été reçue.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F7;border-radius:12px;border:1px solid #EDE8E6;margin-bottom:28px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:12px;color:#9B8E88;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Numéro de devis</p>
          <p style="margin:0;font-size:18px;color:#D9A5A5;font-weight:700;font-family:monospace;">${quote.quote_number}</p>
        </td>
      </tr>
      <tr><td style="border-top:1px solid #EDE8E6;"></td></tr>
      <tr>
        <td style="padding:20px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:50%;padding-bottom:16px;">
                <p style="margin:0 0 3px;font-size:12px;color:#9B8E88;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Prestataire</p>
                <p style="margin:0;font-size:14px;color:#1A0E0E;font-weight:600;">${provider.name}</p>
              </td>
              <td style="width:50%;padding-bottom:16px;">
                <p style="margin:0 0 3px;font-size:12px;color:#9B8E88;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Montant total</p>
                <p style="margin:0;font-size:14px;color:#1A0E0E;font-weight:700;">${fmtPrice(quote.price_after_discount)} TND</p>
              </td>
            </tr>
            <tr>
              <td>
                <p style="margin:0 0 3px;font-size:12px;color:#9B8E88;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Acompte (${quote.advance_percentage}%)</p>
                <p style="margin:0;font-size:14px;color:#C48C8C;font-weight:600;">${fmtPrice(quote.advance_payment)} TND</p>
              </td>
              <td>
                <p style="margin:0 0 3px;font-size:12px;color:#9B8E88;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Valide jusqu'au</p>
                <p style="margin:0;font-size:14px;color:#1A0E0E;font-weight:600;">${new Date(quote.valid_until).toLocaleDateString('fr-TN')}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 24px;color:#6B5E5A;font-size:14px;line-height:1.6;">Notre équipe va examiner votre demande et vous contacter très prochainement. Vous pouvez suivre l'avancement de votre devis depuis votre espace client.</p>

    <div style="text-align:center;">
      <a href="${process.env.FRONTEND_URL}/mes-devis" style="display:inline-block;background:linear-gradient(135deg,#C48C8C,#D9A5A5);color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-weight:700;font-size:14px;">Voir mes devis →</a>
    </div>
  `);
  await send(quote.client_email, `Votre devis ${quote.quote_number} — MyWedding`, html);
};

exports.sendQuoteStatusUpdate = async (quote, newStatus) => {
  const statusMessages = {
    sent:     { emoji: '📋', title: 'Votre devis est prêt', body: 'Votre devis a été préparé et est maintenant disponible. Consultez-le et acceptez-le pour confirmer votre réservation.', cta: 'Voir mon devis' },
    accepted: { emoji: '✅', title: 'Devis accepté !', body: 'Votre devis a été accepté. Vous pouvez maintenant procéder au paiement de l\'acompte pour confirmer définitivement votre réservation.', cta: 'Payer l\'acompte' },
    rejected: { emoji: '❌', title: 'Devis refusé', body: 'Malheureusement, votre devis n\'a pas pu être accepté. N\'hésitez pas à nous contacter pour plus d\'informations ou pour faire une nouvelle demande.', cta: 'Nos prestataires' },
  };
  const msg = statusMessages[newStatus];
  if (!msg) return;

  const html = wrap(`
    <h2 style="margin:0 0 8px;color:#1A0E0E;font-size:22px;font-weight:700;">${msg.emoji} ${msg.title}</h2>
    <p style="margin:0 0 24px;color:#6B5E5A;font-size:15px;">Bonjour <strong>${quote.client_name}</strong>,</p>
    <p style="margin:0 0 24px;color:#6B5E5A;font-size:15px;line-height:1.6;">${msg.body}</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F7;border-radius:12px;border:1px solid #EDE8E6;margin-bottom:28px;">
      <tr>
        <td style="padding:16px 24px;">
          <p style="margin:0 0 3px;font-size:12px;color:#9B8E88;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Numéro de devis</p>
          <p style="margin:0;font-size:16px;color:#D9A5A5;font-weight:700;font-family:monospace;">${quote.quote_number}</p>
        </td>
      </tr>
      <tr><td style="border-top:1px solid #EDE8E6;padding:16px 24px;">
        <p style="margin:0 0 3px;font-size:12px;color:#9B8E88;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Montant</p>
        <p style="margin:0;font-size:16px;color:#1A0E0E;font-weight:700;">${fmtPrice(quote.price_after_discount)} TND</p>
      </td></tr>
    </table>

    <div style="text-align:center;">
      <a href="${process.env.FRONTEND_URL}/mes-devis" style="display:inline-block;background:linear-gradient(135deg,#C48C8C,#D9A5A5);color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-weight:700;font-size:14px;">${msg.cta} →</a>
    </div>
  `);
  await send(quote.client_email, `Mise à jour devis ${quote.quote_number} — MyWedding`, html);
};

exports.sendPaymentConfirmation = async (quote, payment) => {
  const isAdvance = payment.payment_type === 'advance';
  const html = wrap(`
    <h2 style="margin:0 0 8px;color:#1A0E0E;font-size:22px;font-weight:700;">💳 Paiement confirmé ✓</h2>
    <p style="margin:0 0 24px;color:#6B5E5A;font-size:15px;">Bonjour <strong>${quote.client_name}</strong>, votre paiement a bien été reçu.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F7;border-radius:12px;border:1px solid #EDE8E6;margin-bottom:28px;">
      <tr>
        <td style="padding:20px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:50%;padding-bottom:16px;">
                <p style="margin:0 0 3px;font-size:12px;color:#9B8E88;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Devis</p>
                <p style="margin:0;font-size:14px;color:#D9A5A5;font-weight:700;font-family:monospace;">${quote.quote_number}</p>
              </td>
              <td style="width:50%;padding-bottom:16px;">
                <p style="margin:0 0 3px;font-size:12px;color:#9B8E88;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Type</p>
                <p style="margin:0;font-size:14px;color:#1A0E0E;font-weight:600;">${isAdvance ? 'Acompte' : 'Solde final'}</p>
              </td>
            </tr>
            <tr>
              <td colspan="2" style="border-top:1px solid #EDE8E6;padding-top:16px;">
                <p style="margin:0 0 3px;font-size:12px;color:#9B8E88;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Montant payé</p>
                <p style="margin:0;font-size:24px;color:#34D399;font-weight:800;">${fmtPrice(payment.amount)} TND</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 24px;color:#6B5E5A;font-size:14px;line-height:1.6;">
      ${isAdvance ? 'Votre acompte a été reçu. Votre réservation est confirmée ! Le solde restant sera à régler à la date de votre événement.' : 'Votre paiement intégral a été reçu. Merci pour votre confiance !'}
    </p>

    <div style="text-align:center;">
      <a href="${process.env.FRONTEND_URL}/mes-devis" style="display:inline-block;background:linear-gradient(135deg,#C48C8C,#D9A5A5);color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-weight:700;font-size:14px;">Voir mes devis →</a>
    </div>
  `);
  await send(quote.client_email, `Paiement confirmé — ${quote.quote_number} — MyWedding`, html);
};

exports.sendNewQuoteAlert = async (adminEmail, quote, provider) => {
  const html = wrap(`
    <h2 style="margin:0 0 8px;color:#1A0E0E;font-size:22px;font-weight:700;">📥 Nouveau devis reçu</h2>
    <p style="margin:0 0 24px;color:#6B5E5A;font-size:15px;">Un nouveau devis a été soumis sur MyWedding.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F7;border-radius:12px;border:1px solid #EDE8E6;margin-bottom:28px;">
      <tr><td style="padding:20px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:50%;padding-bottom:14px;">
              <p style="margin:0 0 3px;font-size:11px;color:#9B8E88;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Client</p>
              <p style="margin:0;font-size:14px;color:#1A0E0E;font-weight:600;">${quote.client_name}</p>
              <p style="margin:2px 0 0;font-size:12px;color:#9B8E88;">${quote.client_email}</p>
            </td>
            <td style="width:50%;padding-bottom:14px;">
              <p style="margin:0 0 3px;font-size:11px;color:#9B8E88;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Prestataire</p>
              <p style="margin:0;font-size:14px;color:#1A0E0E;font-weight:600;">${provider.name}</p>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #EDE8E6;padding-top:14px;">
              <p style="margin:0 0 3px;font-size:11px;color:#9B8E88;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Numéro</p>
              <p style="margin:0;font-size:14px;color:#D9A5A5;font-weight:700;font-family:monospace;">${quote.quote_number}</p>
            </td>
            <td style="border-top:1px solid #EDE8E6;padding-top:14px;">
              <p style="margin:0 0 3px;font-size:11px;color:#9B8E88;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Montant</p>
              <p style="margin:0;font-size:14px;color:#1A0E0E;font-weight:700;">${fmtPrice(quote.price_after_discount)} TND</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>

    <div style="text-align:center;">
      <a href="${process.env.FRONTEND_URL}/admin/devis" style="display:inline-block;background:linear-gradient(135deg,#C48C8C,#D9A5A5);color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-weight:700;font-size:14px;">Gérer les devis →</a>
    </div>
  `);
  await send(adminEmail, `Nouveau devis ${quote.quote_number} — MyWedding`, html);
};
