const express = require('express');
const { query, validationResult } = require('express-validator');
const AnalyticsService = require('../services/notifications/AnalyticsService');
const QueueProcessor   = require('../services/notifications/QueueProcessor');
const { requireRole }  = require('../middleware/notificationSecurity');

const router = express.Router();

// All analytics routes are admin/provider only
router.use(requireRole('admin', 'provider'));

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: 'Validation failed', details: errors.array() });
    return true;
  }
  return false;
}

const dateRange = [
  query('from').optional().isISO8601().toDate().withMessage('from must be YYYY-MM-DD'),
  query('to').optional().isISO8601().toDate().withMessage('to must be YYYY-MM-DD'),
];

function fmtDate(d) {
  if (!d) return undefined;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/notifications/analytics/dashboard
 * High-level summary: delivery rates, open rates, avg latency
 * ═════════════════════════════════════════════════════════════════════════*/
router.get('/dashboard', dateRange, async (req, res, next) => {
  if (handleValidation(req, res)) return;
  try {
    const data = await AnalyticsService.getDashboard(fmtDate(req.query.from), fmtDate(req.query.to));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/notifications/analytics/trends
 * Daily counts for charting (sent/delivered/opened/failed per day)
 * ═════════════════════════════════════════════════════════════════════════*/
router.get('/trends', dateRange, async (req, res, next) => {
  if (handleValidation(req, res)) return;
  try {
    const data = await AnalyticsService.getTrends(fmtDate(req.query.from), fmtDate(req.query.to));
    res.json({ trends: data });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/notifications/analytics/channels
 * Per-channel breakdown over the time range
 * ═════════════════════════════════════════════════════════════════════════*/
router.get('/channels', dateRange, async (req, res, next) => {
  if (handleValidation(req, res)) return;
  try {
    const data = await AnalyticsService.getChannelBreakdown(fmtDate(req.query.from), fmtDate(req.query.to));
    res.json({ channels: data });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/notifications/analytics/types
 * Per-notification-type breakdown
 * ═════════════════════════════════════════════════════════════════════════*/
router.get('/types', dateRange, async (req, res, next) => {
  if (handleValidation(req, res)) return;
  try {
    const { period, byType } = await AnalyticsService.getDashboard(
      fmtDate(req.query.from),
      fmtDate(req.query.to)
    );
    res.json({ period, types: byType });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/notifications/analytics/failures
 * Top failure modes by channel and error code
 * ═════════════════════════════════════════════════════════════════════════*/
router.get('/failures', dateRange, async (req, res, next) => {
  if (handleValidation(req, res)) return;
  try {
    const data = await AnalyticsService.getFailures(fmtDate(req.query.from), fmtDate(req.query.to));
    res.json({ failures: data });
  } catch (err) {
    next(err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/notifications/analytics/queue
 * Real-time queue status (depth, processing, failed)
 * ═════════════════════════════════════════════════════════════════════════*/
router.get('/queue', async (req, res, next) => {
  try {
    const processor = QueueProcessor.getInstance();
    const status    = await processor.getStatus();
    res.json({ queue: status });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
