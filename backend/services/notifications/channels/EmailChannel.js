const crypto = require('crypto');

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * EmailChannel — delivers notification emails.
 *
 * In development: logs formatted output to console.
 * In production: uses Nodemailer via SMTP credentials from environment.
 *
 * Required env vars (production):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */
class EmailChannel {
  constructor() {
    this._transporter = null;
  }

  _getTransporter() {
    if (this._transporter) return this._transporter;

    if (!IS_PROD) return null; // use stub in dev

    try {
      const nodemailer = require('nodemailer');
      this._transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST,
        port:   parseInt(process.env.SMTP_PORT, 10) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    } catch (err) {
      console.warn('[EmailChannel] nodemailer not available:', err.message);
    }

    return this._transporter;
  }

  /**
   * Deliver email notification.
   *
   * @param {object} notification  - notification DB row (user_id, title, message, type, priority)
   * @param {object} content       - rendered content { subject, body }
   * @returns {Promise<{success: boolean, messageId: string|null, error: string|null}>}
   */
  async deliver(notification, content) {
    const subject = content.subject || notification.title;
    const body    = content.body    || notification.message;

    // Build unsubscribe URL from stored token
    const baseUrl    = process.env.FRONTEND_URL || 'http://localhost:3000';
    const apiUrl     = process.env.API_URL      || 'http://localhost:5000';
    const emailBody  = this._buildEmailHtml(subject, body, notification, apiUrl, baseUrl);

    /* ── Development stub ─────────────────────────────────────────────── */
    if (!IS_PROD) {
      console.log(`
╔════════════════════════════════════════════════════════╗
║  [EmailChannel] STUB — would send email                ║
╠════════════════════════════════════════════════════════╣
║  To:       User ${String(notification.user_id).padEnd(44)}║
║  Subject:  ${String(subject).slice(0, 50).padEnd(46)}  ║
║  Type:     ${String(notification.type).padEnd(46)}  ║
╚════════════════════════════════════════════════════════╝`);
      return {
        success:   true,
        messageId: `email-stub-${crypto.randomBytes(8).toString('hex')}`,
        error:     null,
      };
    }

    /* ── Production send ──────────────────────────────────────────────── */
    try {
      const transporter = this._getTransporter();
      if (!transporter) throw new Error('Email transporter not configured');

      // Fetch user email — in a real system inject it into notification payload
      const from = process.env.SMTP_FROM || 'noreply@healthcare.example.com';

      const info = await transporter.sendMail({
        from,
        to:      notification.userEmail || `user-${notification.user_id}@internal`,
        subject,
        html:    emailBody,
        text:    body,
        headers: {
          'X-Notification-Id':   String(notification.id),
          'X-Notification-Type': notification.type,
          'List-Unsubscribe':    `<${apiUrl}/api/notifications/unsubscribe>`,
        },
      });

      return { success: true, messageId: info.messageId, error: null };
    } catch (err) {
      console.error('[EmailChannel] Send failed:', err.message);
      return { success: false, messageId: null, error: err.message };
    }
  }

  /* ─── HTML email builder ─────────────────────────────────────────────── */
  _buildEmailHtml(subject, body, notification, apiUrl, baseUrl) {
    const priorityColor = {
      urgent: '#ef4444',
      high:   '#f97316',
      medium: '#3b82f6',
      low:    '#6b7280',
    }[notification.priority] || '#3b82f6';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="font-family:Inter,Arial,sans-serif;background:#f9fafb;margin:0;padding:32px 16px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,.08);">
    <div style="background:${priorityColor};padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:600;">${subject}</h1>
      <p style="color:rgba(255,255,255,.85);margin:4px 0 0;font-size:13px;text-transform:uppercase;letter-spacing:.05em;">${notification.type} · ${notification.priority}</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px;">${body}</p>
      <a href="${baseUrl}" style="display:inline-block;background:${priorityColor};color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">View in Dashboard</a>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #f3f4f6;background:#f9fafb;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">
        Healthcare Insurance Platform &nbsp;·&nbsp;
        <a href="${apiUrl}/api/notifications/unsubscribe" style="color:#9ca3af;">Unsubscribe</a> &nbsp;·&nbsp;
        <a href="${baseUrl}/preferences" style="color:#9ca3af;">Manage preferences</a>
      </p>
    </div>
  </div>
</body>
</html>`;
  }
}

module.exports = EmailChannel;
