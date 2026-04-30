const EventEmitter = require('events');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const nodemailer = require('nodemailer');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

class EmailService extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.transporter = null;
    this.scheduledJobs = new Map();
    this.deliveryQueue = [];
    this.isProcessingQueue = false;
    this.templates = new Map();
    
    this.initializeService();
  }

  getDatabase() {
    if (!this.db) {
      this.db = new sqlite3.Database(DB_PATH);
    }
    return this.db;
  }

  async initializeService() {
    try {
      await this.initializeTables();
      await this.initializeTransporter();
      await this.loadTemplates();
      await this.startQueueProcessor();
      await this.startScheduledEmailProcessor();
      
      console.log('Email Service initialized successfully');
    } catch (error) {
      console.error('Error initializing Email Service:', error);
    }
  }

  // Initialize database tables
  async initializeTables() {
    const db = this.getDatabase();
    
    const tables = [
      // Email configurations
      `CREATE TABLE IF NOT EXISTS email_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        secure BOOLEAN NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        from_email TEXT NOT NULL,
        from_name TEXT,
        is_default BOOLEAN DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Email templates
      `CREATE TABLE IF NOT EXISTS email_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        subject TEXT NOT NULL,
        html_body TEXT NOT NULL,
        text_body TEXT,
        variables TEXT,
        category TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Email campaigns/scheduled emails
      `CREATE TABLE IF NOT EXISTS email_campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        template_id TEXT,
        config_id TEXT,
        schedule_type TEXT NOT NULL, -- immediate, scheduled, recurring
        schedule_datetime DATETIME,
        schedule_cron TEXT,
        recipients TEXT NOT NULL, -- JSON array of recipient objects
        status TEXT DEFAULT 'pending', -- pending, scheduled, running, completed, failed, cancelled
        total_recipients INTEGER DEFAULT 0,
        sent_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES email_templates (id),
        FOREIGN KEY (config_id) REFERENCES email_configs (id)
      )`,
      
      // Email delivery logs
      `CREATE TABLE IF NOT EXISTS email_delivery_logs (
        id TEXT PRIMARY KEY,
        campaign_id TEXT,
        template_id TEXT,
        config_id TEXT,
        recipient_email TEXT NOT NULL,
        recipient_name TEXT,
        subject TEXT NOT NULL,
        message_id TEXT,
        status TEXT NOT NULL, -- pending, sent, delivered, bounced, failed, opened, clicked
        error_message TEXT,
        delivery_attempts INTEGER DEFAULT 0,
        sent_at DATETIME,
        delivered_at DATETIME,
        bounced_at DATETIME,
        opened_at DATETIME,
        clicked_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES email_campaigns (id),
        FOREIGN KEY (template_id) REFERENCES email_templates (id),
        FOREIGN KEY (config_id) REFERENCES email_configs (id)
      )`,
      
      // Bounce tracking
      `CREATE TABLE IF NOT EXISTS email_bounces (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        bounce_type TEXT NOT NULL, -- hard, soft, transient
        bounce_reason TEXT,
        bounce_code INTEGER,
        campaign_id TEXT,
        delivery_log_id TEXT,
        is_processed BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES email_campaigns (id),
        FOREIGN KEY (delivery_log_id) REFERENCES email_delivery_logs (id)
      )`,
      
      // Unsubscribe management
      `CREATE TABLE IF NOT EXISTS email_unsubscribes (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        user_id INTEGER,
        unsubscribe_token TEXT NOT NULL UNIQUE,
        reason TEXT,
        campaign_id TEXT,
        unsubscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES email_campaigns (id),
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,
      
      // Email analytics
      `CREATE TABLE IF NOT EXISTS email_analytics (
        id TEXT PRIMARY KEY,
        campaign_id TEXT,
        template_id TEXT,
        date DATE NOT NULL,
        total_sent INTEGER DEFAULT 0,
        total_delivered INTEGER DEFAULT 0,
        total_opened INTEGER DEFAULT 0,
        total_clicked INTEGER DEFAULT 0,
        total_bounced INTEGER DEFAULT 0,
        total_failed INTEGER DEFAULT 0,
        open_rate REAL DEFAULT 0,
        click_rate REAL DEFAULT 0,
        delivery_rate REAL DEFAULT 0,
        bounce_rate REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES email_campaigns (id),
        FOREIGN KEY (template_id) REFERENCES email_templates (id)
      )`
    ];

    for (const table of tables) {
      await new Promise((resolve, reject) => {
        db.run(table, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // Initialize SMTP transporter
  async initializeTransporter() {
    try {
      const defaultConfig = await this.getDefaultConfig();
      if (defaultConfig) {
        this.transporter = nodemailer.createTransport({
          host: defaultConfig.host,
          port: defaultConfig.port,
          secure: defaultConfig.secure,
          auth: {
            user: defaultConfig.username,
            pass: defaultConfig.password
          }
        });
        
        // Verify connection
        await this.transporter.verify();
        console.log('Email transporter connected successfully');
      }
    } catch (error) {
      console.error('Error initializing email transporter:', error);
    }
  }

  // Get default SMTP configuration
  async getDefaultConfig() {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM email_configs WHERE is_default = 1 AND is_active = 1';
      
      db.get(query, [], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  // Create SMTP configuration
  async createConfig(config) {
    const db = this.getDatabase();
    
    try {
      const configId = uuidv4();
      
      // If this is set as default, unset other defaults
      if (config.is_default) {
        await new Promise((resolve, reject) => {
          const query = 'UPDATE email_configs SET is_default = 0 WHERE is_default = 1';
          db.run(query, [], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
      
      await new Promise((resolve, reject) => {
        const query = `
          INSERT INTO email_configs 
          (id, name, host, port, secure, username, password, from_email, from_name, is_default, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          configId,
          config.name,
          config.host,
          config.port,
          config.secure || false,
          config.username,
          config.password,
          config.from_email,
          config.from_name || null,
          config.is_default || false,
          config.is_active !== false
        ], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      // Reinitialize transporter if this is the new default
      if (config.is_default) {
        await this.initializeTransporter();
      }

      return configId;
    } catch (error) {
      console.error('Error creating email config:', error);
      throw error;
    }
  }

  // Create email template
  async createTemplate(template) {
    const db = this.getDatabase();
    
    try {
      const templateId = uuidv4();
      
      await new Promise((resolve, reject) => {
        const query = `
          INSERT INTO email_templates 
          (id, name, subject, html_body, text_body, variables, category, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          templateId,
          template.name,
          template.subject,
          template.html_body,
          template.text_body || null,
          JSON.stringify(template.variables || []),
          template.category || null,
          template.is_active !== false
        ], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      // Load template into memory
      await this.loadTemplates();
      
      return templateId;
    } catch (error) {
      console.error('Error creating email template:', error);
      throw error;
    }
  }

  // Load templates into memory
  async loadTemplates() {
    const db = this.getDatabase();
    
    try {
      const templates = await new Promise((resolve, reject) => {
        const query = 'SELECT * FROM email_templates WHERE is_active = 1';
        
        db.all(query, [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      this.templates.clear();
      templates.forEach(template => {
        this.templates.set(template.name, {
          id: template.id,
          subject: template.subject,
          html_body: template.html_body,
          text_body: template.text_body,
          variables: JSON.parse(template.variables || '[]')
        });
      });

      console.log(`Loaded ${templates.length} email templates`);
    } catch (error) {
      console.error('Error loading templates:', error);
    }
  }

  // Send immediate email
  async sendEmail(options) {
    try {
      const emailId = uuidv4();
      
      // Get template if specified
      let subject = options.subject;
      let htmlBody = options.html_body;
      let textBody = options.text_body;
      
      if (options.template_name) {
        const template = this.templates.get(options.template_name);
        if (!template) {
          throw new Error(`Template not found: ${options.template_name}`);
        }
        
        subject = this.processTemplate(template.subject, options.variables || {});
        htmlBody = this.processTemplate(template.html_body, options.variables || {});
        textBody = template.text_body ? this.processTemplate(template.text_body, options.variables || {}) : null;
      }

      // Check if recipient is unsubscribed
      if (await this.isUnsubscribed(options.to)) {
        throw new Error('Recipient has unsubscribed from emails');
      }

      // Create delivery log
      const deliveryLogId = await this.createDeliveryLog({
        id: emailId,
        recipient_email: options.to,
        recipient_name: options.recipient_name,
        subject: subject,
        template_id: options.template_id,
        config_id: options.config_id,
        campaign_id: options.campaign_id
      });

      // Send email
      const mailOptions = {
        from: `${options.from_name || process.env.SMTP_FROM_NAME || 'Healthcare Platform'} <${options.from_email || process.env.SMTP_FROM_EMAIL}>`,
        to: options.to,
        subject: subject,
        html: htmlBody,
        text: textBody,
        headers: {
          'X-Email-ID': emailId,
          'X-Campaign-ID': options.campaign_id || '',
          'List-Unsubscribe': `<${process.env.API_URL}/api/email/unsubscribe?email=${encodeURIComponent(options.to)}&token=${await this.getUnsubscribeToken(options.to)}>`
        }
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      // Update delivery log
      await this.updateDeliveryLog(deliveryLogId, {
        message_id: result.messageId,
        status: 'sent',
        sent_at: new Date().toISOString()
      });

      this.emit('email:sent', {
        emailId,
        to: options.to,
        messageId: result.messageId
      });

      return {
        success: true,
        email_id: emailId,
        message_id: result.messageId
      };
    } catch (error) {
      console.error('Error sending email:', error);
      
      // Update delivery log with error
      if (options.delivery_log_id) {
        await this.updateDeliveryLog(options.delivery_log_id, {
          status: 'failed',
          error_message: error.message,
          delivery_attempts: 1
        });
      }
      
      throw error;
    }
  }

  // Schedule email campaign
  async scheduleCampaign(campaign) {
    const db = this.getDatabase();
    
    try {
      const campaignId = uuidv4();
      
      await new Promise((resolve, reject) => {
        const query = `
          INSERT INTO email_campaigns 
          (id, name, template_id, config_id, schedule_type, schedule_datetime, schedule_cron, recipients, total_recipients, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          campaignId,
          campaign.name,
          campaign.template_id,
          campaign.config_id,
          campaign.schedule_type,
          campaign.schedule_datetime || null,
          campaign.schedule_cron || null,
          JSON.stringify(campaign.recipients),
          campaign.recipients.length,
          'scheduled'
        ], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      // Schedule the campaign
      if (campaign.schedule_type === 'scheduled' && campaign.schedule_datetime) {
        this.scheduleSingleCampaign(campaignId, new Date(campaign.schedule_datetime));
      } else if (campaign.schedule_type === 'recurring' && campaign.schedule_cron) {
        this.scheduleRecurringCampaign(campaignId, campaign.schedule_cron);
      }

      return campaignId;
    } catch (error) {
      console.error('Error scheduling campaign:', error);
      throw error;
    }
  }

  // Schedule single campaign
  scheduleSingleCampaign(campaignId, scheduleDate) {
    const delay = scheduleDate.getTime() - Date.now();
    
    if (delay > 0) {
      const timeoutId = setTimeout(() => {
        this.executeCampaign(campaignId);
      }, delay);
      
      this.scheduledJobs.set(campaignId, { type: 'timeout', id: timeoutId });
    } else {
      // Execute immediately if schedule date is in the past
      this.executeCampaign(campaignId);
    }
  }

  // Schedule recurring campaign
  scheduleRecurringCampaign(campaignId, cronExpression) {
    const task = cron.schedule(cronExpression, () => {
      this.executeCampaign(campaignId);
    }, {
      scheduled: false,
      timezone: 'UTC'
    });
    
    task.start();
    this.scheduledJobs.set(campaignId, { type: 'cron', task: task });
  }

  // Execute campaign
  async executeCampaign(campaignId) {
    const db = this.getDatabase();
    
    try {
      // Get campaign details
      const campaign = await new Promise((resolve, reject) => {
        const query = 'SELECT * FROM email_campaigns WHERE id = ?';
        db.get(query, [campaignId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!campaign || campaign.status !== 'scheduled') {
        return;
      }

      // Update campaign status
      await new Promise((resolve, reject) => {
        const query = 'UPDATE email_campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
        db.run(query, ['running', campaignId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const recipients = JSON.parse(campaign.recipients);
      
      // Add emails to queue
      for (const recipient of recipients) {
        this.deliveryQueue.push({
          campaignId: campaignId,
          templateId: campaign.template_id,
          configId: campaign.config_id,
          recipient: recipient
        });
      }

      this.emit('campaign:started', { campaignId, recipientCount: recipients.length });
    } catch (error) {
      console.error('Error executing campaign:', error);
      
      // Update campaign status to failed
      await new Promise((resolve, reject) => {
        const query = 'UPDATE email_campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
        db.run(query, ['failed', campaignId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // Process delivery queue
  async startQueueProcessor() {
    setInterval(async () => {
      if (!this.isProcessingQueue && this.deliveryQueue.length > 0) {
        this.isProcessingQueue = true;
        
        try {
          await this.processQueue();
        } catch (error) {
          console.error('Error processing delivery queue:', error);
        } finally {
          this.isProcessingQueue = false;
        }
      }
    }, 1000); // Process every second
  }

  async processQueue() {
    const batchSize = 10; // Process 10 emails at a time
    const batch = this.deliveryQueue.splice(0, batchSize);
    
    for (const item of batch) {
      try {
        await this.sendQueuedEmail(item);
      } catch (error) {
        console.error('Error sending queued email:', error);
      }
    }
  }

  async sendQueuedEmail(item) {
    const db = this.getDatabase();
    
    try {
      // Get template details
      const template = await new Promise((resolve, reject) => {
        const query = 'SELECT * FROM email_templates WHERE id = ?';
        db.get(query, [item.templateId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      // Create delivery log
      const deliveryLogId = await this.createDeliveryLog({
        recipient_email: item.recipient.email,
        recipient_name: item.recipient.name,
        subject: template.subject,
        template_id: item.templateId,
        config_id: item.configId,
        campaign_id: item.campaignId
      });

      // Send email
      await this.sendEmail({
        to: item.recipient.email,
        recipient_name: item.recipient.name,
        template_name: template.name,
        variables: item.recipient.variables || {},
        template_id: item.templateId,
        config_id: item.configId,
        campaign_id: item.campaignId,
        delivery_log_id: deliveryLogId
      });

      // Update campaign counters
      await new Promise((resolve, reject) => {
        const query = 'UPDATE email_campaigns SET sent_count = sent_count + 1 WHERE id = ?';
        db.run(query, [item.campaignId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

    } catch (error) {
      console.error('Error sending queued email:', error);
      
      // Update campaign failed counter
      await new Promise((resolve, reject) => {
        const query = 'UPDATE email_campaigns SET failed_count = failed_count + 1 WHERE id = ?';
        db.run(query, [item.campaignId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // Create delivery log
  async createDeliveryLog(logData) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO email_delivery_logs 
        (id, campaign_id, template_id, config_id, recipient_email, recipient_name, subject, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        logData.id || uuidv4(),
        logData.campaign_id || null,
        logData.template_id || null,
        logData.config_id || null,
        logData.recipient_email,
        logData.recipient_name || null,
        logData.subject,
        'pending'
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  // Update delivery log
  async updateDeliveryLog(logId, updates) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      const values = Object.values(updates);
      
      const query = `UPDATE email_delivery_logs SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      values.push(logId);
      
      db.run(query, values, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Process template variables
  processTemplate(template, variables) {
    let processed = template;
    
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      processed = processed.replace(regex, value || '');
    });
    
    return processed;
  }

  // Check if email is unsubscribed
  async isUnsubscribed(email) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT id FROM email_unsubscribes WHERE email = ?';
      db.get(query, [email], (err, row) => {
        if (err) reject(err);
        else resolve(!!row);
      });
    });
  }

  // Get unsubscribe token
  async getUnsubscribeToken(email) {
    const db = this.getDatabase();
    
    try {
      let unsubscribe = await new Promise((resolve, reject) => {
        const query = 'SELECT unsubscribe_token FROM email_unsubscribes WHERE email = ?';
        db.get(query, [email], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!unsubscribe) {
        const token = uuidv4();
        await new Promise((resolve, reject) => {
          const query = 'INSERT INTO email_unsubscribes (email, unsubscribe_token) VALUES (?, ?)';
          db.run(query, [email, token], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        return token;
      }

      return unsubscribe.unsubscribe_token;
    } catch (error) {
      console.error('Error getting unsubscribe token:', error);
      return uuidv4();
    }
  }

  // Process bounce
  async processBounce(bounceData) {
    const db = this.getDatabase();
    
    try {
      const bounceId = uuidv4();
      
      // Create bounce record
      await new Promise((resolve, reject) => {
        const query = `
          INSERT INTO email_bounces 
          (id, email, bounce_type, bounce_reason, bounce_code, campaign_id, delivery_log_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(query, [
          bounceId,
          bounceData.email,
          bounceData.bounce_type,
          bounceData.bounce_reason || null,
          bounceData.bounce_code || null,
          bounceData.campaign_id || null,
          bounceData.delivery_log_id || null
        ], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      // Update delivery log
      if (bounceData.delivery_log_id) {
        await this.updateDeliveryLog(bounceData.delivery_log_id, {
          status: 'bounced',
          bounced_at: new Date().toISOString()
        });
      }

      // For hard bounces, unsubscribe the email
      if (bounceData.bounce_type === 'hard') {
        await this.unsubscribeEmail(bounceData.email, 'Hard bounce - email permanently undeliverable', bounceData.campaign_id);
      }

      this.emit('email:bounced', {
        bounceId,
        email: bounceData.email,
        bounceType: bounceData.bounce_type
      });

    } catch (error) {
      console.error('Error processing bounce:', error);
    }
  }

  // Unsubscribe email
  async unsubscribeEmail(email, reason = null, campaignId = null) {
    const db = this.getDatabase();
    
    try {
      const unsubscribeId = uuidv4();
      const token = await this.getUnsubscribeToken(email);
      
      await new Promise((resolve, reject) => {
        const query = `
          INSERT OR REPLACE INTO email_unsubscribes 
          (id, email, unsubscribe_token, reason, campaign_id, unsubscribed_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        
        db.run(query, [
          unsubscribeId,
          email,
          token,
          reason,
          campaignId
        ], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });

      this.emit('email:unsubscribed', {
        email,
        reason,
        campaignId
      });

    } catch (error) {
      console.error('Error unsubscribing email:', error);
    }
  }

  // Track email open
  async trackEmailOpen(deliveryLogId) {
    try {
      await this.updateDeliveryLog(deliveryLogId, {
        status: 'opened',
        opened_at: new Date().toISOString()
      });

      this.emit('email:opened', { deliveryLogId });
    } catch (error) {
      console.error('Error tracking email open:', error);
    }
  }

  // Track email click
  async trackEmailClick(deliveryLogId) {
    try {
      await this.updateDeliveryLog(deliveryLogId, {
        status: 'clicked',
        clicked_at: new Date().toISOString()
      });

      this.emit('email:clicked', { deliveryLogId });
    } catch (error) {
      console.error('Error tracking email click:', error);
    }
  }

  // Get email analytics
  async getAnalytics(campaignId = null, period = 30) {
    const db = this.getDatabase();
    
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - period);
      
      let query = `
        SELECT 
          c.id as campaign_id,
          c.name as campaign_name,
          COUNT(dl.id) as total_sent,
          COUNT(CASE WHEN dl.status = 'delivered' THEN 1 END) as total_delivered,
          COUNT(CASE WHEN dl.status = 'opened' THEN 1 END) as total_opened,
          COUNT(CASE WHEN dl.status = 'clicked' THEN 1 END) as total_clicked,
          COUNT(CASE WHEN dl.status = 'bounced' THEN 1 END) as total_bounced,
          COUNT(CASE WHEN dl.status = 'failed' THEN 1 END) as total_failed
        FROM email_campaigns c
        LEFT JOIN email_delivery_logs dl ON c.id = dl.campaign_id
        WHERE c.created_at >= ?
      `;
      
      const params = [cutoffDate.toISOString()];
      
      if (campaignId) {
        query += ' AND c.id = ?';
        params.push(campaignId);
      }
      
      query += ' GROUP BY c.id, c.name ORDER BY c.created_at DESC';
      
      const results = await new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Calculate rates
      return results.map(row => ({
        ...row,
        delivery_rate: row.total_sent > 0 ? (row.total_delivered / row.total_sent) * 100 : 0,
        open_rate: row.total_delivered > 0 ? (row.total_opened / row.total_delivered) * 100 : 0,
        click_rate: row.total_opened > 0 ? (row.total_clicked / row.total_opened) * 100 : 0,
        bounce_rate: row.total_sent > 0 ? (row.total_bounced / row.total_sent) * 100 : 0,
        failure_rate: row.total_sent > 0 ? (row.total_failed / row.total_sent) * 100 : 0
      }));

    } catch (error) {
      console.error('Error getting email analytics:', error);
      throw error;
    }
  }

  // Get delivery status
  async getDeliveryStatus(deliveryLogId) {
    const db = this.getDatabase();
    
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM email_delivery_logs WHERE id = ?';
      db.get(query, [deliveryLogId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  // Start scheduled email processor
  async startScheduledEmailProcessor() {
    // Check for scheduled campaigns every minute
    setInterval(async () => {
      try {
        await this.checkScheduledCampaigns();
      } catch (error) {
        console.error('Error checking scheduled campaigns:', error);
      }
    }, 60000);
  }

  // Check for scheduled campaigns
  async checkScheduledCampaigns() {
    const db = this.getDatabase();
    
    try {
      const campaigns = await new Promise((resolve, reject) => {
        const query = `
          SELECT * FROM email_campaigns 
          WHERE status = 'scheduled' 
          AND schedule_type = 'scheduled' 
          AND schedule_datetime <= datetime('now')
        `;
        
        db.all(query, [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      for (const campaign of campaigns) {
        await this.executeCampaign(campaign.id);
      }
    } catch (error) {
      console.error('Error checking scheduled campaigns:', error);
    }
  }

  // Cancel campaign
  async cancelCampaign(campaignId) {
    const db = this.getDatabase();
    
    try {
      // Update campaign status
      await new Promise((resolve, reject) => {
        const query = 'UPDATE email_campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
        db.run(query, ['cancelled', campaignId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Cancel scheduled job
      const job = this.scheduledJobs.get(campaignId);
      if (job) {
        if (job.type === 'timeout') {
          clearTimeout(job.id);
        } else if (job.type === 'cron') {
          job.task.stop();
        }
        this.scheduledJobs.delete(campaignId);
      }

      this.emit('campaign:cancelled', { campaignId });
    } catch (error) {
      console.error('Error cancelling campaign:', error);
      throw error;
    }
  }

  // Close service
  close() {
    // Cancel all scheduled jobs
    this.scheduledJobs.forEach((job, campaignId) => {
      if (job.type === 'timeout') {
        clearTimeout(job.id);
      } else if (job.type === 'cron') {
        job.task.stop();
      }
    });
    this.scheduledJobs.clear();

    // Close database connection
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    console.log('Email Service closed');
  }
}

module.exports = new EmailService();
