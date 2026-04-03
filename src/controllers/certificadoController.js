// backend/src/controllers/certificadoController.js
// Controller for digital certificate management endpoints

import { sql } from '../db.js';
import logger from '../utils/logger.js';
import {
  uploadCertificate,
  getCertificates,
  verifyCertificate,
  deleteCertificate,
  checkExpirations,
  getUsageLog,
} from '../services/certificadoService.js';

/**
 * Get empresa_id from request (admin vs asesor)
 * Admin: empresa from user, Asesor: empresa from req.params.empresa_id
 */
async function resolveEmpresaId(req) {
  // Asesor route: empresa_id comes from URL params
  if (req.params.empresa_id) {
    return req.params.empresa_id;
  }

  // Admin route: empresa from user
  if (req.user.empresa_id) {
    return req.user.empresa_id;
  }

  const [empresa] = await sql`
    SELECT id FROM empresa_180
    WHERE user_id = ${req.user.id}
    LIMIT 1
  `;

  if (!empresa) {
    const error = new Error('Empresa no encontrada');
    error.status = 403;
    throw error;
  }

  return empresa.id;
}

/**
 * GET - List certificates (no sensitive data)
 */
export async function listCertificados(req, res) {
  try {
    const empresaId = await resolveEmpresaId(req);
    const certs = await getCertificates(empresaId);
    res.json({ success: true, data: certs });
  } catch (error) {
    logger.error('Error en listCertificados:', { error: error.message });
    res.status(error.status || 500).json({ error: error.message });
  }
}

/**
 * POST - Upload a certificate (multipart file upload)
 */
export async function uploadCertificado(req, res) {
  try {
    const empresaId = await resolveEmpresaId(req);

    if (!req.file) {
      return res.status(400).json({ error: 'No se ha enviado ningún archivo .p12/.pfx' });
    }

    const { password, nombre_alias, notas } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'La contraseña del certificado es obligatoria' });
    }

    // Validate file extension
    const filename = req.file.originalname?.toLowerCase() || '';
    if (!filename.endsWith('.p12') && !filename.endsWith('.pfx')) {
      return res.status(400).json({ error: 'Solo se aceptan archivos .p12 o .pfx' });
    }

    const cert = await uploadCertificate(
      empresaId,
      req.file,
      password,
      { nombre_alias: nombre_alias || '', notas: notas || '' },
      req.user.id
    );

    res.status(201).json({ success: true, data: cert });
  } catch (error) {
    logger.error('Error en uploadCertificado:', { error: error.message });
    res.status(error.status || 500).json({ error: error.message });
  }
}

/**
 * POST - Verify a certificate against AEAT
 */
export async function verifyCertificado(req, res) {
  try {
    const empresaId = await resolveEmpresaId(req);
    const { id } = req.params;

    // Emisor-origin certs are already verified by empresa mode
    if (id.startsWith('emisor-')) {
      return res.json({ success: true, data: { verificado: true, mensaje: 'Certificado verificado por modo empresa' } });
    }

    const result = await verifyCertificate(empresaId, id);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Error en verifyCertificado:', { error: error.message });
    res.status(error.status || 500).json({ error: error.message });
  }
}

/**
 * DELETE - Soft delete a certificate
 */
export async function deleteCertificado(req, res) {
  try {
    const empresaId = await resolveEmpresaId(req);
    const { id } = req.params;

    // Cannot delete emisor-origin certs from asesor mode
    if (id.startsWith('emisor-')) {
      return res.status(400).json({ error: 'Este certificado fue subido en modo empresa. Para eliminarlo, hazlo desde el panel de la empresa.' });
    }

    const cert = await deleteCertificate(empresaId, id);

    res.json({ success: true, data: cert, mensaje: 'Certificado eliminado correctamente' });
  } catch (error) {
    logger.error('Error en deleteCertificado:', { error: error.message });
    res.status(error.status || 500).json({ error: error.message });
  }
}

/**
 * GET - Usage log for a certificate
 */
export async function getCertificadoLog(req, res) {
  try {
    const empresaId = await resolveEmpresaId(req);
    const { id } = req.params;

    // Virtual IDs from emisor_180 (e.g. "emisor-3") have no usage log
    if (id.startsWith('emisor-')) {
      return res.json({ success: true, data: [] });
    }

    const limit = parseInt(req.query.limit) || 50;

    const logs = await getUsageLog(empresaId, id, limit);

    res.json({ success: true, data: logs });
  } catch (error) {
    logger.error('Error en getCertificadoLog:', { error: error.message });
    res.status(error.status || 500).json({ error: error.message });
  }
}

/**
 * GET - Check certificate expirations
 */
export async function checkExpiraciones(req, res) {
  try {
    const empresaId = await resolveEmpresaId(req);
    const result = await checkExpirations(empresaId);

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Error en checkExpiraciones:', { error: error.message });
    res.status(error.status || 500).json({ error: error.message });
  }
}
