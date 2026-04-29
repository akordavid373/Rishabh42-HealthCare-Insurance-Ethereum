const express = require('express');
const router = express.Router();
const auditService = require('../services/auditService');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// All audit routes require admin role
router.use(authenticateToken);
router.use(authorizeRole(['admin']));

/**
 * @route GET /api/audit/logs
 * @desc Search audit logs
 */
router.get('/logs', async (req, res) => {
  try {
    const filters = {
      user_id: req.query.user_id,
      resource: req.query.resource,
      action: req.query.action,
      status: req.query.status,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    const options = {
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0
    };

    const logs = await auditService.search(filters, options);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route GET /api/audit/logs/:id/verify
 * @desc Verify integrity of a specific log entry
 */
router.get('/logs/:id/verify', async (req, res) => {
  try {
    const isValid = await auditService.verifyIntegrity(req.params.id);
    res.json({ id: req.params.id, isValid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route POST /api/audit/retention
 * @desc Manually trigger retention policy (cleanup)
 */
router.post('/retention', async (req, res) => {
  try {
    const days = parseInt(req.body.days) || 90;
    const deletedCount = await auditService.applyRetentionPolicy(days);
    res.json({ message: `Retention policy applied. Deleted ${deletedCount} logs.`, deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route GET /api/audit/report
 * @desc Generate an audit report (CSV)
 */
router.get('/report', async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    const logs = await auditService.search(filters, { limit: 10000 });
    
    if (req.query.format === 'csv') {
      const csv = convertToCsv(logs);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=audit_report.csv');
      return res.send(csv);
    }

    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function convertToCsv(logs) {
  if (!logs || logs.length === 0) return '';
  const headers = ['id', 'timestamp', 'user_email', 'action', 'resource', 'resource_id', 'status', 'ip_address'];
  const csvRows = [headers.join(',')];

  for (const log of logs) {
    const values = headers.map(header => {
      const val = log[header];
      return `"${String(val || '').replace(/"/g, '""')}"`;
    });
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
}

module.exports = router;
