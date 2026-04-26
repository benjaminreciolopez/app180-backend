// backend/src/controllers/dehuController.js
// Endpoints DEHú para admin (su empresa) y asesor (cliente vinculado).

import {
  testConexionDehu,
  sincronizarNotificacionesDehu,
  listarNotificacionesEmpresa,
  actualizarEstadoNotificacion,
} from "../services/dehuService.js";

function resolveEmpresaId(req) {
  return req.targetEmpresaId || req.user?.empresa_id || null;
}

/**
 * GET /admin/dehu/notificaciones?estado=pendiente
 * GET /asesor/clientes/:empresa_id/dehu/notificaciones
 */
export async function listarNotificaciones(req, res) {
  try {
    const empresaId = resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no resuelta" });

    const { estado, limite } = req.query;
    const items = await listarNotificacionesEmpresa(empresaId, { estado, limite });
    return res.json({ success: true, total: items.length, notificaciones: items });
  } catch (err) {
    console.error("Error DEHú listarNotificaciones:", err);
    return res.status(500).json({ error: err.message || "Error obteniendo notificaciones DEHú" });
  }
}

/**
 * POST /admin/dehu/sync
 * POST /asesor/clientes/:empresa_id/dehu/sync
 * Sincroniza con el servicio externo y guarda nuevas en BD.
 */
export async function sincronizar(req, res) {
  try {
    const empresaId = resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no resuelta" });

    const result = await sincronizarNotificacionesDehu(empresaId);
    return res.json(result);
  } catch (err) {
    console.error("Error DEHú sincronizar:", err);
    return res.status(500).json({ error: err.message || "Error sincronizando con DEHú" });
  }
}

/**
 * POST /admin/dehu/test
 * POST /asesor/clientes/:empresa_id/dehu/test
 */
export async function test(req, res) {
  try {
    const empresaId = resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no resuelta" });
    const result = await testConexionDehu(empresaId);
    return res.json(result);
  } catch (err) {
    console.error("Error DEHú test:", err);
    return res.status(500).json({ error: err.message || "Error testando DEHú" });
  }
}

/**
 * PUT /admin/dehu/notificaciones/:id/estado
 * PUT /asesor/clientes/:empresa_id/dehu/notificaciones/:id/estado
 * Body: { estado: 'leida' | 'rechazada' }
 */
export async function cambiarEstadoNotificacion(req, res) {
  try {
    const empresaId = resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no resuelta" });
    const { id } = req.params;
    const { estado } = req.body || {};
    const result = await actualizarEstadoNotificacion(empresaId, id, estado);
    if (!result) return res.status(404).json({ error: "Notificación no encontrada" });
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("Error DEHú cambiar estado:", err);
    return res.status(500).json({ error: err.message || "Error cambiando estado" });
  }
}
