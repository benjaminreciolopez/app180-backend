import { sql } from "../db.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const forge = require("node-forge");

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
                    web: perfil.web || emisor?.web,
                    iban: emisor?.iban
                };
            }
        }

        if (emisor?.certificado_info && typeof emisor.certificado_info === 'string') {
            try {
                emisor.certificado_info = JSON.parse(emisor.certificado_info);
            } catch (e) {
                console.error("Error parsing certificado_info JSON:", e);
                // Si falla el parseo, lo dejamos como null para evitar errores en frontend
                emisor.certificado_info = null;
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
                    iban=${data.iban || null},
                    texto_pie=${data.texto_pie || null},
                    texto_exento=${data.texto_exento || null},
                    texto_rectificativa=${data.texto_rectificativa || null}
                where empresa_id=${empresaId}
                returning *
            `;
        } else {
            [result] = await sql`
                insert into emisor_180 (
                    empresa_id, nombre, nif, direccion, poblacion, provincia, cp, pais, telefono, email, web, iban,
                    texto_pie, texto_exento, texto_rectificativa
                ) values (
                    ${empresaId}, ${data.nombre}, ${data.nif}, ${data.direccion}, ${data.poblacion}, ${data.provincia},
                    ${data.cp}, ${data.pais || "España"}, ${data.telefono}, ${data.email}, ${data.web}, ${data.iban},
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
        console.error("❌ Error en uploadLogo:", err.message, err.stack);
        res.status(500).json({ success: false, error: "Error al subir logo: " + err.message });
    }
}

export async function uploadCertificado(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const { file, fileName, password } = req.body;
        console.log("📤 Iniciando subida certificado:", fileName);

        if (!file) {
            return res.status(400).json({ success: false, error: "No se proporcionó certificado" });
        }

        if (!password) {
            return res.status(400).json({ success: false, error: "Se requiere contraseña para validar el certificado" });
        }

        // Decodificar Base64
        console.log("🔓 Decodificando Base64...");
        const base64Data = file.split(',')[1] || file;
        const p12Der = forge.util.decode64(base64Data);
        console.log("🧩 Parseando DER...");
        const p12Asn1 = forge.asn1.fromDer(p12Der);

        // Parsear PKCS#12
        let p12;
        try {
            console.log("🔐 Intentando descifrar PKCS#12 con password...");
            // strict: false permite ser más flexible con algunos formatos generados por Windows/browsers
            p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password, { strict: false });
        } catch (e) {
            console.error("❌ Fallo en pkcs12FromAsn1:", e.message);
            // Detectar error de password incorrecta específicamente si es posible
            if (e.message.includes("password") || e.message.includes("MAC")) {
                return res.status(400).json({ success: false, error: "Contraseña incorrecta" });
            }
            return res.status(400).json({ success: false, error: "Error leyendo certificado: " + e.message });
        }

        // Extraer certificado
        let certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
        if (!certBag || certBag.length === 0) {
            return res.status(400).json({ success: false, error: "No se encontró certificado en el archivo" });
        }

        const cert = certBag[0].cert;
        // const subject = cert.subject.attributes.map(a => `${a.shortName}=${a.value}`).join(', ');
        // const issuer = cert.issuer.attributes.map(a => `${a.shortName}=${a.value}`).join(', ');

        const formatDN = (attributes) => {
            if (!attributes) return "";
            return attributes
                .map(a => {
                    // Mapeo amigable de atributos comunes
                    const name = a.shortName || a.name || (a.type ? a.type.toString() : 'OID');
                    return `${name}=${a.value}`;
                })
                .join(', ');
        };

        const subject = formatDN(cert.subject.attributes);
        const issuer = formatDN(cert.issuer.attributes);

        const certInfo = {
            subject: subject,
            issuer: issuer,
            validTo: cert.validity.notAfter,
            validFrom: cert.validity.notBefore,
            serial: cert.serialNumber
        };

        console.log("🔐 Certificado parseado correctamente.", { subject, issuer });

        // 1. Verificar si existe registro de emisor
        const [emisorExists] = await sql`select id from emisor_180 where empresa_id=${empresaId}`;

        if (emisorExists) {
            await sql`
                update emisor_180 
                set certificado_path = ${fileName}, 
                    certificado_upload_date = now(),
                    certificado_info = ${JSON.stringify(certInfo)},
                    certificado_password = ${password}
                where empresa_id = ${empresaId}
            `;
        } else {
            // Crear registro vacío solo con la info del certificado (edge case raro pero posible)
            console.log("⚠️ No existe registro emisor, creando uno nuevo...");
            await sql`
                insert into emisor_180 (
                    empresa_id, 
                    certificado_path, 
                    certificado_upload_date, 
                    certificado_info, 
                    certificado_password,
                    nombre, nif
                ) values (
                    ${empresaId}, 
                    ${fileName}, 
                    now(), 
                    ${JSON.stringify(certInfo)}, 
                    ${password},
                    '', ''
                )
            `;
        }

        res.json({ success: true, message: "Certificado registrado", data: certInfo });
    } catch (err) {
        console.error("❌ Error en uploadCertificado:", err.message, err.stack);
        res.status(500).json({ success: false, error: "Error al registrar certificado: " + err.message });
    }
}

export async function deleteCertificado(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);

        await sql`
            update emisor_180 
            set certificado_path = null, 
                certificado_upload_date = null,
                certificado_info = null,
                certificado_password = null
            where empresa_id = ${empresaId}
        `;

        res.json({ success: true, message: "Certificado eliminado correctamente" });
    } catch (err) {
        console.error("❌ Error en deleteCertificado:", err);
        res.status(500).json({ success: false, error: "Error al eliminar certificado" });
    }
}

export async function generateLegalText(req, res) {
    try {
        const { type } = req.body; // 'pie', 'exento', 'rectificativa'

        const texts = {
            'pie': "Factura emitida bajo el sistema Veri*Factu de la AEAT. Gracias por su confianza.",
            'exento': "Factura exenta de IVA según el artículo 20 de la Ley 37/1992 del Impuesto sobre el Valor Añadido.",
            'rectificativa': "Esta factura rectifica a la factura número [ORIGEN] por [MOTIVO], según el Art. 80 de la Ley del IVA."
        };

        res.json({ success: true, text: texts[type] || "" });
    } catch (err) {
        res.status(500).json({ success: false, error: "Error de IA" });
    }
}

export async function getSistemaConfig(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const [config] = await sql`select * from configuracionsistema_180 where empresa_id=${empresaId}`;

        // Check if invoices exist for current year to lock numbering
        const currentYear = new Date().getFullYear();
        const [hasInvoices] = await sql`
            select 1 
            from factura_180 
            where empresa_id=${empresaId} 
             and estado in ('VALIDADA', 'ENVIADA')
             and extract(year from fecha) = ${currentYear}
            limit 1
        `;

        res.json({
            success: true,
            data: {
                ...(config || {}),
                numeracion_locked: !!hasInvoices
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Error obteniendo configuración del sistema" });
    }
}

export async function updateSistemaConfig(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const data = req.body;

        console.log("📝 Update Sistema Config:", { empresaId, ...data });

        const [exists] = await sql`select id from configuracionsistema_180 where empresa_id=${empresaId}`;
        let result;

        if (exists) {
            [result] = await sql`
                update configuracionsistema_180 set 
                    verifactu_activo=${Boolean(data.verifactu_activo)},
                    verifactu_modo=${data.verifactu_modo || 'OFF'},
                    ticket_bai_activo=${Boolean(data.ticket_bai_activo)},
                    numeracion_tipo=${data.numeracion_tipo || 'STANDARD'},
                    numeracion_formato=${data.numeracion_formato || null},
                    storage_facturas_folder=${data.storage_facturas_folder || 'Facturas emitidas'},
                    backup_local_path=${data.backup_local_path || null}
                where empresa_id=${empresaId}
                returning *
            `;
        } else {
            [result] = await sql`
                insert into configuracionsistema_180 (
                    empresa_id, verifactu_activo, verifactu_modo, ticket_bai_activo, numeracion_tipo, numeracion_formato, storage_facturas_folder, backup_local_path
                ) values (
                    ${empresaId}, ${Boolean(data.verifactu_activo)}, ${data.verifactu_modo || 'OFF'}, 
                    ${Boolean(data.ticket_bai_activo)}, ${data.numeracion_tipo || 'STANDARD'},
                    ${data.numeracion_formato || null}, ${data.storage_facturas_folder || 'Facturas emitidas'},
                    ${data.backup_local_path || null}
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
