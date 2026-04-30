const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const loggingService = require('./services/loggingService');
const monitoringService = require('./services/monitoringService');

const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const medicalRecordsRoutes = require('./routes/medicalRecords');
const claimsRoutes = require('./routes/claims');
const appointmentsRoutes = require('./routes/appointments');
const paymentsRoutes = require('./routes/payments');
const contributorVerificationRoutes = require('./routes/contributorVerification');
const notificationsRoutes = require('./routes/notifications');
const notificationPreferencesRoutes = require('./routes/notificationPreferences');
const notificationAnalyticsRoutes = require('./routes/notificationAnalytics');

const NotificationEngine = require('./services/notifications/NotificationEngine');
const QueueProcessor     = require('./services/notifications/QueueProcessor');
const fraudDetectionRoutes = require('./routes/fraudDetection');
const securityRoutes = require('./routes/security');
const aiRecommendationRoutes = require('./routes/aiRecommendation');
const iotHealthMonitoringRoutes = require('./routes/iotHealthMonitoring');
const crossPlatformIntegrationRoutes = require('./routes/crossPlatformIntegration');
const advancedPaymentsRoutes = require('./routes/advancedPayments');
const feeConfigRoutes = require('./routes/feeConfigs');
const insuranceMarketplaceRoutes = require('./routes/insuranceMarketplace');
const mlModelServingRoutes = require('./routes/mlModelServing');
const advancedSearchRoutes = require('./routes/advancedSearch');
const advancedNotificationsRoutes = require('./routes/advancedNotifications');
const collaborationRoutes = require('./routes/collaboration');
const treasuryRoutes = require('./routes/treasury');
const dataVisualizationRoutes = require('./routes/dataVisualization');
const reinsuranceRoutes = require('./routes/reinsurance');
const fraudContractsRoutes = require('./routes/fraudContracts');
const blockchainRoutes = require('./routes/blockchain');


const { initializeDatabase } = require('./database/init');
const { authenticateToken } = require('./middleware/auth');
const { cacheMiddleware } = require('./middleware/cache');
const { errorHandler } = require('./middleware/errorHandler');
const performanceMonitoringService = require('./services/performanceMonitoringService');
const threatIntelligenceService = require('./services/threatIntelligenceService');
const aiPerformanceMonitoringService = require('./services/aiPerformanceMonitoringService');
const emailService = require('./services/emailService');
const realTimeProcessingService = require('./services/realTimeProcessingService');
const advancedRateLimitingService = require('./services/advancedRateLimitingService');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(helmet());
app.use(compression());
app.use(monitoringService.metricsMiddleware());
app.use(limiter);
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Add performance monitoring middleware
app.use(performanceMonitoringService.apiPerformanceMiddleware());

// Add AI performance monitoring middleware
app.use(aiPerformanceMonitoringService.aiPerformanceMiddleware());

app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/patients', authenticateToken, cacheMiddleware, patientRoutes);
app.use('/api/medical-records', authenticateToken, cacheMiddleware, medicalRecordsRoutes);
app.use('/api/claims', authenticateToken, cacheMiddleware, claimsRoutes);
app.use('/api/appointments', authenticateToken, cacheMiddleware, appointmentsRoutes);
app.use('/api/payments', authenticateToken, cacheMiddleware, paymentsRoutes);
app.use('/api/contributor', authenticateToken, contributorVerificationRoutes);
app.use('/api/fraud-detection', authenticateToken, fraudDetectionRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/ai', authenticateToken, aiRecommendationRoutes);
app.use('/api/iot', authenticateToken, iotHealthMonitoringRoutes);
app.use('/api/integrations', authenticateToken, crossPlatformIntegrationRoutes);
app.use('/api/advanced-payments', authenticateToken, advancedPaymentsRoutes);
app.use('/api/fee-configs', authenticateToken, feeConfigRoutes);
app.use('/api/marketplace', authenticateToken, insuranceMarketplaceRoutes);
app.use('/api/ml', authenticateToken, mlModelServingRoutes);
app.use('/api/search', authenticateToken, advancedSearchRoutes);
app.use('/api/notifications', authenticateToken, advancedNotificationsRoutes);
app.use('/api/collaboration', authenticateToken, collaborationRoutes);
app.use('/api/treasury', authenticateToken, treasuryRoutes);
app.use('/api/visualization', authenticateToken, dataVisualizationRoutes);
app.use('/api/reinsurance', authenticateToken, reinsuranceRoutes);
app.use('/api/fraud-contracts', authenticateToken, fraudContractsRoutes);
app.use('/api/database-optimization', authenticateToken, databaseOptimizationRoutes);

// ── Blockchain Integration Layer ─────────────────────────────────────────
app.use('/api/blockchain', blockchainRoutes);

// ── Notification system ──────────────────────────────────────────────────
app.use('/api/notifications/preferences',  authenticateToken, notificationPreferencesRoutes);
app.use('/api/notifications/analytics',    authenticateToken, notificationAnalyticsRoutes);
app.use('/api/notifications',              authenticateToken, notificationsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/api/metrics', async (req, res) => {
  try {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.end(await monitoringService.getMetrics());
  } catch (error) {
    res.status(500).end(error.message);
  }
});

io.on('connection', (socket) => {
  loggingService.info(`Client connected: ${socket.id}`);

  // Legacy patient room (kept for backward compatibility)
  socket.on('join-patient-room', (patientId) => {
    socket.join(`patient-${patientId}`);
    console.log(`Socket ${socket.id} joined patient room ${patientId}`);
  });

  // User room — used by notification system for real-time delivery
  socket.on('join-user-room', (userId) => {
    socket.join(`user-${userId}`);
    console.log(`Socket ${socket.id} joined user room ${userId}`);
  });

  // Collaboration rooms
  socket.on('join-workspace', (workspaceId) => {
    socket.join(`workspace-${workspaceId}`);
  });

  socket.on('join-document', (docId) => {
    socket.join(`doc-${docId}`);
  });

  socket.on('disconnect', () => {
    loggingService.info(`Client disconnected: ${socket.id}`);
  });
});

app.use(errorHandler);

async function startServer() {
  try {
    await initializeDatabase();

    // Initialize blockchain integration layer
    const blockchainLayer = require('./blockchain');
    await blockchainLayer.initialize();

    // Initialise notification engine with the socket.io instance
    NotificationEngine.getInstance(io);

    server.listen(PORT, () => {
      loggingService.info(`🚀 Healthcare API Server running on port ${PORT}`);
      loggingService.info(`📊 Dashboard available at: http://localhost:${PORT}/api/health`);
      loggingService.info(`📈 Prometheus metrics at: http://localhost:${PORT}/api/metrics`);

      // Start queue processor after server is listening
      QueueProcessor.getInstance().start();

      // Start system monitoring
      startSystemMonitoring();

      console.log(`🔒 Advanced Security API enabled`);
      console.log(`📈 Performance monitoring active`);
      console.log(`🤖 AI Recommendation Engine enabled`);
      console.log(`📡 IoT Health Monitoring API enabled`);
      console.log(`🔗 Cross-Platform Integration Framework enabled`);
      console.log(`💳 Advanced Payment Processing API enabled`);
      console.log(`🏪 Insurance Marketplace Platform enabled`);
      console.log(`⛓️  Blockchain Integration Layer enabled`);
    });
  } catch (error) {
    loggingService.error('Failed to start server', error);
    process.exit(1);
  }
}

// Graceful shutdown — stop queue processor before exit
process.on('SIGTERM', () => {
  loggingService.info('SIGTERM received — shutting down gracefully');
  QueueProcessor.getInstance().stop();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  loggingService.info('SIGINT received — shutting down gracefully');
  QueueProcessor.getInstance().stop();
  server.close(() => process.exit(0));
});
// Start system monitoring
function startSystemMonitoring() {
  // Collect system metrics every 30 seconds
  setInterval(async () => {
    try {
      await performanceMonitoringService.collectSystemMetrics();
    } catch (error) {
      console.error('Error collecting system metrics:', error);
    }
  }, 30000);

  // Update threat feeds every hour
  setInterval(async () => {
    try {
      await threatIntelligenceService.updateThreatFeeds();
    } catch (error) {
      console.error('Error updating threat feeds:', error);
    }
  }, 3600000);

  // Collect AI system health metrics every 30 seconds
  setInterval(async () => {
    try {
      const cpuUsage = process.cpuUsage().user / 1000000; // Convert to percentage
      const memUsage = process.memoryUsage();
      const memoryUsage = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      await aiPerformanceMonitoringService.recordSystemHealth(
        cpuUsage,
        memoryUsage,
        0, // disk usage would require additional monitoring
        0, // active models count
        0, // active requests count
        0, // queue size
        0  // error count
      );
    } catch (error) {
      loggingService.error('Error collecting AI system metrics', error);
    }
  }, 30000);

  loggingService.info('🔍 System monitoring started');
  loggingService.info('🛡️  Threat intelligence updates scheduled');
  loggingService.info('🤖 AI performance monitoring started');
}

startServer();

module.exports = { app, io };
