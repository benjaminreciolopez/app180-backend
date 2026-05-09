// backend/src/controllers/asesorAgregadosController.js
//
// Agregados cross-cliente para el dashboard del asesor (Nivel 3).
//
// Devuelve métricas separadas:
//   - despacho: KPIs de la empresa propia de la asesoría (mi gestoría)
//   - clientes: KPIs combinados de toda la cartera de clientes gestionados
//
// La autorización se basa en req.user.asesoria_id (validado por authMiddleware)
// y todas las queries filtran explícitamente por las empresa_id que pertenecen
// al asesor (vía asesoria_clientes_180 o asesorias_180.empresa_id), nunca
// se acepta input del cliente para decidir qué leer.

import { poolSql } from "../db.js";
import {
  getDespachoEmpresaId,
  listClienteEmpresaIds,
} from "../services/empresaContextoService.js";

const N = (v) => Number(v || 0);

/**
 * GET /asesor/agregados/dashboard?ejercicio=2026
 */
export async function getDashboardAgregados(req, res) {
  try {
    const asesoriaId = req.user?.asesoria_id;
    if (!asesoriaId) {
      return res.status(403).json({ error: "Solo asesores con asesoría asignada" });
    }

    const ejercicio =
      parseInt(req.query.ejercicio, 10) || new Date().getFullYear();
    const desde = `${ejercicio}-01-01`;
    const hasta = `${ejercicio}-12-31`;

    const despachoEmpresaId = await getDespachoEmpresaId(asesoriaId);
    const clienteIds = await listClienteEmpresaIds(asesoriaId);

    const despacho = despachoEmpresaId
      ? await calcularKpisEmpresa(despachoEmpresaId, desde, hasta)
      : null;

    const clientes = await calcularKpisClientes(clienteIds, desde, hasta);

    // KPIs RETA cross-cliente (Nivel 3 — flujo bidireccional)
    const reta = await calcularKpisReta(asesoriaId, clienteIds, ejercicio);

    return res.json({ ejercicio, despacho, clientes, reta });
  } catch (err) {
    console.error("getDashboardAgregados error:", err);
    return res.status(500).json({ error: "Error calculando agregados" });
  }
}

// =============================================================================
// Helpers
// =============================================================================

async function calcularKpisEmpresa(empresaId, desde, hasta) {
  const [info] = await poolSql`
    SELECT id, nombre FROM empresa_180 WHERE id = ${empresaId}
  `;
  if (!info) return null;

  // Facturas emitidas (factura_180)
  const [emit] = await poolSql`
    SELECT
      COALESCE(SUM(subtotal), 0)   AS ingresos,
      COALESCE(SUM(iva_total), 0)  AS iva_repercutido,
      COUNT(*)                     AS num_facturas,
      COUNT(*) FILTER (WHERE estado = 'BORRADOR') AS num_borradores,
      COUNT(*) FILTER (WHERE estado = 'VALIDADA') AS num_validadas
    FROM factura_180
    WHERE empresa_id = ${empresaId}
      AND fecha BETWEEN ${desde}::date AND ${hasta}::date
      AND COALESCE(es_test, false) = false
      AND estado != 'ANULADA'
  `;

  // Gastos / compras (purchases_180)
  const [gas] = await poolSql`
    SELECT
      COALESCE(SUM(base_imponible), 0) AS gastos,
      COALESCE(SUM(iva_importe), 0)    AS iva_soportado,
      COUNT(*)                         AS num_gastos
    FROM purchases_180
    WHERE empresa_id = ${empresaId}
      AND fecha_compra BETWEEN ${desde}::date AND ${hasta}::date
      AND activo = true
  `;

  const ingresos = N(emit?.ingresos);
  const gastos = N(gas?.gastos);

  return {
    empresa_id: info.id,
    nombre: info.nombre,
    ingresos,
    gastos,
    resultado: ingresos - gastos,
    iva_repercutido: N(emit?.iva_repercutido),
    iva_soportado: N(gas?.iva_soportado),
    num_facturas: parseInt(emit?.num_facturas || 0, 10),
    num_borradores: parseInt(emit?.num_borradores || 0, 10),
    num_validadas: parseInt(emit?.num_validadas || 0, 10),
    num_gastos: parseInt(gas?.num_gastos || 0, 10),
  };
}

async function calcularKpisClientes(empresaIds, desde, hasta) {
  if (!empresaIds || empresaIds.length === 0) {
    return {
      num_clientes: 0,
      ingresos_total: 0,
      gastos_total: 0,
      iva_repercutido_total: 0,
      iva_soportado_total: 0,
      num_facturas: 0,
      num_borradores: 0,
      num_gastos: 0,
      pendientes_revision_asientos: 0,
    };
  }

  const [emit] = await poolSql`
    SELECT
      COALESCE(SUM(subtotal), 0)  AS ingresos,
      COALESCE(SUM(iva_total), 0) AS iva_repercutido,
      COUNT(*)                    AS num_facturas,
      COUNT(*) FILTER (WHERE estado = 'BORRADOR') AS num_borradores
    FROM factura_180
    WHERE empresa_id = ANY(${empresaIds}::uuid[])
      AND fecha BETWEEN ${desde}::date AND ${hasta}::date
      AND COALESCE(es_test, false) = false
      AND estado != 'ANULADA'
  `;

  const [gas] = await poolSql`
    SELECT
      COALESCE(SUM(base_imponible), 0) AS gastos,
      COALESCE(SUM(iva_importe), 0)    AS iva_soportado,
      COUNT(*)                         AS num_gastos
    FROM purchases_180
    WHERE empresa_id = ANY(${empresaIds}::uuid[])
      AND fecha_compra BETWEEN ${desde}::date AND ${hasta}::date
      AND activo = true
  `;

  // Asientos pendientes de revisión IA (señal útil para priorizar)
  let pendientes = 0;
  try {
    const [as] = await poolSql`
      SELECT COUNT(*)::int AS n
      FROM asientos_180
      WHERE empresa_id = ANY(${empresaIds}::uuid[])
        AND fecha BETWEEN ${desde}::date AND ${hasta}::date
        AND estado != 'anulado'
        AND pendiente_revision = true
    `;
    pendientes = parseInt(as?.n || 0, 10);
  } catch {
    // Si la columna pendiente_revision no existe en este entorno, devolvemos 0
    pendientes = 0;
  }

  return {
    num_clientes: empresaIds.length,
    ingresos_total: N(emit?.ingresos),
    gastos_total: N(gas?.gastos),
    iva_repercutido_total: N(emit?.iva_repercutido),
    iva_soportado_total: N(gas?.iva_soportado),
    num_facturas: parseInt(emit?.num_facturas || 0, 10),
    num_borradores: parseInt(emit?.num_borradores || 0, 10),
    num_gastos: parseInt(gas?.num_gastos || 0, 10),
    pendientes_revision_asientos: pendientes,
  };
}

async function calcularKpisReta(asesoriaId, empresaIds, ejercicio) {
  // Alertas pendientes (no descartadas) en TODOS los clientes del asesor
  let alertas_pendientes = 0;
  if (empresaIds.length > 0) {
    try {
      const [a] = await poolSql`
        SELECT COUNT(*)::int AS n
        FROM reta_alertas_180
        WHERE empresa_id = ANY(${empresaIds}::uuid[])
          AND ejercicio = ${ejercicio}
          AND descartada = false
      `;
      alertas_pendientes = parseInt(a?.n || 0, 10);
    } catch {
      alertas_pendientes = 0;
    }
  }

  // Cambios de base en estado pendiente
  let cambios_comunicados = 0;
  let cambios_propuestos = 0;
  if (empresaIds.length > 0) {
    try {
      const [c] = await poolSql`
        SELECT
          COUNT(*) FILTER (WHERE estado = 'comunicado_pdte_asesor') AS comunicados,
          COUNT(*) FILTER (WHERE estado = 'propuesto_pdte_cliente') AS propuestos
        FROM reta_cambios_base_180
        WHERE empresa_id = ANY(${empresaIds}::uuid[])
          AND ejercicio = ${ejercicio}
      `;
      cambios_comunicados = parseInt(c?.comunicados || 0, 10);
      cambios_propuestos = parseInt(c?.propuestos || 0, 10);
    } catch {
      // tabla puede no existir en entornos antiguos
    }
  }

  // Autónomos sin estimación generada en este ejercicio (señal de "datos pendientes")
  let autonomos_sin_estimacion = 0;
  if (empresaIds.length > 0) {
    try {
      const [s] = await poolSql`
        SELECT COUNT(*)::int AS n
        FROM empresa_180 e
        WHERE e.id = ANY(${empresaIds}::uuid[])
          AND e.tipo_contribuyente = 'autonomo'
          AND NOT EXISTS (
            SELECT 1 FROM reta_estimaciones_180 r
            WHERE r.empresa_id = e.id AND r.ejercicio = ${ejercicio}
          )
      `;
      autonomos_sin_estimacion = parseInt(s?.n || 0, 10);
    } catch {
      autonomos_sin_estimacion = 0;
    }
  }

  return {
    alertas_pendientes,
    cambios_comunicados,
    cambios_propuestos,
    autonomos_sin_estimacion,
    total_pendientes: alertas_pendientes + cambios_comunicados,
  };
}
