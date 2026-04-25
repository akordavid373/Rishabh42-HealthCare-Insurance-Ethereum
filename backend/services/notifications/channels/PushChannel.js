const crypto = require('crypto');

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * PushChannel — delivers Web Push notifications (VAPID).
 *
 * In development: logs formatted stub to console.
 * In production: uses web-push library.
 *
 * Required env vars (production):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:admin@example.com)
 *
 * Clients register push subscriptions via:
 *   POST /api/notifications/preferences/push-subscribe
 */
class PushChannel {
  constructor() {
    this._webpush = null;
  }

  _getWebPush() {
    if (this._webpush) return this._webpush;
    if (!IS_PROD) return null;

    try {
      const webpush = require('web-push');
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:admin@healthcare.example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
      this._webpush = webpush;
    } catch (err) {
      console.warn('[PushChannel] web-push not available:', err.message);
    }

    return this._webpush;
  }

  /**
   * Deliver a Web Push notification.
   *
   * @param {object} notification  - notification DB row (must include pushSubscription JSON)
   * @param {object} content       - rendered content { title, body }
   * @returns {Promise<{success: boolean, messageId: string|null, error: string|null}>}
   */
  async deliver(notification, content) {
    const title = content.title || notification.title;
    const body  = content.body  || notification.message;

    const pushPayload = JSON.stringify({
      title,
      body,
      icon:      '/icon-192.png',
      badge:     '/badge-72.png',
      tag:       `healthcare-${notification.type}`,
      data: {
        notificationId: notification.id,
        type:           notification.type,
        url:            '/dashboard',
      },
    });

    /* ── Development stub ──────────────────────────────────────────────── */
    if (!IS_PROD) {
      console.log(`
┌──────────────────────────────────────────────────────────┐
│  [PushChannel] STUB — would send Web Push                │
│  To:    User ${String(notification.user_id).padEnd(47)} │
│  Title: ${String(title).slice(0, 52).padEnd(52)} │
│  Body:  ${String(body).slice(0, 52).padEnd(52)} │
└──────────────────────────────────────────────────────────┘`);
      return {
        success:   true,
        messageId: `push-stub-${crypto.randomBytes(8).toString('hex')}`,
        error:     null,
      };
    }

    /* ── Production send ───────────────────────────────────────────────── */
    try {
      const webpush = this._getWebPush();
      if (!webpush) throw new Error('web-push not configured');

      // Subscription JSON stored in notification_preferences.push_subscription
      let subscription;
      try {
        subscription = JSON.parse(notification.pushSubscription || '');
      } catch (_) {
        throw new Error('Invalid or missing push subscription for user');
      }

      const result = await webpush.sendNotification(subscription, pushPayload);
      return {
        success:   true,
        messageId: `push-${result.statusCode}-${crypto.randomBytes(4).toString('hex')}`,
        error:     null,
      };
    } catch (err) {
      // 410 Gone = subscription expired/revoked — should be cleaned up
      if (err.statusCode === 410) {
        console.warn(`[PushChannel] Subscription expired for user ${notification.user_id}`);
        // Emit event so caller can clean up the subscription
        return { success: false, messageId: null, error: 'subscription_expired', errorCode: '410' };
      }
      console.error('[PushChannel] Send failed:', err.message);
      return { success: false, messageId: null, error: err.message };
    }
  }

  /**
   * Generate VAPID public key for client-side registration.
   * @returns {string|null}
   */
  getPublicKey() {
    return process.env.VAPID_PUBLIC_KEY || null;
  }
}

module.exports = PushChannel;
