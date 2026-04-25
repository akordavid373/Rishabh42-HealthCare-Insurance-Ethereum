const express = require('express');
const { body, validationResult } = require('express-validator');
const PersonalizationService = require('../services/notifications/PersonalizationService');

const router = express.Router();

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: 'Validation failed', details: errors.array() });
    return true;
  }
  return false;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/notifications/preferences
 * Get the authenticated user's notification preferences
 * ═════════════════════════════════════════════════════════════════════════*/
router.get('/', async (req, res, next) => {
  try {
    const prefs = await PersonalizationService.getPreferences(req.user.id);

    // Strip internal fields before sending to client
    const { unsubscribe_token, push_subscription, ...safePrefs } = prefs;

    res.json({
      preferences: safePrefs,
      hasPushSubscription: Boolean(push_subscription),
    });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * PUT /api/notifications/preferences
 * Replace all user preferences
 * ═════════════════════════════════════════════════════════════════════════*/
router.put('/', [
  body('channel_in_app').optional().isBoolean().toBoolean(),
  body('channel_email').optional().isBoolean().toBoolean(),
  body('channel_sms').optional().isBoolean().toBoolean(),
  body('channel_push').optional().isBoolean().toBoolean(),
  body('quiet_hours_enabled').optional().isBoolean().toBoolean(),
  body('quiet_hours_start').optional().matches(/^\d{2}:\d{2}$/).withMessage('Format: HH:MM'),
  body('quiet_hours_end').optional().matches(/^\d{2}:\d{2}$/).withMessage('Format: HH:MM'),
  body('frequency_cap_hourly').optional().isInt({ min: 1, max: 50 }),
  body('frequency_cap_daily').optional().isInt({ min: 1, max: 200 }),
  body('type_appointment').optional().isBoolean().toBoolean(),
  body('type_claim').optional().isBoolean().toBoolean(),
  body('type_payment').optional().isBoolean().toBoolean(),
  body('type_system').optional().isBoolean().toBoolean(),
  body('type_medical_record').optional().isBoolean().toBoolean(),
  body('type_premium_adjustment').optional().isBoolean().toBoolean(),
], async (req, res, next) => {
  if (handleValidation(req, res)) return;
  try {
    await PersonalizationService.updatePreferences(req.user.id, req.body);
    res.json({ message: 'Preferences updated' });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * PATCH /api/notifications/preferences/channel/:channel
 * Toggle a single channel on/off
 * ═════════════════════════════════════════════════════════════════════════*/
router.patch('/channel/:channel', [
  body('enabled').isBoolean().toBoolean(),
], async (req, res, next) => {
  if (handleValidation(req, res)) return;

  const { channel } = req.params;
  const validChannels = ['in_app', 'email', 'sms', 'push'];
  if (!validChannels.includes(channel)) {
    return res.status(400).json({ error: `Invalid channel. Use: ${validChannels.join(', ')}` });
  }

  try {
    await PersonalizationService.updatePreferences(req.user.id, {
      [`channel_${channel}`]: req.body.enabled ? 1 : 0,
    });
    res.json({ message: `${channel} notifications ${req.body.enabled ? 'enabled' : 'disabled'}` });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * PATCH /api/notifications/preferences/quiet-hours
 * Set quiet hours window
 * ═════════════════════════════════════════════════════════════════════════*/
router.patch('/quiet-hours', [
  body('enabled').isBoolean().toBoolean(),
  body('start').optional().matches(/^\d{2}:\d{2}$/),
  body('end').optional().matches(/^\d{2}:\d{2}$/),
], async (req, res, next) => {
  if (handleValidation(req, res)) return;
  try {
    const updates = { quiet_hours_enabled: req.body.enabled ? 1 : 0 };
    if (req.body.start) updates.quiet_hours_start = req.body.start;
    if (req.body.end)   updates.quiet_hours_end   = req.body.end;
    await PersonalizationService.updatePreferences(req.user.id, updates);
    res.json({ message: 'Quiet hours updated' });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * PATCH /api/notifications/preferences/frequency-cap
 * Set per-category frequency caps
 * ═════════════════════════════════════════════════════════════════════════*/
router.patch('/frequency-cap', [
  body('hourly').optional().isInt({ min: 1, max: 50 }),
  body('daily').optional().isInt({ min: 1, max: 200 }),
], async (req, res, next) => {
  if (handleValidation(req, res)) return;
  try {
    const updates = {};
    if (req.body.hourly !== undefined) updates.frequency_cap_hourly = req.body.hourly;
    if (req.body.daily  !== undefined) updates.frequency_cap_daily  = req.body.daily;
    await PersonalizationService.updatePreferences(req.user.id, updates);
    res.json({ message: 'Frequency caps updated' });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POST /api/notifications/preferences/push-subscribe
 * Register a browser push subscription
 * ═════════════════════════════════════════════════════════════════════════*/
router.post('/push-subscribe', [
  body('subscription').isObject().withMessage('Push subscription object required'),
  body('subscription.endpoint').isURL(),
  body('subscription.keys').isObject(),
], async (req, res, next) => {
  if (handleValidation(req, res)) return;
  try {
    await PersonalizationService.updatePreferences(req.user.id, {
      channel_push:      1,
      push_subscription: JSON.stringify(req.body.subscription),
    });
    res.json({ message: 'Push subscription registered' });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * DELETE /api/notifications/preferences/push-subscribe
 * Remove push subscription
 * ═════════════════════════════════════════════════════════════════════════*/
router.delete('/push-subscribe', async (req, res, next) => {
  try {
    await PersonalizationService.updatePreferences(req.user.id, {
      channel_push:      0,
      push_subscription: null,
    });
    res.json({ message: 'Push subscription removed' });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/notifications/preferences/push-key
 * Return VAPID public key for client-side subscription setup
 * ═════════════════════════════════════════════════════════════════════════*/
router.get('/push-key', (req, res) => {
  const PushChannel = require('../services/notifications/channels/PushChannel');
  const key = new PushChannel().getPublicKey();
  if (!key) {
    return res.status(503).json({ error: 'Push notifications not configured' });
  }
  res.json({ publicKey: key });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/notifications/preferences/unsubscribe-token
 * Generate a fresh unsubscribe token for email footer links
 * ═════════════════════════════════════════════════════════════════════════*/
router.get('/unsubscribe-token', async (req, res) => {
  const token = PersonalizationService.generateUnsubscribeToken(req.user.id);
  res.json({ token });
});

module.exports = router;
