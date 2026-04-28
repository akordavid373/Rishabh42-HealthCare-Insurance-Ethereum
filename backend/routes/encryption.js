/**
 * Data Encryption and Security Routes - Issue #40
 */

const express = require('express');
const router = express.Router();
const encryptionService = require('../services/encryptionService');
const { authenticateToken: auth } = require('../middleware/auth');

// Encrypt data at rest
router.post('/encrypt', auth, (req, res) => {
  try {
    const { data, context } = req.body;
    if (!data) return res.status(400).json({ error: 'data is required' });
    const result = encryptionService.encryptAtRest(data, context);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Decrypt data at rest
router.post('/decrypt', auth, (req, res) => {
  try {
    const { ciphertext, keyId, context } = req.body;
    if (!ciphertext || !keyId) return res.status(400).json({ error: 'ciphertext and keyId are required' });
    const plaintext = encryptionService.decryptAtRest(ciphertext, keyId, context);
    res.json({ plaintext });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Encrypt for transit
router.post('/encrypt-transit', auth, (req, res) => {
  try {
    const { payload } = req.body;
    if (!payload) return res.status(400).json({ error: 'payload is required' });
    const result = encryptionService.encryptForTransit(payload);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Decrypt from transit
router.post('/decrypt-transit', auth, (req, res) => {
  try {
    const result = encryptionService.decryptFromTransit(req.body);
    res.json({ data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Rotate encryption key
router.post('/keys/rotate', auth, (req, res) => {
  try {
    const result = encryptionService.rotateKey();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List keys (metadata only)
router.get('/keys', auth, (req, res) => {
  res.json({ keys: encryptionService.listKeys() });
});

// Hash a field
router.post('/hash', auth, (req, res) => {
  try {
    const { value } = req.body;
    if (!value) return res.status(400).json({ error: 'value is required' });
    const result = encryptionService.hashField(value);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify a hashed field
router.post('/hash/verify', auth, (req, res) => {
  try {
    const { value, hash, salt } = req.body;
    if (!value || !hash || !salt) return res.status(400).json({ error: 'value, hash, and salt are required' });
    const valid = encryptionService.verifyField(value, hash, salt);
    res.json({ valid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Scan input for vulnerabilities
router.post('/scan', auth, (req, res) => {
  const { input } = req.body;
  if (!input) return res.status(400).json({ error: 'input is required' });
  const result = encryptionService.scanInput(input);
  res.json(result);
});

// Audit log
router.get('/audit', auth, (req, res) => {
  const { action, since } = req.query;
  const logs = encryptionService.getAuditLog({ action, since });
  res.json({ logs });
});

// Compliance report
router.get('/compliance', auth, (req, res) => {
  res.json(encryptionService.complianceReport());
});

module.exports = router;
