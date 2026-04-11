// backend/src/controllers/aeatConsultaController.js
// Controlador para consultas AEAT y gestión de discrepancias

import {
  realizarConsultaCompleta,
  consultarDatosFiscales,
  consultarCenso,
  aplicarCorreccionDesdeAeat,
  ignorarDiscrepancia,
  getHistorialConsultas,
  getDetalleConsulta,
} from '../services/aeatConsultaService.js';
import { sql } from '../db.js';
import logger from '../utils/logger.js';

/**
 * POST /consultar
 * Lanzar consulta a AEAT para un modelo+periodo específico
 */
export async function consultarModelo(req, res) {
  try {
    const { modelo, ejercicio, periodo, certificado_id } = req.body;
    const empresaId = req.params.empresa_id || req.user.empresa_id;

    if (!modelo || !ejercicio) {
      return res.status(400).json({ error: 'Modelo y ejercicio son requeridos' });
    }

    // Buscar certificado: usar el proporcionado o el primero activo
    let certId = certificado_id;
    if (!certId) {
      const [cert] = await sql`
        SELECT id FROM certificados_digitales_180
        WHERE empresa_id = ${empresaId} AND estado = 'activo'
        ORDER BY created_at DESC LIMIT 1
      `;
      if (!cert) {
        return res.status(400).json({ error: 'No hay certificado electrónico activo. Configure uno primero.' });
      }
      certId = cert.id;
    }

    const resultado = await realizarConsultaCompleta(
      empresaId, certId, modelo, parseInt(ejercicio), periodo, req.user.id
    );

    res.json({
      success: true,
      consulta: resultado.consulta,
      resumen: resultado.resumen,
      discrepancias: resultado.discrepancias,
    });
  } catch (error) {
    logger.error('Error consultando AEAT:', error);
    res.status(500).json({ error: error.message || 'Error consultando AEAT' });
  }
}

/**
 * POST /datos-fiscales
 * Consultar datos fiscales del contribuyente en AEAT
 */
export async function consultarDatosFiscalesHandler(req, res) {
  try {
    const { ejercicio, certificado_id } = req.body;
    const empresaId = req.params.empresa_id || req.user.empresa_id;

    if (!ejercicio) {
      return res.status(400).json({ error: 'Ejercicio es requerido' });
    }

    let certId = certificado_id;
    if (!certId) {
      const [cert] = await sql`
        SELECT id FROM certificados_digitales_180
        WHERE empresa_id = ${empresaId} AND estado = 'activo'
        ORDER BY created_at DESC LIMIT 1
      `;
      if (!cert) {
        return res.status(400).json({ error: 'No hay certificado electrónico activo.' });
      }
      certId = cert.id;
    }

    const resultado = await consultarDatosFiscales(empresaId, certId, parseInt(ejercicio));

    res.json({ success: true, datos_fiscales: resultado });
  } catch (error) {
    logger.error('Error consultando datos fiscales:', error);
    res.status(500).json({ error: error.message || 'Error consultando datos fiscales' });
  }
}

/**
 * POST /censo
 * Consultar censo del contribuyente en AEAT
 */
export async function consultarCensoHandler(req, res) {
  try {
    const { certificado_id } = req.body;
    const empresaId = req.params.empresa_id || req.user.empresa_id;

    let certId = certificado_id;
    if (!certId) {
      const [cert] = await sql`
        SELECT id FROM certificados_digitales_180
        WHERE empresa_id = ${empresaId} AND estado = 'activo'
        ORDER BY created_at DESC LIMIT 1
      `;
      if (!cert) {
        return res.status(400).json({ error: 'No hay certificado electrónico activo.' });
      }
      certId = cert.id;
    }

    const resultado = await consultarCenso(empresaId, certId);

    res.json({ success: true, censo: resultado });
  } catch (error) {
    logger.error('Error consultando censo:', error);
    res.status(500).json({ error: error.message || 'Error consultando censo' });
  }
}

/**
 * GET /historial
 * Listar consultas previas con filtros
 */
export async function getHistorial(req, res) {
  try {
    const empresaId = req.params.empresa_id || req.user.empresa_id;
    const { modelo, ejercicio, estado, limit } = req.query;

    const consultas = await getHistorialConsultas(empresaId, { modelo, ejercicio, estado, limit });

    res.json({ success: true, consultas });
  } catch (error) {
    logger.error('Error obteniendo historial consultas:', error);
    res.status(500).json({ error: 'Error obteniendo historial' });
  }
}

/**
 * GET /:consultaId
 * Detalle de una consulta con todas sus discrepancias
 */
export async function getConsultaDetalle(req, res) {
  try {
    const { consultaId } = req.params;

    const resultado = await getDetalleConsulta(consultaId);

    res.json({ success: true, ...resultado });
  } catch (error) {
    logger.error('Error obteniendo detalle consulta:', error);
    res.status(500).json({ error: error.message || 'Error obteniendo detalle' });
  }
}

/**
 * POST /:consultaId/resolver
 * Resolver una discrepancia (actualizar app o ignorar)
 */
export async function resolverDiscrepancia(req, res) {
  try {
    const { discrepancia_id, accion, notas } = req.body;

    if (!discrepancia_id || !accion) {
      return res.status(400).json({ error: 'discrepancia_id y accion son requeridos' });
    }

    let resultado;
    if (accion === 'actualizar_app') {
      resultado = await aplicarCorreccionDesdeAeat(discrepancia_id, req.user.id);
    } else if (accion === 'ignorar') {
      resultado = await ignorarDiscrepancia(discrepancia_id, req.user.id, notas);
    } else {
      return res.status(400).json({ error: 'Acción no válida. Use: actualizar_app, ignorar' });
    }

    res.json({ success: true, ...resultado });
  } catch (error) {
    logger.error('Error resolviendo discrepancia:', error);
    res.status(500).json({ error: error.message || 'Error resolviendo discrepancia' });
  }
}

/**
 * GET /resumen/:ejercicio
 * Resumen de estado de consultas/discrepancias para un ejercicio completo
 */
export async function getResumenEjercicio(req, res) {
  try {
    const empresaId = req.params.empresa_id || req.user.empresa_id;
    const { ejercicio } = req.params;

    const resumen = await sql`
      SELECT
        c.modelo,
        c.periodo,
        c.estado,
        c.fecha_consulta,
        c.discrepancias_resumen,
        (SELECT COUNT(*) FROM aeat_discrepancias_180 d
         WHERE d.consulta_id = c.id AND d.estado = 'pendiente') as discrepancias_pendientes
      FROM aeat_consultas_180 c
      WHERE c.empresa_id = ${empresaId}
        AND c.ejercicio = ${parseInt(ejercicio)}
      ORDER BY c.modelo, c.periodo, c.fecha_consulta DESC
    `;

    // Agrupar por modelo
    const porModelo = {};
    for (const r of resumen) {
      const key = `${r.modelo}_${r.periodo}`;
      if (!porModelo[key]) {
        porModelo[key] = r;
      }
      // Solo mantener la consulta más reciente por modelo/periodo
    }

    res.json({
      success: true,
      ejercicio: parseInt(ejercicio),
      modelos: Object.values(porModelo),
    });
  } catch (error) {
    logger.error('Error obteniendo resumen ejercicio:', error);
    res.status(500).json({ error: 'Error obteniendo resumen' });
  }
}
