/**
 * Background Job Processing Routes - Issue #43
 */

const express = require('express');
const router = express.Router();
const { jobQueue, PRIORITY } = require('../services/jobQueueService');
const { authenticateToken: auth } = require('../middleware/auth');

// Enqueue a job
router.post('/enqueue', auth, (req, res) => {
  try {
    const { type, data, priority, maxRetries, retryDelay } = req.body;
    if (!type) return res.status(400).json({ error: 'type is required' });

    const priorityValue = PRIORITY[String(priority).toUpperCase()] || PRIORITY.NORMAL;
    const jobId = jobQueue.enqueue(type, data || {}, { priority: priorityValue, maxRetries, retryDelay });
    res.status(202).json({ jobId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Schedule a recurring job
router.post('/schedule', auth, (req, res) => {
  try {
    const { type, data, intervalMs } = req.body;
    if (!type || !intervalMs) return res.status(400).json({ error: 'type and intervalMs are required' });

    const scheduleId = jobQueue.schedule(type, data || {}, Number(intervalMs));
    res.status(201).json({ scheduleId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get a specific job
router.get('/:jobId', auth, (req, res) => {
  const job = jobQueue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// List jobs with optional filter
router.get('/', auth, (req, res) => {
  const { status, type } = req.query;
  const jobs = jobQueue.listJobs({ status, type });
  res.json({ jobs, total: jobs.length });
});

// Get metrics
router.get('/metrics/summary', auth, (req, res) => {
  res.json(jobQueue.getMetrics());
});

module.exports = router;
