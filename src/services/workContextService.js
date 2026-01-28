// backend/src/services/workContextService.js

import { sql } from "../db.js";

/**
 * Resuelve el contexto operativo de trabajo
 */
export async function getWorkContext({
  empresaId,
  clienteId,
  fecha,
  workItemId = null,
}) {
  /* =========================
     1. Cliente
  ========================= */

  if (!clienteId) {
    return {
      cliente: null,
      tarifas: { hora: null, trabajo: null, mes: null },
      trabajos: [],
    };
  }

  const clienteR = await sql`
    select *
    from clients_180
    where id=${clienteId}
      and empresa_id=${empresaId}
      and activo=true
  `;

  const cliente = clienteR[0];

  if (!cliente) {
    throw new Error("Cliente no válido");
  }

  /* =========================
     2. Tarifas activas
  ========================= */

  const tarifas = await sql`
    select *
    from client_tariffs_180
    where empresa_id=${empresaId}
      and cliente_id=${clienteId}
      and activo=true
      and fecha_inicio <= ${fecha}
      and (fecha_fin is null or fecha_fin >= ${fecha})
    order by
      (work_item_id is not null) desc,
      fecha_inicio desc
  `;

  let tarifaHora = null;
  let tarifaTrabajo = null;
  let tarifaMes = null;

  for (const t of tarifas) {
    if (t.tipo === "hora" && !tarifaHora) tarifaHora = t;
    if (t.tipo === "trabajo" && !tarifaTrabajo) tarifaTrabajo = t;
    if (t.tipo === "mes" && !tarifaMes) tarifaMes = t;
  }

  /* =========================
     3. Trabajos disponibles
  ========================= */

  const trabajos = await sql`
    select wi.id, wi.nombre, wi.descripcion
    from work_items_180 wi
    where wi.cliente_id=${clienteId}
      and wi.activo=true
    order by wi.nombre
  `;

  /* =========================
     4. Resultado
  ========================= */

  return {
    cliente: {
      id: cliente.id,
      nombre: cliente.nombre,
      modo_defecto: cliente.modo_defecto,

      lat: cliente.lat,
      lng: cliente.lng,
      radio: cliente.radio_m,
      geo_policy: cliente.geo_policy,

      requiere_geo: cliente.requiere_geo,
    },

    tarifas: {
      hora: tarifaHora,
      trabajo: tarifaTrabajo,
      mes: tarifaMes,
    },

    trabajos,
  };
}
