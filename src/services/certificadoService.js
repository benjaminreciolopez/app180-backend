// backend/src/services/certificadoService.js
// Service for managing digital certificates (.p12/.pfx) for AEAT filing

import crypto from 'crypto';
import { sql } from '../db.js';
import logger from '../utils/logger.js';

// =========================
// PASSWORD ENCRYPTION (AES-256-GCM)
// =========================
const ALGORITHM = 'aes-256-gcm';
const KEY = process.env.CERT_ENCRYPTION_KEY || 'default-key-change-in-production-32b';

function encryptPassword(password) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(KEY, 'salt', 32);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(password, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptPassword(encryptedData) {
  const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = crypto.scryptSync(KEY, 'salt', 32);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// =========================
// CERTIFICATE PARSING
// =========================

/**
 * Parse PKCS12 certificate to extract metadata.
 * Uses node-forge if available, falls back to crypto validation only.
 */
async function parsePkcs12(p12Buffer, password) {
  const result = {
    valid: false,
    titular_nombre: null,
    titular_nif: null,
    emisor: null,
    numero_serie: null,
    fecha_emision: null,
    fecha_caducidad: null,
  };

  // First validate the certificate is readable
  try {
    crypto.createSecureContext({ pfx: p12Buffer, passphrase: password });
    result.valid = true;
  } catch (err) {
    return { valid: false, error: err.message };
  }

  // Try node-forge for metadata extraction
  try {
    const forge = await import('node-forge');
    const p12Der = forge.default.util.decode64(p12Buffer.toString('base64'));
    const p12Asn1 = forge.default.asn1.fromDer(p12Der);
    const p12 = forge.default.pkcs12.pkcs12FromAsn1(p12Asn1, password || '', { strict: false });

    const certBags = p12.getBags({ bagType: forge.default.pki.oids.certBag })[forge.default.pki.oids.certBag] || [];

    if (certBags.length > 0) {
      const cert = certBags[0].cert;

      // Serial number
      result.numero_serie = cert.serialNumber;

      // Dates
      result.fecha_emision = cert.validity.notBefore;
      result.fecha_caducidad = cert.validity.notAfter;

      // Subject (titular)
      const subject = cert.subject;
      const cn = subject.getField('CN');
      const serialNumber = subject.getField({ name: 'serialNumber' }) || subject.getField('2.5.4.5');

      if (cn) {
        result.titular_nombre = cn.value;
      }

      // NIF from serialNumber OID or CN pattern
      if (serialNumber) {
        result.titular_nif = serialNumber.value.replace(/^IDCES?-?/i, '');
      } else if (cn && cn.value) {
        // Try to extract NIF from CN (common in Spanish certificates)
        const nifMatch = cn.value.match(/(\d{8}[A-Z]|[A-Z]\d{7}[A-Z])/);
        if (nifMatch) result.titular_nif = nifMatch[1];
      }

      // Issuer (emisor)
      const issuer = cert.issuer;
      const issuerO = issuer.getField('O');
      if (issuerO) {
        result.emisor = issuerO.value;
      }
    }
  } catch (forgeErr) {
    logger.warn('node-forge metadata extraction failed, certificate is still valid', { error: forgeErr.message });
  }

  return result;
}

// =========================
// SERVICE FUNCTIONS
// =========================

/**
 * Upload and store a digital certificate
 */
export async function uploadCertificate(empresaId, file, password, metadata, userId) {
  // Validate file type
  const tipo = file.originalname?.toLowerCase().endsWith('.pfx') ? 'pfx' : 'p12';

  // Parse certificate to extract metadata and validate
  const parsed = await parsePkcs12(file.buffer, password);

  if (!parsed.valid) {
    throw Object.assign(
      new Error(`Certificado no válido: ${parsed.error || 'No se pudo leer el archivo .p12/.pfx con la contraseña proporcionada'}`),
      { status: 400 }
    );
  }

  // Encrypt the password
  const certPasswordEncrypted = encryptPassword(password);

  // Store certificate
  const [cert] = await sql`
    INSERT INTO certificados_digitales_180 (
      empresa_id,
      nombre_alias,
      tipo,
      titular_nombre,
      titular_nif,
      emisor,
      numero_serie,
      fecha_emision,
      fecha_caducidad,
      cert_data,
      cert_password_encrypted,
      activo,
      verificado,
      subido_por,
      notas
    ) VALUES (
      ${empresaId},
      ${metadata.nombre_alias || parsed.titular_nombre || 'Certificado'},
      ${tipo},
      ${parsed.titular_nombre},
      ${parsed.titular_nif},
      ${parsed.emisor},
      ${parsed.numero_serie},
      ${parsed.fecha_emision},
      ${parsed.fecha_caducidad},
      ${file.buffer},
      ${certPasswordEncrypted},
      true,
      false,
      ${userId},
      ${metadata.notas || null}
    )
    RETURNING id, nombre_alias, tipo, titular_nombre, titular_nif, emisor,
              numero_serie, fecha_emision, fecha_caducidad, activo, verificado,
              created_at
  `;

  // Log the upload
  await logUsage(cert.id, empresaId, 'subida', null, null, 'ok', 'Certificado subido correctamente', userId);

  logger.info(`Certificado digital subido para empresa ${empresaId}`, { certId: cert.id, alias: cert.nombre_alias });

  return cert;
}

/**
 * List all certificates for an empresa (WITHOUT sensitive data)
 */
export async function getCertificates(empresaId) {
  const certs = await sql`
    SELECT
      id, empresa_id, nombre_alias, tipo,
      titular_nombre, titular_nif, emisor,
      numero_serie, fecha_emision, fecha_caducidad,
      activo, verificado, ultimo_uso, ultimo_error,
      subido_por, notas, created_at, updated_at
    FROM certificados_digitales_180
    WHERE empresa_id = ${empresaId}
      AND activo = true
    ORDER BY created_at DESC
  `;
  return certs;
}

/**
 * Get certificate with decrypted data for AEAT filing (internal use only)
 */
export async function getCertificateForFiling(empresaId, certificadoId) {
  const [cert] = await sql`
    SELECT id, cert_data, cert_password_encrypted, nombre_alias, titular_nif
    FROM certificados_digitales_180
    WHERE id = ${certificadoId}
      AND empresa_id = ${empresaId}
      AND activo = true
    LIMIT 1
  `;

  if (!cert) {
    throw Object.assign(new Error('Certificado no encontrado o inactivo'), { status: 404 });
  }

  if (!cert.cert_data || !cert.cert_password_encrypted) {
    throw Object.assign(new Error('Certificado sin datos almacenados'), { status: 400 });
  }

  const password = decryptPassword(cert.cert_password_encrypted);

  // Update last usage timestamp
  await sql`
    UPDATE certificados_digitales_180
    SET ultimo_uso = now(), updated_at = now()
    WHERE id = ${certificadoId}
  `;

  return {
    id: cert.id,
    p12Buffer: cert.cert_data,
    password,
    alias: cert.nombre_alias,
    nif: cert.titular_nif,
  };
}

/**
 * Verify a certificate by testing connection to AEAT
 */
export async function verifyCertificate(empresaId, certificadoId) {
  const certData = await getCertificateForFiling(empresaId, certificadoId);

  try {
    // Test connection to AEAT preproduction endpoint
    const { testConexionAeat } = await import('./verifactuAeatService.js');
    const certBase64 = certData.p12Buffer.toString('base64');
    const result = await testConexionAeat('PRUEBAS', null, certData.password, certBase64);

    const verificado = result.success;

    // Update verification status
    await sql`
      UPDATE certificados_digitales_180
      SET verificado = ${verificado},
          ultimo_uso = now(),
          ultimo_error = ${verificado ? null : result.mensaje},
          updated_at = now()
      WHERE id = ${certificadoId}
    `;

    // Log the verification
    await logUsage(
      certificadoId, empresaId, 'verificacion', null, null,
      verificado ? 'ok' : 'error',
      result.mensaje,
      null
    );

    return {
      verificado,
      mensaje: result.mensaje,
      endpoint: result.endpoint,
    };
  } catch (err) {
    // Update error status
    await sql`
      UPDATE certificados_digitales_180
      SET ultimo_error = ${err.message}, updated_at = now()
      WHERE id = ${certificadoId}
    `;

    await logUsage(certificadoId, empresaId, 'verificacion', null, null, 'error', err.message, null);

    throw err;
  }
}

/**
 * Soft delete a certificate
 */
export async function deleteCertificate(empresaId, certificadoId) {
  const [cert] = await sql`
    UPDATE certificados_digitales_180
    SET activo = false, updated_at = now()
    WHERE id = ${certificadoId}
      AND empresa_id = ${empresaId}
    RETURNING id, nombre_alias
  `;

  if (!cert) {
    throw Object.assign(new Error('Certificado no encontrado'), { status: 404 });
  }

  await logUsage(certificadoId, empresaId, 'eliminacion', null, null, 'ok', `Certificado "${cert.nombre_alias}" desactivado`, null);

  logger.info(`Certificado ${certificadoId} desactivado para empresa ${empresaId}`);

  return cert;
}

/**
 * Check certificates expiring in next 30/60/90 days
 */
export async function checkExpirations(empresaId = null) {
  const baseCondition = empresaId
    ? sql`WHERE cd.empresa_id = ${empresaId} AND cd.activo = true`
    : sql`WHERE cd.activo = true`;

  const certs = await sql`
    SELECT
      cd.id, cd.empresa_id, cd.nombre_alias,
      cd.titular_nombre, cd.titular_nif, cd.emisor,
      cd.fecha_caducidad, cd.verificado,
      e.nombre as empresa_nombre,
      EXTRACT(DAY FROM cd.fecha_caducidad::timestamp - now()) as dias_restantes
    FROM certificados_digitales_180 cd
    LEFT JOIN empresa_180 e ON e.id = cd.empresa_id
    ${baseCondition}
      AND cd.fecha_caducidad IS NOT NULL
      AND cd.fecha_caducidad <= (now() + interval '90 days')
    ORDER BY cd.fecha_caducidad ASC
  `;

  const resultado = {
    caducados: [],
    criticos_30: [],
    aviso_60: [],
    aviso_90: [],
  };

  for (const cert of certs) {
    const dias = Math.floor(Number(cert.dias_restantes));
    const item = { ...cert, dias_restantes: dias };

    if (dias < 0) {
      resultado.caducados.push(item);
    } else if (dias <= 30) {
      resultado.criticos_30.push(item);
    } else if (dias <= 60) {
      resultado.aviso_60.push(item);
    } else {
      resultado.aviso_90.push(item);
    }
  }

  return resultado;
}

/**
 * Log certificate usage (audit trail)
 */
export async function logUsage(certificadoId, empresaId, accion, modelo, periodo, resultado, detalle, userId) {
  try {
    await sql`
      INSERT INTO certificados_uso_log_180 (
        certificado_id, empresa_id, accion, modelo, periodo, resultado, detalle, usuario_id
      ) VALUES (
        ${certificadoId}, ${empresaId}, ${accion}, ${modelo}, ${periodo}, ${resultado}, ${detalle}, ${userId}
      )
    `;
  } catch (err) {
    logger.warn('Error logging certificate usage', { error: err.message, certificadoId });
  }
}

/**
 * Get usage log for a certificate
 */
export async function getUsageLog(empresaId, certificadoId, limit = 50) {
  const logs = await sql`
    SELECT
      id, accion, modelo, periodo, resultado, detalle, usuario_id, created_at
    FROM certificados_uso_log_180
    WHERE certificado_id = ${certificadoId}
      AND empresa_id = ${empresaId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return logs;
}
