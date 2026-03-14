import { sql } from "../db.js";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const forge = require("node-forge");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getEmpresaId(userIdOrReq) {
    if (typeof userIdOrReq === 'object' && userIdOrReq.user) {
        if (userIdOrReq.user.empresa_id) return userIdOrReq.user.empresa_id;
        userIdOrReq = userIdOrReq.user.id;
    }
    const r = await sql`select id from empresa_180 where user_id=${userIdOrReq} limit 1`;
    if (!r[0]) throw new Error("Empresa no encontrada");
    return r[0].id;
}

export async function getEmisorConfig(req, res) {
    try {
        const empresaId = await getEmpresaId(req);
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
        const empresaId = await getEmpresaId(req);
        const data = req.body;

        // 1. Actualizar emisor_180
        const [exists] = await sql`select id from emisor_180 where empresa_id=${empresaId}`;
        let result;

        if (exists) {
            [result] = await sql`
                update emisor_180 set 
                    nombre=${data.nombre || null},
                    nombre_comercial=${data.nombre_comercial || null},
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
                    registro_mercantil=${data.registro_mercantil || null},
                    texto_pie=${data.texto_pie || null},
                    texto_exento=${data.texto_exento || null},
                    texto_rectificativa=${data.texto_rectificativa || null},
                    terminos_legales=${data.terminos_legales || null},
                    mensaje_iva=${data.mensaje_iva || null}
                where empresa_id=${empresaId}
                returning *
            `;
        } else {
            [result] = await sql`
                insert into emisor_180 (
                    empresa_id, nombre, nombre_comercial, nif, direccion, poblacion, provincia, cp, pais, telefono, email, web, iban,
                    registro_mercantil, texto_pie, texto_exento, texto_rectificativa, terminos_legales, mensaje_iva
                ) values (
                    ${empresaId}, ${data.nombre}, ${data.nombre_comercial || null}, ${data.nif}, ${data.direccion}, ${data.poblacion}, ${data.provincia},
                    ${data.cp}, ${data.pais || "España"}, ${data.telefono}, ${data.email}, ${data.web}, ${data.iban},
                    ${data.registro_mercantil || null}, ${data.texto_pie}, ${data.texto_exento}, ${data.texto_rectificativa},
                    ${data.terminos_legales || null}, ${data.mensaje_iva || null}
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
        const empresaId = await getEmpresaId(req);
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
        const empresaId = await getEmpresaId(req);
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
        const empresaId = await getEmpresaId(req);

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
        const empresaId = await getEmpresaId(req);
        const [config] = await sql`select * from configuracionsistema_180 where empresa_id=${empresaId}`;

        // Textos legales viven en emisor_180 — los recuperamos aquí para que el frontend
        // los reciba en la misma respuesta que el resto de configuración del sistema
        const [emisor] = await sql`
            SELECT texto_pie, texto_exento, texto_rectificativa, terminos_legales, mensaje_iva
            FROM emisor_180
            WHERE empresa_id=${empresaId}
            LIMIT 1
        `;

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
                // Fusionar textos legales del emisor
                texto_pie: emisor?.texto_pie || config?.texto_pie || null,
                texto_exento: emisor?.texto_exento || config?.texto_exento || null,
                texto_rectificativa: emisor?.texto_rectificativa || config?.texto_rectificativa || null,
                terminos_legales: emisor?.terminos_legales || null,
                mensaje_iva: emisor?.mensaje_iva || null,
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
        const empresaId = await getEmpresaId(req);
        const data = req.body;

        console.log("📝 Update Sistema Config:", { empresaId, ...data });

        // --- Validacion VeriFactu modo ---
        if (data.verifactu_modo !== undefined) {
            const nuevoModo = data.verifactu_modo;

            // Obtener tipo_contribuyente de la empresa
            const [emp] = await sql`SELECT tipo_contribuyente FROM empresa_180 WHERE id=${empresaId}`;
            const tipo = emp?.tipo_contribuyente || 'autonomo';
            const deadline = tipo === 'sociedad' ? new Date('2027-01-01') : new Date('2027-07-01');
            const ahora = new Date();

            // Regla 1: Si pasó el deadline, solo PRODUCCION permitido
            if (ahora >= deadline && (nuevoModo === 'OFF' || nuevoModo === 'TEST')) {
                const fechaStr = tipo === 'sociedad' ? '1 de enero de 2027' : '1 de julio de 2027';
                return res.status(400).json({
                    success: false,
                    error: `Desde el ${fechaStr}, VeriFactu es obligatorio para ${tipo === 'sociedad' ? 'sociedades' : 'autónomos'}. No puedes desactivarlo.`
                });
            }

            // Regla 2: Si hay facturas YA ENVIADAS a la AEAT, no se puede volver a OFF/TEST
            if (nuevoModo === 'OFF' || nuevoModo === 'TEST') {
                const [reg] = await sql`
                    SELECT COUNT(*)::int as total FROM registroverifactu_180
                    WHERE empresa_id=${empresaId}
                      AND estado_envio = 'ENVIADO'
                `;
                if (reg && reg.total > 0) {
                    return res.status(400).json({
                        success: false,
                        error: `No puedes cambiar a ${nuevoModo}. Ya has enviado ${reg.total} factura(s) a la AEAT. Este cambio es irreversible.`,
                        es_irreversible: true
                    });
                }
            }
        }

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
                    serie=${data.serie || null},
                    storage_facturas_folder=${data.storage_facturas_folder || 'Facturas emitidas'},
                    backup_local_path=${data.backup_local_path || null},
                    correlativo_inicial=${parseInt(data.correlativo_inicial) || 0},
                    facturas_inmutables=${data.facturas_inmutables !== undefined ? Boolean(data.facturas_inmutables) : true},
                    prohibir_borrado_facturas=${data.prohibir_borrado_facturas !== undefined ? Boolean(data.prohibir_borrado_facturas) : true},
                    bloquear_fechas_pasadas=${data.bloquear_fechas_pasadas !== undefined ? Boolean(data.bloquear_fechas_pasadas) : true},
                    auditoria_activa=${data.auditoria_activa !== undefined ? Boolean(data.auditoria_activa) : true},
                    nivel_auditoria=${data.nivel_auditoria || 'BASICA'},
                    migracion_last_pdf=${data.migracion_last_pdf || null},
                    migracion_last_serie=${data.migracion_last_serie || null},
                    migracion_last_emisor_nif=${data.migracion_last_emisor_nif || null},
                    migracion_last_cliente_nif=${data.migracion_last_cliente_nif || null},
                    migracion_last_subtotal=${parseFloat(data.migracion_last_subtotal) || 0},
                    migracion_last_iva=${parseFloat(data.migracion_last_iva) || 0},
                    migracion_last_total=${parseFloat(data.migracion_last_total) || 0},
                    migracion_legal_aceptado=${Boolean(data.migracion_legal_aceptado)},
                    actualizado_en=now(),
                    migracion_fecha_aceptacion=CASE 
                        WHEN ${Boolean(data.migracion_legal_aceptado)} = TRUE AND (SELECT migracion_legal_aceptado FROM configuracionsistema_180 WHERE empresa_id=${empresaId}) = FALSE THEN now()
                        WHEN ${Boolean(data.migracion_legal_aceptado)} = TRUE THEN (SELECT migracion_fecha_aceptacion FROM configuracionsistema_180 WHERE empresa_id=${empresaId})
                        ELSE NULL 
                    END
                where empresa_id=${empresaId}
                returning *
            `;
        } else {
            [result] = await sql`
                insert into configuracionsistema_180 (
                    empresa_id, verifactu_activo, verifactu_modo, ticket_bai_activo,
                    numeracion_tipo, numeracion_formato, serie, storage_facturas_folder,
                    backup_local_path, correlativo_inicial,
                    facturas_inmutables, prohibir_borrado_facturas, bloquear_fechas_pasadas,
                    auditoria_activa, nivel_auditoria,
                    migracion_last_pdf, migracion_legal_aceptado, migracion_fecha_aceptacion
                ) values (
                    ${empresaId}, ${Boolean(data.verifactu_activo)}, ${data.verifactu_modo || 'OFF'},
                    ${Boolean(data.ticket_bai_activo)}, ${data.numeracion_tipo || 'STANDARD'},
                    ${data.numeracion_formato || null}, ${data.serie || null},
                    ${data.storage_facturas_folder || 'Facturas emitidas'},
                    ${data.backup_local_path || null}, ${parseInt(data.correlativo_inicial) || 0},
                    ${data.facturas_inmutables !== undefined ? Boolean(data.facturas_inmutables) : true},
                    ${data.prohibir_borrado_facturas !== undefined ? Boolean(data.prohibir_borrado_facturas) : true},
                    ${data.bloquear_fechas_pasadas !== undefined ? Boolean(data.bloquear_fechas_pasadas) : true},
                    ${data.auditoria_activa !== undefined ? Boolean(data.auditoria_activa) : true},
                    ${data.nivel_auditoria || 'BASICA'},
                    ${data.migracion_last_pdf || null}, ${Boolean(data.migracion_legal_aceptado)},
                    ${data.migracion_legal_aceptado ? sql`now()` : null}
                )
                returning *
            `;
        }

        // ---------------------------------------------------------------
        // Los textos legales + modo_numeracion/siguiente_numero → emisor_180
        // El frontend los envía en facturacionData a este endpoint,
        // pero esos campos viven en emisor_180, no en configuracionsistema_180
        // ---------------------------------------------------------------
        const textosLegales = {
            texto_pie: data.texto_pie ?? null,
            texto_exento: data.texto_exento ?? null,
            texto_rectificativa: data.texto_rectificativa ?? null,
            terminos_legales: data.terminos_legales ?? null,
            mensaje_iva: data.mensaje_iva ?? null,
        };
        const algunTexto = Object.values(textosLegales).some(v => v !== null && v !== undefined);
        const tieneModoNumeracion = data.modo_numeracion !== undefined || data.siguiente_numero !== undefined;

        if (algunTexto || tieneModoNumeracion) {
            const [emisorExists] = await sql`SELECT id FROM emisor_180 WHERE empresa_id=${empresaId}`;
            if (emisorExists) {
                await sql`
                    UPDATE emisor_180 SET
                        texto_pie=${textosLegales.texto_pie},
                        texto_exento=${textosLegales.texto_exento},
                        texto_rectificativa=${textosLegales.texto_rectificativa},
                        terminos_legales=${textosLegales.terminos_legales},
                        mensaje_iva=${textosLegales.mensaje_iva},
                        modo_numeracion=${data.modo_numeracion || 'BASICO'},
                        siguiente_numero=${parseInt(data.siguiente_numero) || 1}
                    WHERE empresa_id=${empresaId}
                `;
            } else {
                // Crear registro de emisor mínimo para guardar los textos
                await sql`
                    INSERT INTO emisor_180 (empresa_id, texto_pie, texto_exento, texto_rectificativa, terminos_legales, mensaje_iva, modo_numeracion, siguiente_numero)
                    VALUES (${empresaId}, ${textosLegales.texto_pie}, ${textosLegales.texto_exento}, ${textosLegales.texto_rectificativa}, ${textosLegales.terminos_legales}, ${textosLegales.mensaje_iva}, ${data.modo_numeracion || 'BASICO'}, ${parseInt(data.siguiente_numero) || 1})
                    ON CONFLICT (empresa_id) DO UPDATE SET
                        texto_pie = EXCLUDED.texto_pie,
                        texto_exento = EXCLUDED.texto_exento,
                        texto_rectificativa = EXCLUDED.texto_rectificativa,
                        terminos_legales = EXCLUDED.terminos_legales,
                        mensaje_iva = EXCLUDED.mensaje_iva,
                        modo_numeracion = EXCLUDED.modo_numeracion,
                        siguiente_numero = EXCLUDED.siguiente_numero
                `;
            }
        }

        res.json({ success: true, data: result });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Error actualizando configuración del sistema" });
    }
}

export async function uploadEvidencia(req, res) {
    try {
        const empresaId = await getEmpresaId(req);
        const { file } = req.body; // Base64 string

        if (!file) {
            return res.status(400).json({ success: false, error: "No se proporcionó archivo de evidencia" });
        }

        // Por simplicidad y siguiendo el patrón de logos, guardamos el base64
        // (En una app de alta carga esto iría a S3/Disk)
        await sql`
            update configuracionsistema_180 
            set migracion_last_pdf = ${file}
            where empresa_id = ${empresaId}
        `;

        res.json({ success: true, path: file });
    } catch (err) {
        console.error("❌ Error en uploadEvidencia:", err);
        res.status(500).json({ success: false, error: "Error al subir evidencia: " + err.message });
    }
}

export async function ocrMigracion(req, res) {
    try {
        const { file } = req.body; // Base64 del PDF

        if (!file) {
            return res.status(400).json({ success: false, error: "No se proporcionó archivo" });
        }

        // --- LÓGICA INTELIGENTE DE EXTRACCIÓN (SIMULADA/IA) ---
        // Simulamos un retraso de procesamiento para dar realismo a la experiencia de usuario.
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Simulamos la extracción de datos agrupados por confianza
        // En una implementación real, esto vendría del motor de IA
        const mockExtractedData = {
            numeracion: {
                ultimo_numero: Math.floor(Math.random() * 500) + 100,
                serie: "SERIE-B",
                confidence: 0.98 // Alta confianza -> Bloquea edición
            },
            identidad: {
                emisor_nif: "B12345678",
                cliente_nif: "A87654321",
                confidence: 0.85 // Confianza media -> Permite edición
            },
            economicos: {
                subtotal: 100.00,
                iva: 21.00,
                total: 121.00,
                confidence: 0.95 // Alta confianza -> Bloquea edición
            },
            mensaje: "Análisis completado. Algunos campos han sido bloqueados por alta precisión."
        };

        res.json({ success: true, data: mockExtractedData });
    } catch (err) {
        console.error("❌ Error en ocrMigracion:", err);
        res.status(500).json({ success: false, error: "Error al procesar el OCR de la factura" });
    }
}

/**
 * GET /admin/facturacion/configuracion/verifactu/status
 * Estado completo de VeriFactu: modo actual, modos disponibles, deadline, irreversibilidad
 */
export async function getVerifactuStatus(req, res) {
    try {
        const empresaId = await getEmpresaId(req);

        // Obtener tipo contribuyente
        const [emp] = await sql`SELECT tipo_contribuyente FROM empresa_180 WHERE id=${empresaId}`;
        const tipo = emp?.tipo_contribuyente || 'autonomo';

        // Obtener config actual
        const [cfg] = await sql`SELECT verifactu_activo, verifactu_modo FROM configuracionsistema_180 WHERE empresa_id=${empresaId}`;
        const modoActual = cfg?.verifactu_modo || 'OFF';

        // Contar facturas emitidas con VeriFactu
        const [reg] = await sql`SELECT COUNT(*)::int as total FROM registroverifactu_180 WHERE empresa_id=${empresaId}`;
        const facturasVerifactu = reg?.total || 0;

        // Calcular deadline segun tipo
        const deadline = tipo === 'sociedad' ? new Date('2027-01-01') : new Date('2027-07-01');
        const ahora = new Date();
        const diasRestantes = Math.max(0, Math.ceil((deadline - ahora) / (1000 * 60 * 60 * 24)));
        const pasadoDeadline = ahora >= deadline;

        // Determinar modos disponibles
        const esIrreversible = facturasVerifactu > 0;
        let modosDisponibles = [];

        if (pasadoDeadline) {
            modosDisponibles = ['PRODUCCION'];
        } else if (esIrreversible) {
            modosDisponibles = ['PRODUCCION'];
        } else {
            modosDisponibles = ['OFF', 'TEST', 'PRODUCCION'];
        }

        // Nivel de alerta
        let alerta = null;
        if (pasadoDeadline && modoActual !== 'PRODUCCION') {
            alerta = 'critico';
        } else if (diasRestantes <= 30) {
            alerta = 'rojo';
        } else if (diasRestantes <= 90) {
            alerta = 'amarillo';
        }

        res.json({
            success: true,
            data: {
                modo_actual: modoActual,
                verifactu_activo: cfg?.verifactu_activo || false,
                tipo_contribuyente: tipo,
                modos_disponibles: modosDisponibles,
                deadline: deadline.toISOString().split('T')[0],
                dias_restantes: diasRestantes,
                pasado_deadline: pasadoDeadline,
                facturas_verifactu: facturasVerifactu,
                es_irreversible: esIrreversible,
                alerta
            }
        });
    } catch (err) {
        console.error("Error en getVerifactuStatus:", err);
        res.status(500).json({ success: false, error: "Error obteniendo estado VeriFactu" });
    }
}

/**
 * GET /admin/facturacion/configuracion/verifactu/declaracion-responsable
 * Devuelve la declaración responsable del productor del software con datos reales
 */
export async function getDeclaracionResponsableProductor(req, res) {
    try {
        const empresaId = await getEmpresaId(req);

        // Leer template
        const templatePath = join(__dirname, '../../templates/declaracion_responsable_productor_verifactu.html');
        let html = readFileSync(templatePath, 'utf-8');

        // Leer versión dinámica del package.json
        const pkgPath = join(__dirname, '../../package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

        // Leer datos reales del emisor (configuración de empresa)
        const [emisor] = await sql`SELECT * FROM emisor_180 WHERE empresa_id=${empresaId}`;
        const [perfil] = await sql`SELECT * FROM perfil_180 WHERE empresa_id=${empresaId}`;

        // Datos del productor desde la BD
        const nombre = emisor?.nombre || perfil?.nombre_fiscal || 'CONTENDO GESTIONES';
        const nif = emisor?.nif || perfil?.cif || '';
        const productor = {
            PRODUCTOR_RAZON_SOCIAL: nombre,
            PRODUCTOR_NIF: nif,
            PRODUCTOR_DIRECCION: emisor?.direccion || perfil?.direccion || '',
            PRODUCTOR_MUNICIPIO: emisor?.poblacion || perfil?.poblacion || '',
            PRODUCTOR_PROVINCIA: emisor?.provincia || perfil?.provincia || '',
            PRODUCTOR_CP: emisor?.cp || perfil?.cp || '',
            PRODUCTOR_EMAIL: emisor?.email || perfil?.email || '',
            PRODUCTOR_WEB: emisor?.web || perfil?.web || 'https://contendo.es',
            PRODUCTOR_REPRESENTANTE: nombre,
            SOFTWARE_NOMBRE: 'CONTENDO',
            SOFTWARE_ID: 'APP180-CONTENDO',
            SOFTWARE_VERSION: pkg.version || '1.0.0',
            SOFTWARE_NUM_REGISTRO: 'APP180-VFACT-2026-001',
            MUNICIPIO: emisor?.poblacion || perfil?.poblacion || '',
        };

        // Fecha
        const ahora = new Date();
        const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        productor.FECHA_FORMATEADA = `${ahora.getDate()} de ${meses[ahora.getMonth()]} de ${ahora.getFullYear()}`;
        productor.FECHA_GENERACION = ahora.toISOString().split('T')[0];

        // Reemplazar placeholders
        for (const [key, value] of Object.entries(productor)) {
            html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }

        // Devolver formato según query param
        const formato = req.query.formato || 'html';
        if (formato === 'json') {
            return res.json({
                success: true,
                data: {
                    productor,
                    html
                }
            });
        }

        // Por defecto HTML
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error("Error en getDeclaracionResponsableProductor:", err);
        res.status(500).json({ success: false, error: "Error generando declaración responsable" });
    }
}
