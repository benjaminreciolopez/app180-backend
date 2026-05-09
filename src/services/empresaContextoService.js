// backend/src/services/empresaContextoService.js
//
// Helpers para clasificar empresas en el ecosistema asesor:
//   - 'despacho_propio'    : empresa contable propia de una asesoría
//   - 'cliente_gestionado' : empresa cliente vinculada a una asesoría
//   - 'autonomo'           : empresa estándar
//
// Diseño: el contexto_tipo se DERIVA en runtime a partir de los datos de
// verdad (asesorias_180.empresa_id + asesoria_clientes_180 + empresa_180.
// gestionada_por_asesoria_id), por lo que estos helpers NO requieren la
// columna `empresa_180.contexto_tipo` para funcionar. La migración
// 20260509_empresa_contexto_tipo.sql es una optimización opcional para
// queries más rápidas.
//
// Estos helpers usan poolSql (sin tenant context ALS) porque algunas queries
// son cross-tenant (un asesor consultando datos agregados de todos sus
// clientes). La autorización se basa SIEMPRE en req.user.asesoria_id ya
// validado por authMiddleware.

import { poolSql } from "../db.js";

/**
 * Devuelve el contexto de una empresa, derivándolo en runtime.
 * @param {string} empresaId
 * @returns {Promise<'despacho_propio'|'cliente_gestionado'|'autonomo'|null>}
 */
export async function getContextoEmpresa(empresaId) {
  if (!empresaId) return null;

  const [esDespacho] = await poolSql`
    SELECT 1 FROM asesorias_180 WHERE empresa_id = ${empresaId} LIMIT 1
  `;
  if (esDespacho) return "despacho_propio";

  const [esCliente] = await poolSql`
    SELECT 1
    FROM empresa_180 e
    WHERE e.id = ${empresaId}
      AND (
        e.gestionada_por_asesoria_id IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM asesoria_clientes_180 ac
          WHERE ac.empresa_id = e.id AND ac.estado = 'activo'
        )
      )
    LIMIT 1
  `;
  if (esCliente) return "cliente_gestionado";

  // Solo confirmamos 'autonomo' si la empresa existe.
  const [exists] = await poolSql`
    SELECT 1 FROM empresa_180 WHERE id = ${empresaId} LIMIT 1
  `;
  return exists ? "autonomo" : null;
}

/**
 * Empresa contable propia (despacho) de una asesoría.
 * @param {string} asesoriaId
 * @returns {Promise<string|null>} empresa_id o null si la asesoría no tiene
 */
export async function getDespachoEmpresaId(asesoriaId) {
  if (!asesoriaId) return null;
  const [row] = await poolSql`
    SELECT empresa_id FROM asesorias_180 WHERE id = ${asesoriaId}
  `;
  return row?.empresa_id ?? null;
}

/**
 * Lista de empresas-cliente gestionadas activamente por una asesoría.
 * Excluye la empresa propia del despacho.
 *
 * @param {string} asesoriaId
 * @returns {Promise<Array<{empresa_id: string, nombre: string|null}>>}
 */
export async function listClientesGestionados(asesoriaId) {
  if (!asesoriaId) return [];
  // No depende de empresa_180.contexto_tipo: la pertenencia se decide por
  // gestionada_por_asesoria_id o por vínculo activo en asesoria_clientes_180.
  const rows = await poolSql`
    SELECT e.id AS empresa_id, e.nombre
    FROM empresa_180 e
    WHERE
      e.gestionada_por_asesoria_id = ${asesoriaId}
      OR EXISTS (
        SELECT 1 FROM asesoria_clientes_180 ac
        WHERE ac.asesoria_id = ${asesoriaId}
          AND ac.empresa_id = e.id
          AND ac.estado = 'activo'
      )
    ORDER BY e.nombre NULLS LAST
  `;
  return rows;
}

/**
 * IDs de las empresas-cliente gestionadas (sólo UUIDs, para queries IN).
 * @param {string} asesoriaId
 * @returns {Promise<string[]>}
 */
export async function listClienteEmpresaIds(asesoriaId) {
  const list = await listClientesGestionados(asesoriaId);
  return list.map((c) => c.empresa_id);
}

/**
 * ¿Esta empresa es el despacho propio del asesor?
 */
export async function isDespachoPropio(empresaId, asesoriaId) {
  if (!empresaId || !asesoriaId) return false;
  const despachoId = await getDespachoEmpresaId(asesoriaId);
  return despachoId === empresaId;
}

/**
 * ¿Esta empresa es uno de los clientes gestionados por la asesoría?
 */
export async function isClienteGestionado(empresaId, asesoriaId) {
  if (!empresaId || !asesoriaId) return false;
  const [row] = await poolSql`
    SELECT 1
    FROM asesoria_clientes_180
    WHERE asesoria_id = ${asesoriaId}
      AND empresa_id = ${empresaId}
      AND estado = 'activo'
    LIMIT 1
  `;
  if (row) return true;
  const [emp] = await poolSql`
    SELECT 1 FROM empresa_180
    WHERE id = ${empresaId} AND gestionada_por_asesoria_id = ${asesoriaId}
    LIMIT 1
  `;
  return !!emp;
}
