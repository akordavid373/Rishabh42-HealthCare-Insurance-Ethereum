const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH    = process.env.DB_PATH || path.join(__dirname, '../../database/healthcare.db');
const CACHE_TTL  = 5 * 60 * 1000; // 5 minutes

/* ── In-memory template cache ───────────────────────────────────────────── */
const templateCache = new Map(); // templateId → { template, loadedAt }

function isCacheValid(entry) {
  return entry && Date.now() - entry.loadedAt < CACHE_TTL;
}

/* ── Simple {{variable}} renderer ───────────────────────────────────────── */
function interpolate(str, vars = {}) {
  if (!str) return '';

  // {{#condition}}...{{/condition}} — show/hide blocks
  str = str.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    return vars[key] ? content.trim() : '';
  });

  // {{variable}} — substitute values
  str = str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return vars[key] !== undefined ? String(vars[key]) : '';
  });

  return str.trim();
}

/**
 * Strip HTML tags — used for SMS/push where plain text is required.
 */
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Truncate text to maxLen characters with ellipsis suffix.
 */
function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

/**
 * TemplateEngine — renders notification_templates rows into channel-specific content.
 *
 * Usage:
 *   const content = await TemplateEngine.render(templateId, variables, channels);
 *   const smsContent = await TemplateEngine.renderForChannel(templateId, variables, 'sms');
 */
const TemplateEngine = {

  /* ─── Load template from DB (cached) ──────────────────────────────────── */
  async loadTemplate(templateId) {
    const cached = templateCache.get(templateId);
    if (isCacheValid(cached)) return cached.template;

    const db = new sqlite3.Database(DB_PATH);
    const template = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM notification_templates WHERE id = ? AND is_active = 1', [templateId], (err, row) => {
        db.close();
        if (err) reject(err);
        else resolve(row || null);
      });
    });

    if (template) {
      templateCache.set(templateId, { template, loadedAt: Date.now() });
    }

    return template;
  },

  /* ─── Load template by name ────────────────────────────────────────────── */
  async loadTemplateByName(name) {
    const db = new sqlite3.Database(DB_PATH);
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM notification_templates WHERE name = ? AND is_active = 1', [name], (err, row) => {
        db.close();
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  },

  /* ─── Render for all requested channels ────────────────────────────────── */
  async render(templateId, variables = {}, channels = ['in_app']) {
    const template = await this.loadTemplate(templateId);
    if (!template) return { subject: '', body: '' };

    const result = {
      subject: interpolate(template.subject_template, variables),
      body:    interpolate(template.body_template,    variables),
    };

    if (channels.includes('push')) {
      result.pushTitle = interpolate(template.push_title_template || template.subject_template, variables);
      result.pushBody  = interpolate(template.push_body_template  || template.body_template,   variables);
    }

    if (channels.includes('sms')) {
      result.smsBody = truncate(
        stripHtml(interpolate(template.sms_template || template.body_template, variables)),
        160
      );
    }

    return result;
  },

  /* ─── Render for a single specific channel ──────────────────────────────── */
  async renderForChannel(templateId, variables = {}, channel) {
    const template = await this.loadTemplate(templateId);
    if (!template) return { title: '', body: '' };

    switch (channel) {
      case 'email':
        return {
          subject: interpolate(template.subject_template, variables),
          body:    interpolate(template.body_template,    variables),
          html:    true,
        };
      case 'sms':
        return {
          body: truncate(
            stripHtml(interpolate(template.sms_template || template.body_template, variables)),
            160
          ),
          html: false,
        };
      case 'push':
        return {
          title: interpolate(template.push_title_template || template.subject_template, variables),
          body:  interpolate(template.push_body_template  || template.body_template,   variables),
          html:  false,
        };
      case 'in_app':
      default:
        return {
          title: interpolate(template.subject_template, variables),
          body:  interpolate(template.body_template,    variables),
          html:  false,
        };
    }
  },

  /* ─── Preview (admin use) ────────────────────────────────────────────────── */
  async preview(templateId, variables = {}) {
    const template = await this.loadTemplate(templateId);
    if (!template) throw new Error(`Template ${templateId} not found`);

    return {
      templateId,
      templateName: template.name,
      channels: {
        in_app: {
          title: interpolate(template.subject_template, variables),
          body:  interpolate(template.body_template,    variables),
        },
        email: {
          subject: interpolate(template.subject_template, variables),
          body:    interpolate(template.body_template,    variables),
        },
        sms: {
          body: truncate(
            stripHtml(interpolate(template.sms_template || template.body_template, variables)),
            160
          ),
        },
        push: {
          title: interpolate(template.push_title_template || template.subject_template, variables),
          body:  interpolate(template.push_body_template  || template.body_template,   variables),
        },
      },
    };
  },

  /* ─── List all active templates ──────────────────────────────────────────── */
  async listTemplates() {
    const db = new sqlite3.Database(DB_PATH);
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT id, name, description, notification_type, is_active, created_at
         FROM notification_templates ORDER BY notification_type, name`,
        [],
        (err, rows) => { db.close(); if (err) reject(err); else resolve(rows); }
      );
    });
  },

  /* ─── Invalidate cache entry ─────────────────────────────────────────────── */
  invalidate(templateId) {
    templateCache.delete(templateId);
  },

  clearCache() {
    templateCache.clear();
  },
};

module.exports = TemplateEngine;
