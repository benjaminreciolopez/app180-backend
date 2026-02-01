import { sql } from "../db.js";

async function getEmpresaId(userId) {
    const r = await sql`select id from empresa_180 where user_id=${userId} limit 1`;
    if (!r[0]) throw new Error("Empresa no encontrada");
    return r[0].id;
}

export async function getEmisorConfig(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        let [emisor] = await sql`select * from emisor_180 where empresa_id=${empresaId}`;

        // Intentar autocompletar con datos de perfil si emisor está vacío
        if (!emisor || (!emisor.nombre && !emisor.nif)) {
            const [perfil] = await sql`select * from perfil_180 where empresa_id=${empresaId}`;
            if (perfil) {
                emisor = {
                    ...emisor,
                    nombre: perfil.nombre_fiscal || emisor?.nombre,
                    nif: perfil.cif || emisor?.nif,
                    direccion: perfil.direccion || emisor?.direccion,
                    poblacion: perfil.poblacion || emisor?.poblacion,
                    provincia: perfil.provincia || emisor?.provincia,
                    cp: perfil.cp || emisor?.cp,
                    pais: perfil.pais || emisor?.pais || "España",
                    telefono: perfil.telefono || emisor?.telefono,
                    email: perfil.email || emisor?.email,
                    web: perfil.web || emisor?.web
                };
            }
        }

        res.json({ success: true, data: emisor || {} });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Error obteniendo emisor" });
    }
}

export async function updateEmisorConfig(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const data = req.body;

        // 1. Actualizar emisor_180
        const [exists] = await sql`select id from emisor_180 where empresa_id=${empresaId}`;
        let result;

        if (exists) {
            [result] = await sql`
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
        } else {
            [result] = await sql`
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
        }

        // 2. Sincronizar con perfil_180 (Copia espejo para coherencia en el resto de la app)
        await sql`
            INSERT INTO perfil_180 (
                empresa_id, nombre_fiscal, cif, direccion, poblacion, provincia, cp, pais, telefono, email, web, updated_at
            ) VALUES (
                ${empresaId}, ${data.nombre}, ${data.nif}, ${data.direccion}, ${data.poblacion}, ${data.provincia}, 
                ${data.cp}, ${data.pais || 'España'}, ${data.telefono}, ${data.email}, ${data.web}, now()
            )
            ON CONFLICT (empresa_id) DO UPDATE SET
                nombre_fiscal = EXCLUDED.nombre_fiscal,
                cif = EXCLUDED.cif,
                direccion = EXCLUDED.direccion,
                poblacion = EXCLUDED.poblacion,
                provincia = EXCLUDED.provincia,
                cp = EXCLUDED.cp,
                pais = EXCLUDED.pais,
                telefono = EXCLUDED.telefono,
                email = EXCLUDED.email,
                web = EXCLUDED.web,
                updated_at = now()
        `;

        res.json({ success: true, data: result });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Error actualizando emisor" });
    }
}

export async function uploadLogo(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const { file } = req.body; // Base64 string

        if (!file) {
            return res.status(400).json({ success: false, error: "No se proporcionó archivo" });
        }

        // Actualizar en la base de datos
        // En un entorno real, guardaríamos el archivo en disco o S3 y guardaríamos el PATH.
        // Por ahora, guardamos el Base64 directamente en logo_path (asegúrate de que la columna lo aguante o úsalo como trigger)
        await sql`
            update emisor_180 
            set logo_path = ${file}
            where empresa_id = ${empresaId}
        `;

        res.json({ success: true, message: "Logo actualizado" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Error al subir logo" });
    }
}

export async function uploadCertificado(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const { file, fileName } = req.body;

        if (!file) {
            return res.status(400).json({ success: false, error: "No se proporcionó certificado" });
        }

        await sql`
            update emisor_180 
            set certificado_path = ${fileName}, 
                certificado_upload_date = now()
            where empresa_id = ${empresaId}
        `;

        res.json({ success: true, message: "Certificado registrado" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Error al registrar certificado" });
    }
}

export async function getSistemaConfig(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const [config] = await sql`select * from configuracionsistema_180 where empresa_id=${empresaId}`;
        res.json({ success: true, data: config || {} });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Error obteniendo configuración del sistema" });
    }
}

export async function updateSistemaConfig(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const data = req.body;

        const [exists] = await sql`select id from configuracionsistema_180 where empresa_id=${empresaId}`;
        let result;

        if (exists) {
            [result] = await sql`
                update configuracionsistema_180 set 
                    verifactu_activo=${data.verifactu_activo ?? false},
                    verifactu_modo=${data.verifactu_modo || 'OFF'},
                    ticket_bai_activo=${data.ticket_bai_activo ?? false}
                where empresa_id=${empresaId}
                returning *
            `;
        } else {
            [result] = await sql`
                insert into configuracionsistema_180 (
                    empresa_id, verifactu_activo, verifactu_modo, ticket_bai_activo, created_at
                ) values (
                    ${empresaId}, ${data.verifactu_activo ?? false}, ${data.verifactu_modo || 'OFF'}, 
                    ${data.ticket_bai_activo ?? false}, now()
                )
                returning *
            `;
        }

        res.json({ success: true, data: result });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Error actualizando configuración del sistema" });
    }
}
