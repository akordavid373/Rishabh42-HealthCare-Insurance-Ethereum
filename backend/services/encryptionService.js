/**
 * Data Encryption and Security Service - Issue #40
 * Data at rest/transit encryption, key management, audit logging, compliance, vulnerability scanning
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

class EncryptionService {
  constructor() {
    this._masterKey = this._deriveMasterKey();
    this._keyStore = new Map(); // key-id -> { key, createdAt, rotatedAt }
    this._auditLog = [];
    this._activeKeyId = this._generateKeyId();
    this._keyStore.set(this._activeKeyId, {
      key: this._masterKey,
      createdAt: new Date().toISOString(),
      rotatedAt: null,
    });
  }

  // ─── Encryption at Rest ───────────────────────────────────────────────────

  /**
   * Encrypt sensitive data for storage
   */
  encryptAtRest(plaintext, context = '') {
    const keyEntry = this._keyStore.get(this._activeKeyId);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, keyEntry.key, iv);

    // Include context as additional authenticated data
    if (context) cipher.setAAD(Buffer.from(context));

    const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    const result = Buffer.concat([iv, tag, encrypted]).toString('base64');
    this._audit('encrypt_at_rest', { context, keyId: this._activeKeyId });
    return { ciphertext: result, keyId: this._activeKeyId };
  }

  /**
   * Decrypt data stored at rest
   */
  decryptAtRest(ciphertext, keyId, context = '') {
    const keyEntry = this._keyStore.get(keyId);
    if (!keyEntry) throw new Error(`Key not found: ${keyId}`);

    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.slice(0, IV_LENGTH);
    const tag = buf.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buf.slice(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, keyEntry.key, iv);
    decipher.setAuthTag(tag);
    if (context) decipher.setAAD(Buffer.from(context));

    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    this._audit('decrypt_at_rest', { context, keyId });
    return plaintext;
  }

  // ─── Encryption in Transit ────────────────────────────────────────────────

  /**
   * Encrypt data for API transmission (envelope encryption)
   */
  encryptForTransit(payload) {
    const sessionKey = crypto.randomBytes(KEY_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, sessionKey, iv);

    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Wrap session key with master key
    const { ciphertext: wrappedKey, keyId } = this.encryptAtRest(sessionKey.toString('hex'), 'transit-key');

    return {
      data: Buffer.concat([iv, tag, encrypted]).toString('base64'),
      wrappedKey,
      keyId,
    };
  }

  /**
   * Decrypt data received in transit
   */
  decryptFromTransit(encryptedPayload) {
    const { data, wrappedKey, keyId } = encryptedPayload;

    const sessionKeyHex = this.decryptAtRest(wrappedKey, keyId, 'transit-key');
    const sessionKey = Buffer.from(sessionKeyHex, 'hex');

    const buf = Buffer.from(data, 'base64');
    const iv = buf.slice(0, IV_LENGTH);
    const tag = buf.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buf.slice(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, sessionKey, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  // ─── Key Management ───────────────────────────────────────────────────────

  /**
   * Rotate the active encryption key
   */
  rotateKey() {
    const oldKeyId = this._activeKeyId;
    const newKeyId = this._generateKeyId();
    const newKey = crypto.randomBytes(KEY_LENGTH);

    this._keyStore.set(newKeyId, {
      key: newKey,
      createdAt: new Date().toISOString(),
      rotatedAt: null,
    });

    // Mark old key as rotated (keep for decryption of existing data)
    const oldEntry = this._keyStore.get(oldKeyId);
    this._keyStore.set(oldKeyId, { ...oldEntry, rotatedAt: new Date().toISOString() });

    this._activeKeyId = newKeyId;
    this._audit('key_rotation', { oldKeyId, newKeyId });

    return { oldKeyId, newKeyId, rotatedAt: new Date().toISOString() };
  }

  /**
   * List key metadata (no key material exposed)
   */
  listKeys() {
    const keys = [];
    for (const [id, entry] of this._keyStore) {
      keys.push({
        keyId: id,
        createdAt: entry.createdAt,
        rotatedAt: entry.rotatedAt,
        active: id === this._activeKeyId,
      });
    }
    return keys;
  }

  // ─── Hashing & Integrity ─────────────────────────────────────────────────

  /**
   * Hash sensitive data (e.g., PII fields) for searchable storage
   */
  hashField(value, salt = null) {
    const usedSalt = salt || crypto.randomBytes(SALT_LENGTH).toString('hex');
    const hash = crypto.pbkdf2Sync(String(value), usedSalt, PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
    return { hash, salt: usedSalt };
  }

  verifyField(value, hash, salt) {
    const { hash: computed } = this.hashField(value, salt);
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
  }

  /**
   * Generate HMAC for data integrity verification
   */
  generateHmac(data) {
    return crypto.createHmac('sha256', this._masterKey)
      .update(typeof data === 'string' ? data : JSON.stringify(data))
      .digest('hex');
  }

  verifyHmac(data, hmac) {
    const expected = this.generateHmac(data);
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(hmac, 'hex'));
  }

  // ─── Vulnerability Scanning ───────────────────────────────────────────────

  /**
   * Scan input for common injection patterns
   */
  scanInput(input) {
    const issues = [];
    const str = String(input);

    const patterns = [
      { name: 'SQL Injection', regex: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|EXEC)\b|--|;)/i },
      { name: 'XSS', regex: /<script|javascript:|on\w+\s*=/i },
      { name: 'Path Traversal', regex: /\.\.[/\\]/ },
      { name: 'Command Injection', regex: /[;&|`$]/ },
    ];

    for (const { name, regex } of patterns) {
      if (regex.test(str)) issues.push(name);
    }

    return { safe: issues.length === 0, issues };
  }

  // ─── Audit Logging ────────────────────────────────────────────────────────

  getAuditLog(filter = {}) {
    let logs = [...this._auditLog];
    if (filter.action) logs = logs.filter(l => l.action === filter.action);
    if (filter.since) logs = logs.filter(l => l.timestamp >= filter.since);
    return logs;
  }

  // ─── Compliance ───────────────────────────────────────────────────────────

  /**
   * Generate a compliance report snapshot
   */
  complianceReport() {
    const keys = this.listKeys();
    const activeKey = keys.find(k => k.active);
    const keyAgeMs = activeKey ? Date.now() - new Date(activeKey.createdAt).getTime() : 0;
    const keyAgeDays = Math.floor(keyAgeMs / 86400000);

    return {
      algorithm: ALGORITHM,
      keyLength: KEY_LENGTH * 8,
      activeKeyId: this._activeKeyId,
      keyAgeDays,
      keyRotationRecommended: keyAgeDays > 90,
      totalKeys: keys.length,
      auditLogEntries: this._auditLog.length,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _deriveMasterKey() {
    const secret = process.env.ENCRYPTION_SECRET || 'default-dev-secret-change-in-production';
    const salt = process.env.ENCRYPTION_SALT || 'default-salt';
    return crypto.pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
  }

  _generateKeyId() {
    return `key-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  _audit(action, meta = {}) {
    this._auditLog.push({ action, ...meta, timestamp: new Date().toISOString() });
  }
}

module.exports = new EncryptionService();
