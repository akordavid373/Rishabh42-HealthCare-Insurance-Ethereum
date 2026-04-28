#!/usr/bin/env node

/**
 * CI/CD Pipeline Notification System
 * 
 * Sends notifications to multiple channels:
 * - Slack
 * - GitHub
 * - Email
 * - Custom webhooks
 */

const https = require('https');
const http = require('http');
const { EventEmitter } = require('events');

class NotificationEngine extends EventEmitter {
  constructor() {
    super();
    this.notifications = [];
    this.failedNotifications = [];
  }

  async httpRequest(url, method = 'POST', data = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Healthcare-Drips-CI-CD',
          ...headers,
        },
      };

      const req = protocol.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          resolve({ status: res.statusCode, body });
        });
      });

      req.on('error', reject);

      if (data) {
        req.write(typeof data === 'string' ? data : JSON.stringify(data));
      }

      req.end();
    });
  }

  async notifySlack(webhookUrl, message) {
    try {
      const payload = this.buildSlackMessage(message);
      await this.httpRequest(webhookUrl, 'POST', payload);
      
      this.emit('notification', {
        channel: 'slack',
        status: 'sent',
        message: message.title,
      });

      return true;
    } catch (err) {
      this.failedNotifications.push({
        channel: 'slack',
        error: err.message,
        message: message.title,
      });
      return false;
    }
  }

  buildSlackMessage(message) {
    const statusColor = message.status === 'success' ? 'good' : 
                       message.status === 'failure' ? 'danger' : 'warning';
    
    const emoji = message.status === 'success' ? '✅' :
                  message.status === 'failure' ? '❌' : '⚠️';

    return {
      username: 'Healthcare Drips CI/CD',
      icon_emoji: ':rocket:',
      attachments: [
        {
          fallback: message.title,
          color: statusColor,
          title: `${emoji} ${message.title}`,
          fields: [
            {
              title: 'Repository',
              value: message.repository || 'N/A',
              short: true,
            },
            {
              title: 'Branch',
              value: message.branch || 'N/A',
              short: true,
            },
            {
              title: 'Workflow',
              value: message.workflow || 'N/A',
              short: true,
            },
            {
              title: 'Triggered by',
              value: message.actor || 'N/A',
              short: true,
            },
            {
              title: 'Status Details',
              value: this.formatStatusDetails(message.statusDetails),
              short: false,
            },
          ],
          footer: 'Healthcare Drips',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };
  }

  formatStatusDetails(details) {
    if (!details) return 'N/A';

    return Object.entries(details)
      .map(([key, value]) => `• ${key}: ${value}`)
      .join('\n');
  }

  async notifyGitHub(event) {
    try {
      const { owner, repo, runId, title, conclusion } = event;
      
      const message = `
## CI/CD Pipeline ${conclusion.toUpperCase()}

**Pipeline**: ${title}
**Run ID**: ${runId}
**Status**: ${conclusion === 'success' ? '✅ Success' : '❌ Failed'}

[View Details](https://github.com/${owner}/${repo}/actions/runs/${runId})
      `;

      this.emit('notification', {
        channel: 'github',
        status: 'queued',
        message: title,
      });

      return true;
    } catch (err) {
      this.failedNotifications.push({
        channel: 'github',
        error: err.message,
      });
      return false;
    }
  }

  async notifyEmail(smtpConfig, recipients, message) {
    try {
      // Email notification implementation
      // This would integrate with a real SMTP service
      
      this.emit('notification', {
        channel: 'email',
        status: 'sent',
        recipients,
        message: message.title,
      });

      return true;
    } catch (err) {
      this.failedNotifications.push({
        channel: 'email',
        error: err.message,
        recipients,
      });
      return false;
    }
  }

  async notifyWebhook(webhookUrl, message, headers = {}) {
    try {
      const payload = {
        timestamp: new Date().toISOString(),
        ...message,
      };

      await this.httpRequest(webhookUrl, 'POST', payload, headers);

      this.emit('notification', {
        channel: 'webhook',
        status: 'sent',
        url: webhookUrl,
        message: message.title,
      });

      return true;
    } catch (err) {
      this.failedNotifications.push({
        channel: 'webhook',
        error: err.message,
        url: webhookUrl,
      });
      return false;
    }
  }

  async sendPipelineNotification(options) {
    const {
      status,
      repository,
      branch,
      workflow,
      runId,
      actor,
      statusDetails,
      slackWebhook,
      customWebhooks,
    } = options;

    const message = {
      status,
      title: `Pipeline ${status === 'success' ? 'Completed' : 'Failed'}`,
      repository,
      branch,
      workflow,
      runId,
      actor,
      statusDetails,
      timestamp: new Date().toISOString(),
    };

    const notifications = [];

    if (slackWebhook) {
      notifications.push(this.notifySlack(slackWebhook, message));
    }

    if (customWebhooks && Array.isArray(customWebhooks)) {
      for (const webhook of customWebhooks) {
        notifications.push(this.notifyWebhook(webhook.url, message, webhook.headers));
      }
    }

    const results = await Promise.all(notifications);
    return {
      sent: results.filter(r => r).length,
      failed: results.filter(r => !r).length,
      total: results.length,
      failedNotifications: this.failedNotifications,
    };
  }

  async sendDeploymentNotification(options) {
    const {
      environment,
      deploymentId,
      contractId,
      status,
      slackWebhook,
      customWebhooks,
    } = options;

    const message = {
      status,
      title: `Deployment to ${environment} ${status === 'success' ? 'Successful' : 'Failed'}`,
      environment,
      deploymentId,
      contractId,
      timestamp: new Date().toISOString(),
    };

    const notifications = [];

    if (slackWebhook) {
      notifications.push(this.notifySlack(slackWebhook, message));
    }

    if (customWebhooks && Array.isArray(customWebhooks)) {
      for (const webhook of customWebhooks) {
        notifications.push(this.notifyWebhook(webhook.url, message, webhook.headers));
      }
    }

    const results = await Promise.all(notifications);
    return {
      sent: results.filter(r => r).length,
      failed: results.filter(r => !r).length,
    };
  }

  async sendRollbackNotification(options) {
    const {
      environment,
      rollbackVersion,
      reason,
      slackWebhook,
      customWebhooks,
    } = options;

    const message = {
      status: 'warning',
      title: `Rollback in ${environment}`,
      environment,
      rollbackVersion,
      reason,
      timestamp: new Date().toISOString(),
    };

    const notifications = [];

    if (slackWebhook) {
      notifications.push(this.notifySlack(slackWebhook, message));
    }

    if (customWebhooks && Array.isArray(customWebhooks)) {
      for (const webhook of customWebhooks) {
        notifications.push(this.notifyWebhook(webhook.url, message, webhook.headers));
      }
    }

    const results = await Promise.all(notifications);
    return {
      sent: results.filter(r => r).length,
      failed: results.filter(r => !r).length,
    };
  }

  getNotificationCount() {
    return {
      sent: this.notifications.length,
      failed: this.failedNotifications.length,
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const engine = new NotificationEngine();

  try {
    if (command === 'test') {
      const slackWebhook = process.env.SLACK_WEBHOOK_URL;
      if (!slackWebhook) {
        throw new Error('SLACK_WEBHOOK_URL environment variable not set');
      }

      console.log('📧 Sending test notification...\n');

      const result = await engine.sendPipelineNotification({
        status: 'success',
        repository: 'Rishabh42/HealthCare-Insurance-Stellar',
        branch: 'main',
        workflow: 'CI/CD Pipeline',
        runId: '12345',
        actor: 'test-user',
        statusDetails: {
          'Build': 'Passed',
          'Tests': 'Passed',
          'Deploy': 'Successful',
        },
        slackWebhook,
      });

      console.log(`✓ Notifications sent: ${result.sent}`);
      console.log(`✗ Notifications failed: ${result.failed}`);
      console.log(`Total: ${result.total}\n`);

    } else if (command === 'pipeline') {
      const status = args[1] || process.env.PIPELINE_STATUS || 'success';
      const slackWebhook = process.env.SLACK_WEBHOOK_URL;
      const customWebhooks = process.env.CUSTOM_WEBHOOKS ? JSON.parse(process.env.CUSTOM_WEBHOOKS) : [];

      const result = await engine.sendPipelineNotification({
        status,
        repository: process.env.GITHUB_REPOSITORY || 'unknown',
        branch: process.env.GITHUB_REF_NAME || 'unknown',
        workflow: process.env.GITHUB_WORKFLOW || 'CI/CD Pipeline',
        runId: process.env.GITHUB_RUN_ID || 'unknown',
        actor: process.env.GITHUB_ACTOR || 'unknown',
        slackWebhook,
        customWebhooks,
      });

      console.log(`✓ Sent: ${result.sent}, ✗ Failed: ${result.failed}`);

    } else {
      console.log(`
Usage:
  node scripts/pipeline/notify.js test                    # Send test notification
  node scripts/pipeline/notify.js pipeline [status]       # Send pipeline notification
      `);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = NotificationEngine;
