import crypto from 'crypto';
import logger from './logger.js';

// Formato nuevo (GCM): gcm:<iv_hex>:<authTag_hex>:<ciphertext_hex>
// Formato legacy (CBC): <iv_hex>:<ciphertext_hex>
// El decrypt acepta ambos; encrypt siempre produce GCM.

const GCM_ALGORITHM = 'aes-256-gcm';
const CBC_ALGORITHM = 'aes-256-cbc';
const IV_LENGTH_GCM = 12;
const IV_LENGTH_CBC = 16;
const DEV_FALLBACK = 'default-32-char-key-change-me!!';
const isProd = process.env.NODE_ENV === 'production';

const ENCRYPTION_KEY = (() => {
  const k = process.env.ENCRYPTION_KEY;
  if (k && k.length >= 32) return k;
  if (isProd) {
    logger.error('FATAL: ENCRYPTION_KEY missing or shorter than 32 chars in production');
    throw new Error('ENCRYPTION_KEY env var is required in production (>=32 chars)');
  }
  logger.warn('ENCRYPTION_KEY not set — using insecure development fallback. NEVER use in production.');
  return DEV_FALLBACK;
})();

const KEY_BUF = Buffer.from(ENCRYPTION_KEY.slice(0, 32));

export function encrypt(text) {
  if (!text) return null;
  try {
    const iv = crypto.randomBytes(IV_LENGTH_GCM);
    const cipher = crypto.createCipheriv(GCM_ALGORITHM, KEY_BUF, iv);
    const ciphertext = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `gcm:${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
  } catch (error) {
    logger.error('Encryption error', { message: error.message });
    throw new Error('Failed to encrypt data');
  }
}

export function decrypt(text) {
  if (!text) return null;
  try {
    if (typeof text === 'string' && text.startsWith('gcm:')) {
      const [, ivHex, tagHex, dataHex] = text.split(':');
      if (!ivHex || !tagHex || !dataHex) throw new Error('Invalid GCM format');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(tagHex, 'hex');
      const data = Buffer.from(dataHex, 'hex');
      const decipher = crypto.createDecipheriv(GCM_ALGORITHM, KEY_BUF, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
      return plaintext.toString('utf8');
    }

    // Legacy CBC fallback (datos cifrados antes de la migración)
    const parts = text.split(':');
    if (parts.length !== 2) throw new Error('Invalid encrypted format');
    const iv = Buffer.from(parts[0], 'hex');
    if (iv.length !== IV_LENGTH_CBC) throw new Error('Invalid CBC IV length');
    const decipher = crypto.createDecipheriv(CBC_ALGORITHM, KEY_BUF, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    logger.error('Decryption error', { message: error.message });
    throw new Error('Failed to decrypt data');
  }
}
