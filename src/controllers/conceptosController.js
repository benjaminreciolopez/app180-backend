import { sql } from "../db.js";

async function getEmpresaId(userId) {
    const r = await sql`select id from empresa_180 where user_id=${userId} limit 1`;
    if (!r[0]) throw new Error("Empresa no encontrada");
    return r[0].id;
}

export async function listConceptos(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const { q, cliente_id } = req.query;

        let query = sql`select * from concepto_180 where empresa_id=${empresaId}`;

        if (cliente_id) {
            // Mostrar conceptos específicos del cliente O los que no tienen cliente (genéricos)
            query = sql`${query} and (cliente_id = ${cliente_id} or cliente_id is null)`;
        }

        if (q) {
            const pattern = `%${q}%`;
            query = sql`
        ${query} and (nombre ilike ${pattern} or descripcion ilike ${pattern} or categoria ilike ${pattern})
      `;
        }

        const conceptos = await sql`
      ${query} order by cliente_id nulls last, nombre asc
    `;

        res.json({ success: true, data: conceptos });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error listando conceptos" });
    }
}

export async function autocompleteConceptos(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const { q, cliente_id } = req.query;

        if (!q || q.length < 1) {
            return res.json([]);
        }

        const pattern = `%${q}%`;
        const conceptos = await sql`
      select id, nombre, descripcion, precio_unitario, iva_default, cliente_id, categoria
      from concepto_180
      where empresa_id=${empresaId}
        and (nombre ilike ${pattern} or descripcion ilike ${pattern} or categoria ilike ${pattern})
        ${cliente_id ? sql`and (cliente_id = ${cliente_id} or cliente_id is null)` : sql``}
      order by cliente_id nulls last, nombre asc
      limit 20
    `;

        res.json(conceptos);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error en autocomplete" });
    }
}

export async function createConcepto(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const { nombre, descripcion, precio_unitario, iva_default, cliente_id, categoria } = req.body;

        if (!nombre) return res.status(400).json({ error: "Nombre requerido" });

        // El usuario puede enviar o no precio/iva. Si no los envía, se usan valores por defecto o null.
        const [concepto] = await sql`
      insert into concepto_180 (
        empresa_id, nombre, descripcion, precio_unitario, iva_default, cliente_id, categoria, created_at
      )
      values (
        ${empresaId}, ${nombre}, ${descripcion || ''}, ${precio_unitario || 0}, 
        ${iva_default || 21}, ${n(cliente_id)}, ${n(categoria)}, now()
      )
      returning *
    `;

        res.json({ success: true, data: concepto });
    } catch (err) {
        console.error('Error en createConcepto:', err);
        res.status(500).json({ error: "Error creando concepto" });
    }
}

export async function updateConcepto(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const { id } = req.params;
        const { nombre, descripcion, precio_unitario, iva_default, cliente_id, categoria } = req.body;

        const [updated] = await sql`
      update concepto_180
      set nombre=${nombre}, 
          descripcion=${descripcion}, 
          precio_unitario=${precio_unitario},
          iva_default=${iva_default},
          cliente_id=${n(cliente_id)},
          categoria=${n(categoria)}
      where id=${id} and empresa_id=${empresaId}
      returning *
    `;

        if (!updated) return res.status(404).json({ error: "Concepto no encontrado" });

        res.json({ success: true, data: updated });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error actualizando concepto" });
    }
}

function n(v) {
    return v === undefined || v === "" ? null : v;
}

export async function deleteConcepto(req, res) {
    // ...
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const { id } = req.params;

        const [deleted] = await sql`
      delete from concepto_180 where id=${id} and empresa_id=${empresaId}
      returning id
    `;

        if (!deleted) return res.status(404).json({ error: "Concepto no encontrado" });

        res.json({ success: true, message: "Concepto eliminado" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error eliminando concepto" });
    }
}
