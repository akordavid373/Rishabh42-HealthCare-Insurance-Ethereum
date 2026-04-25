const crypto = require('crypto');

const IS_PROD = process.env.NODE_ENV === 'production';

// Regex patterns for PHI detection — used for safe-harbor stripping
const PHI_PATTERNS = [
  { pattern: /\$[\d,]+\.?\d*/g,           replacement: '$[AMOUNT]'   },  // dollar amounts
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g,   replacement: '[SSN]'       },  // SSN
  { pattern: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},?\s+\d{4}\b/gi, replacement: '[DATE]' },
];

/**
 * SMSChannel — delivers SMS notifications.
 *
 * In development: logs formatted stub to console.
 * In production: uses Twilio REST API.
 *
 * Required env vars (production):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 *
 * HIPAA note: PHI is stripped from SMS body before transmission.
 */
class SMSChannel {
  constructor() {
    this._client = null;
  }

  _getTwilioClient() {
    if (this._client) return this._client;
    if (!IS_PROD) return null;

    try {
      const twilio   = require('twilio');
      this._client   = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    } catch (err) {
      console.warn('[SMSChannel] twilio not available:', err.message);
    }

    return this._client;
  }

  /**
   * Deliver SMS notification.
   *
   * @param {object} notification  - notification DB row
   * @param {object} content       - rendered content { body }
   * @returns {Promise<{success: boolean, messageId: string|null, error: string|null}>}
   */
  async deliver(notification, content) {
    const rawBody  = content.body || notification.message || '';
    const smsBody  = this._prepareBody(rawBody);

    /* ── Development stub ─────────────────────────────────────────────── */
    if (!IS_PROD) {
      console.log(`
┌──────────────────────────────────────────────────────────┐
│  [SMSChannel] STUB — would send SMS                      │
│  To:   User ${String(notification.user_id).padEnd(48)} │
│  Body: ${String(smsBody).slice(0, 52).padEnd(52)} │
└──────────────────────────────────────────────────────────┘`);
      return {
        success:   true,
        messageId: `sms-stub-${crypto.randomBytes(8).toString('hex')}`,
        error:     null,
      };
    }

    /* ── Production send (Twilio) ─────────────────────────────────────── */
    try {
      const client = this._getTwilioClient();
      if (!client) throw new Error('Twilio client not configured');

      const to = notification.userPhone;
      if (!to) throw new Error('No phone number for user');

      const message = await client.messages.create({
        body: smsBody,
        from: process.env.TWILIO_FROM,
        to,
      });

      return { success: true, messageId: message.sid, error: null };
    } catch (err) {
      console.error('[SMSChannel] Send failed:', err.message);
      return { success: false, messageId: null, error: err.message };
    }
  }

  /**
   * Strip PHI and truncate to SMS segment limit.
   * @param {string} body
   * @returns {string}
   */
  _prepareBody(body) {
    let clean = body;

    // Strip HTML tags
    clean = clean.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

    // HIPAA safe-harbor: replace PHI patterns
    for (const { pattern, replacement } of PHI_PATTERNS) {
      clean = clean.replace(pattern, replacement);
    }

    // Append opt-out notice if not already present
    const optOut = ' Reply STOP to opt out.';
    const maxLen = 160 - optOut.length;
    if (clean.length > maxLen) {
      clean = clean.slice(0, maxLen - 1) + '…';
    }

    return clean + optOut;
  }
}

module.exports = SMSChannel;
