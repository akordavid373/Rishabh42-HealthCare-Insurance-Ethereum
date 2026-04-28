/**
 * Background Job Processing Service - Issue #43
 * Job queue, retry logic, monitoring, priority queues, scheduled jobs, failure handling, metrics
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');

const JOB_STATUS = { PENDING: 'pending', RUNNING: 'running', COMPLETED: 'completed', FAILED: 'failed', RETRYING: 'retrying' };
const PRIORITY = { HIGH: 1, NORMAL: 5, LOW: 10 };

class JobQueueService extends EventEmitter {
  constructor() {
    super();
    this._queues = new Map();   // priority -> Job[]
    this._jobs = new Map();     // jobId -> Job
    this._handlers = new Map(); // jobType -> handler fn
    this._scheduled = [];       // { cronExpr, jobType, data, nextRun }
    this._metrics = { enqueued: 0, completed: 0, failed: 0, retried: 0 };
    this._running = false;
    this._concurrency = parseInt(process.env.JOB_CONCURRENCY || '3', 10);
    this._activeCount = 0;

    // Initialize priority queues
    for (const p of Object.values(PRIORITY)) this._queues.set(p, []);
  }

  // ─── Registration ─────────────────────────────────────────────────────────

  /**
   * Register a handler for a job type
   */
  register(jobType, handler) {
    this._handlers.set(jobType, handler);
  }

  // ─── Enqueue ──────────────────────────────────────────────────────────────

  /**
   * Add a job to the queue
   */
  enqueue(jobType, data = {}, options = {}) {
    if (!this._handlers.has(jobType)) throw new Error(`No handler registered for job type: ${jobType}`);

    const job = {
      id: crypto.randomUUID(),
      type: jobType,
      data,
      priority: options.priority || PRIORITY.NORMAL,
      maxRetries: options.maxRetries !== undefined ? options.maxRetries : 3,
      retryDelay: options.retryDelay || 1000, // ms
      retries: 0,
      status: JOB_STATUS.PENDING,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null,
    };

    this._jobs.set(job.id, job);
    this._getQueue(job.priority).push(job);
    this._metrics.enqueued++;
    this.emit('enqueued', job);

    if (this._running) this._processNext();
    return job.id;
  }

  // ─── Scheduled Jobs ───────────────────────────────────────────────────────

  /**
   * Schedule a recurring job using a simple interval (ms)
   */
  schedule(jobType, data = {}, intervalMs, options = {}) {
    if (!this._handlers.has(jobType)) throw new Error(`No handler registered for job type: ${jobType}`);

    const entry = {
      id: crypto.randomUUID(),
      jobType,
      data,
      intervalMs,
      options,
      nextRun: Date.now() + intervalMs,
    };

    this._scheduled.push(entry);
    return entry.id;
  }

  // ─── Worker ───────────────────────────────────────────────────────────────

  /**
   * Start the job processor
   */
  start() {
    if (this._running) return;
    this._running = true;
    this._schedulerInterval = setInterval(() => this._runScheduled(), 1000);
    this._processNext();
  }

  /**
   * Stop the job processor
   */
  stop() {
    this._running = false;
    if (this._schedulerInterval) clearInterval(this._schedulerInterval);
  }

  async _processNext() {
    if (!this._running || this._activeCount >= this._concurrency) return;

    const job = this._dequeue();
    if (!job) return;

    this._activeCount++;
    job.status = JOB_STATUS.RUNNING;
    job.startedAt = new Date().toISOString();
    this.emit('started', job);

    try {
      const handler = this._handlers.get(job.type);
      job.result = await handler(job.data, job);
      job.status = JOB_STATUS.COMPLETED;
      job.completedAt = new Date().toISOString();
      this._metrics.completed++;
      this.emit('completed', job);
    } catch (err) {
      job.error = err.message;
      if (job.retries < job.maxRetries) {
        job.retries++;
        job.status = JOB_STATUS.RETRYING;
        this._metrics.retried++;
        this.emit('retrying', job);
        setTimeout(() => {
          job.status = JOB_STATUS.PENDING;
          this._getQueue(job.priority).push(job);
          this._processNext();
        }, job.retryDelay * job.retries); // exponential backoff
      } else {
        job.status = JOB_STATUS.FAILED;
        job.completedAt = new Date().toISOString();
        this._metrics.failed++;
        this.emit('failed', job);
      }
    } finally {
      this._activeCount--;
      this._processNext();
    }
  }

  _runScheduled() {
    const now = Date.now();
    for (const entry of this._scheduled) {
      if (now >= entry.nextRun) {
        this.enqueue(entry.jobType, entry.data, entry.options);
        entry.nextRun = now + entry.intervalMs;
      }
    }
  }

  // ─── Monitoring ───────────────────────────────────────────────────────────

  getJob(jobId) {
    return this._jobs.get(jobId) || null;
  }

  listJobs(filter = {}) {
    let jobs = Array.from(this._jobs.values());
    if (filter.status) jobs = jobs.filter(j => j.status === filter.status);
    if (filter.type) jobs = jobs.filter(j => j.type === filter.type);
    return jobs;
  }

  getMetrics() {
    const queueDepth = {};
    for (const [priority, queue] of this._queues) {
      queueDepth[priority] = queue.filter(j => j.status === JOB_STATUS.PENDING).length;
    }
    return {
      ...this._metrics,
      activeJobs: this._activeCount,
      queueDepth,
      scheduledJobs: this._scheduled.length,
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _dequeue() {
    // Process highest priority (lowest number) first
    for (const priority of [PRIORITY.HIGH, PRIORITY.NORMAL, PRIORITY.LOW]) {
      const queue = this._queues.get(priority);
      const idx = queue.findIndex(j => j.status === JOB_STATUS.PENDING);
      if (idx !== -1) return queue.splice(idx, 1)[0];
    }
    return null;
  }

  _getQueue(priority) {
    if (!this._queues.has(priority)) this._queues.set(priority, []);
    return this._queues.get(priority);
  }
}

const jobQueue = new JobQueueService();

// Register built-in job handlers
jobQueue.register('send-email', async (data) => {
  // Placeholder: integrate with email provider
  return { sent: true, to: data.to, subject: data.subject };
});

jobQueue.register('generate-report', async (data) => {
  // Placeholder: generate report logic
  return { reportId: crypto.randomUUID(), type: data.reportType };
});

jobQueue.register('process-claim', async (data) => {
  // Placeholder: claim processing logic
  return { claimId: data.claimId, processed: true };
});

// Auto-start
jobQueue.start();

module.exports = { jobQueue, JOB_STATUS, PRIORITY };
