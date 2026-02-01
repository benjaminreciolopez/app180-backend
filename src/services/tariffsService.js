import { sql } from "../db.js";

export async function getTarifaVigente({
  clienteId,
  tipo,
  workItemId = null,
  fecha,
}) {
  const r = await sql`
    select *
    from client_tariffs_180
    where cliente_id=${clienteId}
      and tipo=${tipo}
      and activo=true
      and fecha_inicio<=${fecha}
      and (fecha_fin is null or fecha_fin>=${fecha})
      and (${workItemId}::uuid is null or work_item_id=${workItemId})
    order by fecha_inicio desc
    limit 1
  `;

  return r[0] || null;
}
