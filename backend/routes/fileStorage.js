/**
 * File Storage Routes - Issue #39
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fileStorageService = require('../services/fileStorageService');
const { authenticateToken: auth } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// Upload a file
router.post('/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const result = await fileStorageService.uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      req.user.id,
      { accessControl: req.body.accessControl || 'private' }
    );

    res.status(201).json(result);
  } catch (err) {
    const status = err.message.includes('Security scan') ? 422 : err.message.includes('Access denied') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Download a file
router.get('/download/:storageKey(*)', auth, async (req, res) => {
  try {
    const { buffer, metadata } = await fileStorageService.downloadFile(req.params.storageKey, req.user.id);
    res.set('Content-Type', metadata.mimeType);
    res.set('Content-Disposition', `attachment; filename="${metadata.fileName}"`);
    res.send(buffer);
  } catch (err) {
    const status = err.message === 'File not found' ? 404 : err.message === 'Access denied' ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Delete a file
router.delete('/:storageKey(*)', auth, async (req, res) => {
  try {
    const result = await fileStorageService.deleteFile(req.params.storageKey, req.user.id);
    res.json(result);
  } catch (err) {
    const status = err.message === 'File not found' ? 404 : err.message === 'Access denied' ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Get file versions
router.get('/versions/:storageKey(*)', auth, (req, res) => {
  try {
    const versions = fileStorageService.getVersions(req.params.storageKey);
    res.json(versions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restore a version
router.post('/versions/:storageKey(*)/restore', auth, (req, res) => {
  try {
    const { version } = req.body;
    if (!version) return res.status(400).json({ error: 'version is required' });
    const result = fileStorageService.restoreVersion(req.params.storageKey, Number(version));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Generate pre-signed URL
router.post('/presign/:storageKey(*)', auth, (req, res) => {
  try {
    const expiresIn = req.body.expiresIn || 3600;
    const result = fileStorageService.generatePresignedUrl(req.params.storageKey, expiresIn);
    res.json(result);
  } catch (err) {
    const status = err.message === 'File not found' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Get access logs
router.get('/logs/:storageKey(*)', auth, (req, res) => {
  const logs = fileStorageService.getAccessLogs(req.params.storageKey);
  res.json({ logs });
});

module.exports = router;
