const express = require('express');
const { body, query, validationResult } = require('express-validator');
const emailService = require('../services/emailService');
const { authenticateToken } = require('../middleware/auth');
const { setCache } = require('../middleware/cache');

const router = express.Router();

// Middleware to check validation errors
const checkValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// SMTP Configuration Routes

// Create SMTP configuration
router.post('/configs', [
  authenticateToken,
  body('name').isString().isLength({ min: 1, max: 100 }),
  body('host').isString().isLength({ min: 1 }),
  body('port').isInt({ min: 1, max: 65535 }),
  body('username').isString().isLength({ min: 1 }),
  body('password').isString().isLength({ min: 1 }),
  body('from_email').isEmail(),
  body('from_name').optional().isString().isLength({ max: 100 }),
  body('is_default').optional().isBoolean(),
  body('is_active').optional().isBoolean()
], checkValidation, async (req, res) => {
  try {
    const configId = await emailService.createConfig(req.body);
    
    res.status(201).json({
      success: true,
      data: { config_id: configId },
      message: 'SMTP configuration created successfully'
    });
  } catch (error) {
    console.error('Error creating SMTP config:', error);
    res.status(500).json({
      error: 'Failed to create SMTP configuration',
      message: error.message
    });
  }
});

// Get SMTP configurations
router.get('/configs', [
  authenticateToken,
  query('is_active').optional().isBoolean()
], checkValidation, async (req, res) => {
  try {
    const { is_active } = req.query;
    
    // This would need to be implemented in the service
    const configs = await emailService.getConfigs(is_active);
    
    res.json({
      success: true,
      data: configs
    });
  } catch (error) {
    console.error('Error getting SMTP configs:', error);
    res.status(500).json({
      error: 'Failed to retrieve SMTP configurations',
      message: error.message
    });
  }
});

// Email Template Routes

// Create email template
router.post('/templates', [
  authenticateToken,
  body('name').isString().isLength({ min: 1, max: 100 }),
  body('subject').isString().isLength({ min: 1, max: 200 }),
  body('html_body').isString().isLength({ min: 1 }),
  body('text_body').optional().isString(),
  body('variables').optional().isArray(),
  body('category').optional().isString().isLength({ max: 50 }),
  body('is_active').optional().isBoolean()
], checkValidation, async (req, res) => {
  try {
    const templateId = await emailService.createTemplate(req.body);
    
    res.status(201).json({
      success: true,
      data: { template_id: templateId },
      message: 'Email template created successfully'
    });
  } catch (error) {
    console.error('Error creating email template:', error);
    res.status(500).json({
      error: 'Failed to create email template',
      message: error.message
    });
  }
});

// Get email templates
router.get('/templates', [
  authenticateToken,
  query('category').optional().isString(),
  query('is_active').optional().isBoolean()
], checkValidation, async (req, res) => {
  try {
    const { category, is_active } = req.query;
    
    // This would need to be implemented in the service
    const templates = await emailService.getTemplates(category, is_active);
    
    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    console.error('Error getting email templates:', error);
    res.status(500).json({
      error: 'Failed to retrieve email templates',
      message: error.message
    });
  }
});

// Send immediate email
router.post('/send', [
  authenticateToken,
  body('to').isEmail(),
  body('subject').optional().isString().isLength({ min: 1, max: 200 }),
  body('html_body').optional().isString(),
  body('text_body').optional().isString(),
  body('template_name').optional().isString(),
  body('variables').optional().isObject(),
  body('recipient_name').optional().isString().isLength({ max: 100 }),
  body('from_email').optional().isEmail(),
  body('from_name').optional().isString().isLength({ max: 100 })
], checkValidation, async (req, res) => {
  try {
    const result = await emailService.sendEmail(req.body);
    
    res.json({
      success: true,
      data: result,
      message: 'Email sent successfully'
    });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({
      error: 'Failed to send email',
      message: error.message
    });
  }
});

// Schedule email campaign
router.post('/campaigns', [
  authenticateToken,
  body('name').isString().isLength({ min: 1, max: 200 }),
  body('template_id').isString().isLength({ min: 1 }),
  body('config_id').optional().isString(),
  body('schedule_type').isIn(['immediate', 'scheduled', 'recurring']),
  body('schedule_datetime').optional().isISO8601(),
  body('schedule_cron').optional().isString(),
  body('recipients').isArray({ min: 1 }),
  body('recipients.*.email').isEmail(),
  body('recipients.*.name').optional().isString().isLength({ max: 100 }),
  body('recipients.*.variables').optional().isObject()
], checkValidation, async (req, res) => {
  try {
    const campaignId = await emailService.scheduleCampaign(req.body);
    
    res.status(201).json({
      success: true,
      data: { campaign_id: campaignId },
      message: 'Email campaign scheduled successfully'
    });
  } catch (error) {
    console.error('Error scheduling campaign:', error);
    res.status(500).json({
      error: 'Failed to schedule email campaign',
      message: error.message
    });
  }
});

// Get campaigns
router.get('/campaigns', [
  authenticateToken,
  query('status').optional().isIn(['pending', 'scheduled', 'running', 'completed', 'failed', 'cancelled']),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
], checkValidation, async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    
    // This would need to be implemented in the service
    const campaigns = await emailService.getCampaigns(status, limit);
    
    res.json({
      success: true,
      data: campaigns
    });
  } catch (error) {
    console.error('Error getting campaigns:', error);
    res.status(500).json({
      error: 'Failed to retrieve campaigns',
      message: error.message
    });
  }
});

// Get campaign details
router.get('/campaigns/:campaignId', [
  authenticateToken
], async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    // This would need to be implemented in the service
    const campaign = await emailService.getCampaign(campaignId);
    
    if (!campaign) {
      return res.status(404).json({
        error: 'Campaign not found'
      });
    }
    
    res.json({
      success: true,
      data: campaign
    });
  } catch (error) {
    console.error('Error getting campaign:', error);
    res.status(500).json({
      error: 'Failed to retrieve campaign',
      message: error.message
    });
  }
});

// Cancel campaign
router.post('/campaigns/:campaignId/cancel', [
  authenticateToken
], async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    await emailService.cancelCampaign(campaignId);
    
    res.json({
      success: true,
      message: 'Campaign cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling campaign:', error);
    res.status(500).json({
      error: 'Failed to cancel campaign',
      message: error.message
    });
  }
});

// Delivery tracking routes

// Get delivery status
router.get('/delivery/:deliveryLogId', [
  authenticateToken
], async (req, res) => {
  try {
    const { deliveryLogId } = req.params;
    
    const status = await emailService.getDeliveryStatus(deliveryLogId);
    
    if (!status) {
      return res.status(404).json({
        error: 'Delivery log not found'
      });
    }
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error getting delivery status:', error);
    res.status(500).json({
      error: 'Failed to retrieve delivery status',
      message: error.message
    });
  }
});

// Track email open (for tracking pixel)
router.get('/track/open/:deliveryLogId', async (req, res) => {
  try {
    const { deliveryLogId } = req.params;
    
    await emailService.trackEmailOpen(deliveryLogId);
    
    // Return 1x1 transparent pixel
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU77yQAAAABJRU5ErkJggg==', 'base64'));
  } catch (error) {
    console.error('Error tracking email open:', error);
    res.status(500).send('Error tracking open');
  }
});

// Track email click
router.get('/track/click/:deliveryLogId', [
  query('url').isURL()
], async (req, res) => {
  try {
    const { deliveryLogId } = req.params;
    const { url } = req.query;
    
    await emailService.trackEmailClick(deliveryLogId);
    
    // Redirect to the original URL
    res.redirect(url);
  } catch (error) {
    console.error('Error tracking email click:', error);
    res.status(500).send('Error tracking click');
  }
});

// Bounce handling route (for webhook)
router.post('/webhook/bounce', [
  body('email').isEmail(),
  body('bounce_type').isIn(['hard', 'soft', 'transient']),
  body('bounce_reason').optional().isString(),
  body('bounce_code').optional().isInt(),
  body('campaign_id').optional().isString(),
  body('delivery_log_id').optional().isString()
], checkValidation, async (req, res) => {
  try {
    await emailService.processBounce(req.body);
    
    res.json({
      success: true,
      message: 'Bounce processed successfully'
    });
  } catch (error) {
    console.error('Error processing bounce:', error);
    res.status(500).json({
      error: 'Failed to process bounce',
      message: error.message
    });
  }
});

// Unsubscribe management

// Unsubscribe email
router.post('/unsubscribe', [
  body('email').isEmail(),
  body('token').isString().isLength({ min: 1 }),
  body('reason').optional().isString().isLength({ max: 500 })
], checkValidation, async (req, res) => {
  try {
    const { email, token, reason } = req.body;
    
    // Verify token (this would need to be implemented in the service)
    const isValidToken = await emailService.verifyUnsubscribeToken(email, token);
    
    if (!isValidToken) {
      return res.status(400).json({
        error: 'Invalid unsubscribe token'
      });
    }
    
    await emailService.unsubscribeEmail(email, reason);
    
    res.json({
      success: true,
      message: 'Email unsubscribed successfully'
    });
  } catch (error) {
    console.error('Error unsubscribing email:', error);
    res.status(500).json({
      error: 'Failed to unsubscribe email',
      message: error.message
    });
  }
});

// Get unsubscribe status
router.get('/unsubscribe/status/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    const isUnsubscribed = await emailService.isUnsubscribed(email);
    
    res.json({
      success: true,
      data: {
        email,
        is_unsubscribed: isUnsubscribed
      }
    });
  } catch (error) {
    console.error('Error checking unsubscribe status:', error);
    res.status(500).json({
      error: 'Failed to check unsubscribe status',
      message: error.message
    });
  }
});

// Analytics routes

// Get email analytics
router.get('/analytics', [
  authenticateToken,
  query('campaign_id').optional().isString(),
  query('period').optional().isInt({ min: 1, max: 365 }).toInt()
], checkValidation, async (req, res) => {
  try {
    const { campaign_id, period = 30 } = req.query;
    
    const analytics = await emailService.getAnalytics(campaign_id, period);
    
    res.json({
      success: true,
      data: analytics,
      period_days: period
    });
  } catch (error) {
    console.error('Error getting email analytics:', error);
    res.status(500).json({
      error: 'Failed to retrieve email analytics',
      message: error.message
    });
  }
});

// Get delivery logs
router.get('/delivery-logs', [
  authenticateToken,
  query('campaign_id').optional().isString(),
  query('status').optional().isIn(['pending', 'sent', 'delivered', 'bounced', 'failed', 'opened', 'clicked']),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
], checkValidation, async (req, res) => {
  try {
    const { campaign_id, status, limit = 50 } = req.query;
    
    // This would need to be implemented in the service
    const logs = await emailService.getDeliveryLogs(campaign_id, status, limit);
    
    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('Error getting delivery logs:', error);
    res.status(500).json({
      error: 'Failed to retrieve delivery logs',
      message: error.message
    });
  }
});

// Get bounce reports
router.get('/bounces', [
  authenticateToken,
  query('campaign_id').optional().isString(),
  query('bounce_type').optional().isIn(['hard', 'soft', 'transient']),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
], checkValidation, async (req, res) => {
  try {
    const { campaign_id, bounce_type, limit = 50 } = req.query;
    
    // This would need to be implemented in the service
    const bounces = await emailService.getBounces(campaign_id, bounce_type, limit);
    
    res.json({
      success: true,
      data: bounces
    });
  } catch (error) {
    console.error('Error getting bounce reports:', error);
    res.status(500).json({
      error: 'Failed to retrieve bounce reports',
      message: error.message
    });
  }
});

// Test email configuration
router.post('/test-config', [
  authenticateToken,
  body('config_id').isString().isLength({ min: 1 }),
  body('test_email').isEmail()
], checkValidation, async (req, res) => {
  try {
    const { config_id, test_email } = req.body;
    
    // This would need to be implemented in the service
    const result = await emailService.testConfig(config_id, test_email);
    
    res.json({
      success: true,
      data: result,
      message: 'Test email sent successfully'
    });
  } catch (error) {
    console.error('Error testing email config:', error);
    res.status(500).json({
      error: 'Failed to test email configuration',
      message: error.message
    });
  }
});

// Preview email template
router.post('/preview-template', [
  authenticateToken,
  body('template_name').isString(),
  body('variables').optional().isObject()
], checkValidation, async (req, res) => {
  try {
    const { template_name, variables = {} } = req.body;
    
    // This would need to be implemented in the service
    const preview = await emailService.previewTemplate(template_name, variables);
    
    res.json({
      success: true,
      data: preview
    });
  } catch (error) {
    console.error('Error previewing template:', error);
    res.status(500).json({
      error: 'Failed to preview template',
      message: error.message
    });
  }
});

module.exports = router;
