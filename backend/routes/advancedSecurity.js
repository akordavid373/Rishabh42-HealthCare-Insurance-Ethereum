/**
 * Advanced Security Routes - Issue #51
 */

const express = require('express');
const router = express.Router();
const advancedSecurityService = require('../services/advancedSecurityService');
const { authenticateToken: auth } = require('../middleware/auth');

// Evaluate trust for a request context
router.post('/trust/evaluate', auth, (req, res) => {
  const context = {
    ip: req.ip,
    userId: req.user?.id,
    userAgent: req.headers['user-agent'],
    timestamp: Date.now(),
    ...req.body,
  };
  const result = advancedSecurityService.evaluateTrust(context);
  res.json(result);
});

// Issue a service token
router.post('/service-tokens', auth, (req, res) => {
  try {
    const { serviceId, permissions, ttlSeconds } = req.body;
    if (!serviceId) return res.status(400).json({ error: 'serviceId is required' });
    const result = advancedSecurityService.issueServiceToken(serviceId, permissions || [], ttlSeconds);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Validate a service token
router.post('/service-tokens/validate', (req, res) => {
  const { serviceId, token, requiredPermission } = req.body;
  if (!serviceId || !token) return res.status(400).json({ error: 'serviceId and token are required' });
  const result = advancedSecurityService.validateServiceToken(serviceId, token, requiredPermission);
  res.json(result);
});

// Revoke a service token
router.delete('/service-tokens/:serviceId', auth, (req, res) => {
  const result = advancedSecurityService.revokeServiceToken(req.params.serviceId);
  res.json(result);
});

// Detect threats in a request
router.post('/threats/detect', auth, (req, res) => {
  const context = {
    ip: req.ip,
    headers: req.headers,
    path: req.path,
    payload: req.body,
  };
  const result = advancedSecurityService.detectThreats(context);
  res.json(result);
});

// Create an incident
router.post('/incidents', auth, (req, res) => {
  try {
    const { title, level, details } = req.body;
    if (!title || !level) return res.status(400).json({ error: 'title and level are required' });
    const incident = advancedSecurityService.createIncident(title, level, details);
    res.status(201).json(incident);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List incidents
router.get('/incidents', auth, (req, res) => {
  const { status, level } = req.query;
  const incidents = advancedSecurityService.listIncidents({ status, level });
  res.json({ incidents, total: incidents.length });
});

// Update an incident
router.patch('/incidents/:id', auth, (req, res) => {
  try {
    const incident = advancedSecurityService.updateIncident(req.params.id, req.body);
    res.json(incident);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Resolve an incident
router.post('/incidents/:id/resolve', auth, (req, res) => {
  try {
    const incident = advancedSecurityService.resolveIncident(req.params.id, req.body.resolution);
    res.json(incident);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Security dashboard
router.get('/dashboard', auth, (req, res) => {
  res.json(advancedSecurityService.getSecurityDashboard());
});

// Security events
router.get('/events', auth, (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  res.json({ events: advancedSecurityService.getSecurityEvents(limit) });
});

// Block an entity
router.post('/blocklist', auth, (req, res) => {
  const { entity } = req.body;
  if (!entity) return res.status(400).json({ error: 'entity is required' });
  advancedSecurityService.blockEntity(entity);
  res.json({ blocked: entity });
});

// Unblock an entity
router.delete('/blocklist/:entity', auth, (req, res) => {
  const result = advancedSecurityService.unblockEntity(req.params.entity);
  res.json(result);
});

// Compliance validation
router.get('/compliance', auth, (req, res) => {
  res.json(advancedSecurityService.validateCompliance());
});

module.exports = router;
