import { sql } from "../db.js";

async function getEmpresaId(userIdOrReq) {
    if (typeof userIdOrReq === 'object' && userIdOrReq.user) {
        if (userIdOrReq.user.empresa_id) return userIdOrReq.user.empresa_id;
        userIdOrReq = userIdOrReq.user.id;
    }
    const r = await sql`select id from empresa_180 where user_id=${userIdOrReq} limit 1`;
    if (!r[0]) throw new Error("Empresa no encontrada");
    return r[0].id;
}

export async function listIVA(req, res) {
    try {
        const empresaId = await getEmpresaId(req);

        const ivas = await sql`
      select * from iva_180 
      where empresa_id=${empresaId} and activo=true
      order by porcentaje
    `;
        res.json(ivas);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error listando IVA" });
    }
}

export async function createIVA(req, res) {
    try {
        const empresaId = await getEmpresaId(req);
        const { porcentaje, descripcion } = req.body;

        const pct = parseFloat(porcentaje);
        if (isNaN(pct) || pct < 0 || pct > 100) {
            return res.status(400).json({ error: "Porcentaje inválido" });
        }

        // Check duplicate
        const [existe] = await sql`
      select 1 from iva_180 where empresa_id=${empresaId} and porcentaje=${pct} and activo=true
    `;
        if (existe) {
            return res.status(400).json({ error: "Ya existe este porcentaje de IVA" });
        }

        const [iva] = await sql`
      insert into iva_180 (empresa_id, porcentaje, descripcion, activo, created_at)
      values (${empresaId}, ${pct}, ${descripcion || ""}, true, now())
      returning *
    `;

        res.json({ success: true, data: iva });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error creando IVA" });
    }
}

export async function updateIVA(req, res) {
    try {
        const empresaId = await getEmpresaId(req);
        const { id } = req.params;
        const { porcentaje, descripcion } = req.body;

        const pct = parseFloat(porcentaje);

        // Check ownership
        const [iva] = await sql`
      select * from iva_180 where id=${id} and empresa_id=${empresaId}
    `;
        if (!iva) return res.status(404).json({ error: "IVA no encontrado" });

        const [updated] = await sql`
      update iva_180
      set porcentaje=${isNaN(pct) ? iva.porcentaje : pct},
          descripcion=${descripcion || iva.descripcion}
      where id=${id}
      returning *
    `;

        res.json({ success: true, data: updated });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error actualizando IVA" });
    }
}

export async function deleteIVA(req, res) {
    try {
        const empresaId = await getEmpresaId(req);
        const { id } = req.params;

        // Soft delete
        const [deleted] = await sql`
      update iva_180 set activo=false
      where id=${id} and empresa_id=${empresaId}
      returning id
    `;

        if (!deleted) return res.status(404).json({ error: "IVA no encontrado" });

        res.json({ success: true, message: "IVA desactivado" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error eliminando IVA" });
    }
}
