// backend/src/controllers/credencialesController.js
// Endpoints de credenciales externas — admin (su empresa) y asesor (clientes vinculados).

import {
  listarCredencialesEmpresa,
  guardarCredencial,
  eliminarCredencial,
  marcarValidacion,
  SERVICIOS_VALIDOS,
} from "../services/credentialsService.js";
import { sql } from "../db.js";

/**
 * Resuelve el empresa_id objetivo:
 *  - Admin: req.user.empresa_id
 *  - Asesor sobre cliente: req.targetEmpresaId (puesto por asesorClienteRequired)
 */
function resolveEmpresaId(req) {
  return req.targetEmpresaId || req.user?.empresa_id || null;
}

/**
 * GET /admin/credenciales
 * GET /asesor/clientes/:empresa_id/credenciales
 */
export async function listarCredenciales(req, res) {
  try {
    const empresaId = resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no resuelta" });

    const items = await listarCredencialesEmpresa(empresaId);

    // Comprobar si el cliente ya tiene un certificado digital subido (en emisor_180)
    // — esto permite reutilizarlo para DEHú, SS RED, SILTRA sin volver a subir.
    const [emisor] = await sql`
      SELECT (certificado_data IS NOT NULL OR certificado_path IS NOT NULL) AS tiene_certificado,
             certificado_info, certificado_upload_date
      FROM emisor_180 WHERE empresa_id = ${empresaId} LIMIT 1
    `;

    // Devolver también catálogo de servicios para que el frontend muestre cuáles faltan
    const catalogo = SERVICIOS_VALIDOS.map((s) => ({
      servicio: s,
      configurado: items.some((i) => i.servicio === s),
    }));

    return res.json({
      success: true,
      items,
      catalogo,
      certificado_cliente: emisor ? {
        disponible: !!emisor.tiene_certificado,
        info: emisor.certificado_info || null,
        subido_el: emisor.certificado_upload_date || null,
      } : { disponible: false },
    });
  } catch (err) {
    console.error("Error listarCredenciales:", err);
    return res.status(500).json({ error: err.message || "Error obteniendo credenciales" });
  }
}

/**
 * PUT /admin/credenciales/:servicio
 * PUT /asesor/clientes/:empresa_id/credenciales/:servicio
 * Body: { tipo_acceso, identificador, datos_secretos, notas }
 */
export async function guardarCredencialEndpoint(req, res) {
  try {
    const empresaId = resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no resuelta" });

    const { servicio } = req.params;
    const { tipo_acceso, identificador, datos_secretos, notas } = req.body || {};

    if (!SERVICIOS_VALIDOS.includes(servicio)) {
      return res.status(400).json({ error: `Servicio inválido: ${servicio}` });
    }

    const result = await guardarCredencial(empresaId, {
      servicio,
      tipo_acceso,
      identificador,
      datos_secretos,
      notas,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("Error guardarCredencial:", err);
    return res.status(500).json({ error: err.message || "Error guardando credencial" });
  }
}

/**
 * DELETE /admin/credenciales/:servicio
 * DELETE /asesor/clientes/:empresa_id/credenciales/:servicio
 */
export async function eliminarCredencialEndpoint(req, res) {
  try {
    const empresaId = resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no resuelta" });

    const { servicio } = req.params;
    const ok = await eliminarCredencial(empresaId, servicio);
    if (!ok) return res.status(404).json({ error: "Credencial no encontrada" });
    return res.json({ success: true });
  } catch (err) {
    console.error("Error eliminarCredencial:", err);
    return res.status(500).json({ error: err.message || "Error eliminando credencial" });
  }
}

/**
 * POST /admin/credenciales/:servicio/test
 * POST /asesor/clientes/:empresa_id/credenciales/:servicio/test
 * Hace una prueba de conexión contra el servicio configurado.
 * Por ahora es un placeholder — cada integración (DEHú, RED…) tendrá su lógica.
 */
export async function testCredencial(req, res) {
  try {
    const empresaId = resolveEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: "Empresa no resuelta" });

    const { servicio } = req.params;

    // TODO: enrutar a cada servicio. De momento, solo registramos el intento.
    const resultado = {
      ok: false,
      mensaje: `Test de '${servicio}' aún no implementado. Próximamente.`,
      timestamp: new Date().toISOString(),
    };

    await marcarValidacion(empresaId, servicio, resultado);
    return res.json({ success: false, ...resultado });
  } catch (err) {
    console.error("Error testCredencial:", err);
    return res.status(500).json({ error: err.message || "Error testando credencial" });
  }
}
