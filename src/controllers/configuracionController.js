import { sql } from "../db.js";

async function getEmpresaId(userId) {
    const r = await sql`select id from empresa_180 where user_id=${userId} limit 1`;
    if (!r[0]) throw new Error("Empresa no encontrada");
    return r[0].id;
}

export async function getEmisorConfig(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const [emisor] = await sql`select * from emisor_180 where empresa_id=${empresaId}`;

        // If not exists, return empty or default?
        // Frontend expects object.
        res.json(emisor || {});
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error obteniendo emisor" });
    }
}

export async function updateEmisorConfig(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const data = req.body; // Full object or partial

        // Filter fields to avoid SQL injection or invalid columns
        // For simplicity, I'll update known fields.
        // In production, validation is needed.

        // Check if exists
        const [exists] = await sql`select id from emisor_180 where empresa_id=${empresaId}`;

        if (exists) {
            const [updated] = await sql`
        update emisor_180 set 
          nombre=${data.nombre || null},
          nif=${data.nif || null},
          direccion=${data.direccion || null},
          poblacion=${data.poblacion || null},
          provincia=${data.provincia || null},
          cp=${data.cp || null},
          pais=${data.pais || "España"},
          telefono=${data.telefono || null},
          email=${data.email || null},
          web=${data.web || null},
          texto_pie=${data.texto_pie || null},
          texto_exento=${data.texto_exento || null},
          texto_rectificativa=${data.texto_rectificativa || null}
        where empresa_id=${empresaId}
        returning *
      `;
            res.json(updated);
        } else {
            const [created] = await sql`
        insert into emisor_180 (
          empresa_id, nombre, nif, direccion, poblacion, provincia, cp, pais, telefono, email, web,
          texto_pie, texto_exento, texto_rectificativa
        ) values (
          ${empresaId}, ${data.nombre}, ${data.nif}, ${data.direccion}, ${data.poblacion}, ${data.provincia},
          ${data.cp}, ${data.pais || "España"}, ${data.telefono}, ${data.email}, ${data.web},
          ${data.texto_pie}, ${data.texto_exento}, ${data.texto_rectificativa}
        )
        returning *
      `;
            res.json(created);
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error actualizando emisor" });
    }
}

export async function uploadLogo(req, res) {
    // Not implemented fully (multer needed)
    // For now, return mock success or error
    // If user sends Base64, we can handle it.
    res.status(501).json({ error: "Subida de logo no implementada aún" });
}

export async function getSistemaConfig(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const [config] = await sql`select * from configuracionsistema_180 where empresa_id=${empresaId}`;
        res.json(config || {});
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error obteniendo configuración del sistema" });
    }
}

export async function updateSistemaConfig(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const data = req.body;

        const [exists] = await sql`select id from configuracionsistema_180 where empresa_id=${empresaId}`;

        if (exists) {
            const [updated] = await sql`
        update configuracionsistema_180 set 
          verifactu_activo=${data.verifactu_activo ?? false},
          verifactu_modo=${data.verifactu_modo || 'OFF'},
          ticket_bai_activo=${data.ticket_bai_activo ?? false}
        where empresa_id=${empresaId}
        returning *
      `;
            res.json(updated);
        } else {
            const [created] = await sql`
        insert into configuracionsistema_180 (
          empresa_id, verifactu_activo, verifactu_modo, ticket_bai_activo, created_at
        ) values (
          ${empresaId}, ${data.verifactu_activo ?? false}, ${data.verifactu_modo || 'OFF'}, 
          ${data.ticket_bai_activo ?? false}, now()
        )
        returning *
      `;
            res.json(created);
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error actualizando configuración del sistema" });
    }
}
