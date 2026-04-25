import crypto from 'crypto';
import logger from './logger.js';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
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

export function encrypt(text) {
  if (!text) return null;
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(
      ALGORITHM,
      Buffer.from(ENCRYPTION_KEY.slice(0, 32)),
      iv
    );
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (error) {
    logger.error('Encryption error', { message: error.message });
    throw new Error('Failed to encrypt data');
  }
}

export function decrypt(text) {
  if (!text) return null;
  try {
    const parts = text.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted format');
    }
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedData = parts[1];
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(ENCRYPTION_KEY.slice(0, 32)),
      iv
    );
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    logger.error('Decryption error', { message: error.message });
    throw new Error('Failed to decrypt data');
  }
}
