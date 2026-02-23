
import { sql } from "../db.js";
import Anthropic from "@anthropic-ai/sdk";
import { extractFullPdfText } from "../services/ocr/ocrEngine.js";
import { saveToStorage } from "./storageController.js";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || ""
});

/**
 * Helper: obtener empresa_id del usuario
 */
async function getEmpresaId(userId) {
    const r = await sql`SELECT id FROM empresa_180 WHERE user_id=${userId} LIMIT 1`;
    if (!r[0]) {
        const e = new Error("Empresa no asociada");
        e.status = 403;
        throw e;
    }
    return r[0].id;
}

// =============================================
// 1. UPLOAD PDF RENTA ANTERIOR
// =============================================

/**
 * POST /admin/fiscal/renta/upload-pdf
 * Sube un PDF de la declaración de la renta anterior y extrae casillas clave con IA
 */
export async function uploadRentaPdf(req, res) {
    try {
        const file = req.file;
        const { ejercicio } = req.body;
        const userId = req.user.id;
        const empresaId = req.user.empresa_id || await getEmpresaId(userId);

        if (!file) return res.status(400).json({ error: "No se subió ningún archivo" });
        if (!ejercicio) return res.status(400).json({ error: "El ejercicio (año) es requerido" });

        const year = parseInt(ejercicio);
        if (isNaN(year) || year < 2000 || year > 2099) {
            return res.status(400).json({ error: "Ejercicio inválido" });
        }

        // 1. Extraer texto del PDF
        const pdfText = await extractFullPdfText(file.buffer, 30);

        if (!pdfText || pdfText.trim().length < 100) {
            return res.status(400).json({
                error: "No se pudo extraer texto suficiente del PDF. Asegúrate de que es un PDF de texto (no escaneado)."
            });
        }

        // 2. Usar Claude para extraer casillas + datos personales
        const systemPrompt = `Eres un experto fiscal español especializado en la Declaración de la Renta (Modelo 100 IRPF).
Tu tarea es extraer las casillas clave Y los datos personales/familiares de un PDF de declaración de la renta.

INSTRUCCIONES:
1. Busca e identifica las casillas con sus importes exactos.
2. Los importes deben ser números (sin símbolo €, sin puntos de miles, con punto decimal).
3. Si una casilla no aparece en el documento, pon 0.
4. Identifica si es declaración individual o conjunta.
5. Extrae TODOS los datos personales y familiares que aparezcan.

Responde EXCLUSIVAMENTE con este JSON:
{
    "tipo_declaracion": "individual" o "conjunta",
    "casilla_003": 0,
    "casilla_027": 0,
    "casilla_063": 0,
    "casilla_109": 0,
    "casilla_505": 0,
    "casilla_510": 0,
    "casilla_595": 0,
    "casilla_600": 0,
    "casilla_610": 0,
    "casilla_611": 0,
    "resultado_declaracion": 0,
    "retenciones_trabajo": 0,
    "retenciones_actividades": 0,
    "pagos_fraccionados": 0,
    "rendimientos_trabajo": 0,
    "rendimientos_actividades": 0,
    "rendimientos_capital_inmob": 0,
    "rendimientos_capital_mob": 0,
    "ganancias_patrimoniales": 0,
    "datos_personales": {
        "estado_civil": "soltero|casado|pareja_hecho|viudo|separado|divorciado",
        "fecha_nacimiento": "YYYY-MM-DD o null",
        "discapacidad_porcentaje": 0,
        "conyuge_nif": "string o null",
        "conyuge_nombre": "string o null",
        "conyuge_fecha_nacimiento": "YYYY-MM-DD o null",
        "conyuge_rendimientos": 0,
        "conyuge_discapacidad": 0,
        "descendientes": [
            {"nombre": "string", "fecha_nacimiento": "YYYY-MM-DD", "discapacidad_porcentaje": 0, "convivencia": true}
        ],
        "ascendientes": [
            {"nombre": "string", "fecha_nacimiento": "YYYY-MM-DD", "discapacidad_porcentaje": 0, "convivencia": true}
        ],
        "vivienda_tipo": "propiedad|alquiler|otro",
        "vivienda_referencia_catastral": "string o null",
        "alquiler_anual": 0,
        "hipoteca_anual": 0,
        "aportacion_plan_pensiones": 0,
        "donaciones_ong": 0,
        "donaciones_otras": 0
    },
    "confianza": 0.85,
    "notas": "Texto breve con observaciones"
}

CASILLAS CLAVE:
- 003: Rendimientos íntegros del trabajo
- 027: Rendimientos del capital mobiliario
- 063: Rendimientos del capital inmobiliario
- 109: Rendimiento neto de actividades económicas
- 505: Base imponible general
- 510: Base imponible del ahorro
- 595: Cuota íntegra estatal
- 600: Cuota íntegra autonómica
- 610: Cuota líquida total
- 611: Total deducciones
- Resultado: Cantidad final a ingresar (positivo) o devolver (negativo)

DATOS PERSONALES A EXTRAER:
- Estado civil del declarante (aparece en las primeras páginas)
- Fecha de nacimiento del declarante
- Grado de discapacidad (si aplica)
- Datos del cónyuge: NIF, nombre, fecha nacimiento, rendimientos, discapacidad
- Descendientes: nombre, fecha nacimiento, discapacidad, si convive
- Ascendientes a cargo: nombre, fecha nacimiento, discapacidad, si convive
- Vivienda habitual: tipo (propiedad/alquiler), referencia catastral
- Aportaciones a planes de pensiones
- Donaciones a ONGs y otras entidades
- Si no encuentras un dato personal, pon null o array vacío`;

        const response = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{
                role: "user",
                content: `Texto extraído de la Declaración de la Renta del ejercicio ${year}:\n\n${pdfText.substring(0, 20000)}`
            }]
        });

        const textContent = response.content.find(b => b.type === "text")?.text || "{}";
        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        const extracted = JSON.parse(jsonMatch ? jsonMatch[0] : textContent);

        // 3. Guardar PDF en storage
        const storageRecord = await saveToStorage({
            empresaId,
            nombre: file.originalname,
            buffer: file.buffer,
            folder: 'renta',
            mimeType: file.mimetype
        });

        // 4. Guardar o actualizar en BD
        const [existing] = await sql`
            SELECT id FROM renta_historica_180
            WHERE empresa_id = ${empresaId} AND ejercicio = ${year}
            AND tipo_declaracion = ${extracted.tipo_declaracion || 'individual'}
        `;

        let record;
        if (existing) {
            [record] = await sql`
                UPDATE renta_historica_180 SET
                    casilla_505 = ${extracted.casilla_505 || 0},
                    casilla_510 = ${extracted.casilla_510 || 0},
                    casilla_595 = ${extracted.casilla_595 || 0},
                    casilla_600 = ${extracted.casilla_600 || 0},
                    casilla_610 = ${extracted.casilla_610 || 0},
                    casilla_611 = ${extracted.casilla_611 || 0},
                    resultado_declaracion = ${extracted.resultado_declaracion || 0},
                    rendimientos_trabajo = ${extracted.rendimientos_trabajo || extracted.casilla_003 || 0},
                    rendimientos_actividades = ${extracted.rendimientos_actividades || extracted.casilla_109 || 0},
                    rendimientos_capital_inmob = ${extracted.rendimientos_capital_inmob || extracted.casilla_063 || 0},
                    rendimientos_capital_mob = ${extracted.rendimientos_capital_mob || extracted.casilla_027 || 0},
                    ganancias_patrimoniales = ${extracted.ganancias_patrimoniales || 0},
                    retenciones_trabajo = ${extracted.retenciones_trabajo || 0},
                    retenciones_actividades = ${extracted.retenciones_actividades || 0},
                    pagos_fraccionados = ${extracted.pagos_fraccionados || 0},
                    tipo_declaracion = ${extracted.tipo_declaracion || 'individual'},
                    pdf_storage_path = ${storageRecord?.storage_path || null},
                    pdf_nombre_archivo = ${file.originalname},
                    pdf_fecha_importacion = NOW(),
                    datos_extraidos_json = ${sql.json(extracted)},
                    confianza_extraccion = ${extracted.confianza || 0},
                    updated_at = NOW()
                WHERE id = ${existing.id}
                RETURNING *
            `;
        } else {
            [record] = await sql`
                INSERT INTO renta_historica_180 (
                    empresa_id, ejercicio, tipo_declaracion,
                    casilla_505, casilla_510, casilla_595, casilla_600, casilla_610, casilla_611,
                    resultado_declaracion, rendimientos_trabajo, rendimientos_actividades,
                    rendimientos_capital_inmob, rendimientos_capital_mob, ganancias_patrimoniales,
                    retenciones_trabajo, retenciones_actividades, pagos_fraccionados,
                    pdf_storage_path, pdf_nombre_archivo, datos_extraidos_json, confianza_extraccion
                ) VALUES (
                    ${empresaId}, ${year}, ${extracted.tipo_declaracion || 'individual'},
                    ${extracted.casilla_505 || 0}, ${extracted.casilla_510 || 0},
                    ${extracted.casilla_595 || 0}, ${extracted.casilla_600 || 0},
                    ${extracted.casilla_610 || 0}, ${extracted.casilla_611 || 0},
                    ${extracted.resultado_declaracion || 0},
                    ${extracted.rendimientos_trabajo || extracted.casilla_003 || 0},
                    ${extracted.rendimientos_actividades || extracted.casilla_109 || 0},
                    ${extracted.rendimientos_capital_inmob || extracted.casilla_063 || 0},
                    ${extracted.rendimientos_capital_mob || extracted.casilla_027 || 0},
                    ${extracted.ganancias_patrimoniales || 0},
                    ${extracted.retenciones_trabajo || 0},
                    ${extracted.retenciones_actividades || 0},
                    ${extracted.pagos_fraccionados || 0},
                    ${storageRecord?.storage_path || null}, ${file.originalname},
                    ${sql.json(extracted)}, ${extracted.confianza || 0}
                )
                RETURNING *
            `;
        }

        // 5. Auto-guardar datos personales extraídos del PDF (si hay)
        let datosPersonalesGuardados = false;
        const dp = extracted.datos_personales;
        if (dp && (dp.estado_civil || dp.conyuge_nif || (dp.descendientes && dp.descendientes.length > 0))) {
            try {
                const [existingDp] = await sql`
                    SELECT id FROM renta_datos_personales_180 WHERE empresa_id = ${empresaId}
                `;

                if (existingDp) {
                    await sql`
                        UPDATE renta_datos_personales_180 SET
                            estado_civil = COALESCE(${dp.estado_civil || null}, estado_civil),
                            fecha_nacimiento = COALESCE(${dp.fecha_nacimiento || null}, fecha_nacimiento),
                            discapacidad_porcentaje = COALESCE(${dp.discapacidad_porcentaje || null}, discapacidad_porcentaje),
                            conyuge_nif = COALESCE(${dp.conyuge_nif || null}, conyuge_nif),
                            conyuge_nombre = COALESCE(${dp.conyuge_nombre || null}, conyuge_nombre),
                            conyuge_fecha_nacimiento = COALESCE(${dp.conyuge_fecha_nacimiento || null}, conyuge_fecha_nacimiento),
                            conyuge_rendimientos = COALESCE(${dp.conyuge_rendimientos || null}, conyuge_rendimientos),
                            conyuge_discapacidad = COALESCE(${dp.conyuge_discapacidad || null}, conyuge_discapacidad),
                            descendientes = CASE WHEN ${(dp.descendientes || []).length > 0} THEN ${sql.json(dp.descendientes || [])} ELSE descendientes END,
                            ascendientes = CASE WHEN ${(dp.ascendientes || []).length > 0} THEN ${sql.json(dp.ascendientes || [])} ELSE ascendientes END,
                            vivienda_tipo = COALESCE(${dp.vivienda_tipo || null}, vivienda_tipo),
                            vivienda_referencia_catastral = COALESCE(${dp.vivienda_referencia_catastral || null}, vivienda_referencia_catastral),
                            alquiler_anual = COALESCE(${dp.alquiler_anual || null}, alquiler_anual),
                            hipoteca_anual = COALESCE(${dp.hipoteca_anual || null}, hipoteca_anual),
                            aportacion_plan_pensiones = COALESCE(${dp.aportacion_plan_pensiones || null}, aportacion_plan_pensiones),
                            donaciones_ong = COALESCE(${dp.donaciones_ong || null}, donaciones_ong),
                            donaciones_otras = COALESCE(${dp.donaciones_otras || null}, donaciones_otras),
                            tipo_declaracion_preferida = ${extracted.tipo_declaracion || 'individual'},
                            updated_at = NOW()
                        WHERE id = ${existingDp.id}
                    `;
                } else {
                    await sql`
                        INSERT INTO renta_datos_personales_180 (
                            empresa_id, estado_civil, fecha_nacimiento, discapacidad_porcentaje,
                            conyuge_nif, conyuge_nombre, conyuge_fecha_nacimiento,
                            conyuge_rendimientos, conyuge_discapacidad,
                            descendientes, ascendientes,
                            vivienda_tipo, vivienda_referencia_catastral,
                            alquiler_anual, hipoteca_anual,
                            aportacion_plan_pensiones, donaciones_ong, donaciones_otras,
                            tipo_declaracion_preferida
                        ) VALUES (
                            ${empresaId}, ${dp.estado_civil || 'soltero'}, ${dp.fecha_nacimiento || null},
                            ${dp.discapacidad_porcentaje || 0},
                            ${dp.conyuge_nif || null}, ${dp.conyuge_nombre || null},
                            ${dp.conyuge_fecha_nacimiento || null},
                            ${dp.conyuge_rendimientos || 0}, ${dp.conyuge_discapacidad || 0},
                            ${sql.json(dp.descendientes || [])}, ${sql.json(dp.ascendientes || [])},
                            ${dp.vivienda_tipo || 'propiedad'}, ${dp.vivienda_referencia_catastral || null},
                            ${dp.alquiler_anual || 0}, ${dp.hipoteca_anual || 0},
                            ${dp.aportacion_plan_pensiones || 0}, ${dp.donaciones_ong || 0}, ${dp.donaciones_otras || 0},
                            ${extracted.tipo_declaracion || 'individual'}
                        )
                    `;
                }
                datosPersonalesGuardados = true;
            } catch (dpError) {
                console.error("Error guardando datos personales extraídos:", dpError);
            }
        }

        res.json({
            success: true,
            data: record,
            extraccion: {
                confianza: extracted.confianza || 0,
                notas: extracted.notas || '',
                tipo_declaracion: extracted.tipo_declaracion || 'individual',
                datos_personales_extraidos: datosPersonalesGuardados
            }
        });

    } catch (error) {
        console.error("Error uploadRentaPdf:", error);
        res.status(500).json({ success: false, error: "Error al procesar el PDF de la renta" });
    }
}

// =============================================
// 2. DATOS PERSONALES / FAMILIARES
// =============================================

/**
 * GET /admin/fiscal/renta/datos-personales
 */
export async function getDatosPersonales(req, res) {
    try {
        const empresaId = req.user.empresa_id || await getEmpresaId(req.user.id);

        const [datos] = await sql`
            SELECT * FROM renta_datos_personales_180 WHERE empresa_id = ${empresaId}
        `;

        res.json({ success: true, data: datos || null });
    } catch (error) {
        console.error("Error getDatosPersonales:", error);
        res.status(500).json({ success: false, error: "Error obteniendo datos personales" });
    }
}

/**
 * POST /admin/fiscal/renta/datos-personales
 * Crear o actualizar datos personales/familiares
 */
export async function saveDatosPersonales(req, res) {
    try {
        const empresaId = req.user.empresa_id || await getEmpresaId(req.user.id);
        const {
            estado_civil, fecha_nacimiento, discapacidad_porcentaje,
            conyuge_nif, conyuge_nombre, conyuge_fecha_nacimiento,
            conyuge_rendimientos, conyuge_discapacidad,
            descendientes, ascendientes,
            vivienda_tipo, vivienda_referencia_catastral,
            alquiler_anual, hipoteca_anual, hipoteca_fecha_compra,
            aportacion_plan_pensiones,
            donaciones_ong, donaciones_otras,
            deducciones_autonomicas,
            tipo_declaracion_preferida
        } = req.body;

        const [existing] = await sql`
            SELECT id FROM renta_datos_personales_180 WHERE empresa_id = ${empresaId}
        `;

        let record;
        if (existing) {
            [record] = await sql`
                UPDATE renta_datos_personales_180 SET
                    estado_civil = ${estado_civil || 'soltero'},
                    fecha_nacimiento = ${fecha_nacimiento || null},
                    discapacidad_porcentaje = ${discapacidad_porcentaje || 0},
                    conyuge_nif = ${conyuge_nif || null},
                    conyuge_nombre = ${conyuge_nombre || null},
                    conyuge_fecha_nacimiento = ${conyuge_fecha_nacimiento || null},
                    conyuge_rendimientos = ${conyuge_rendimientos || 0},
                    conyuge_discapacidad = ${conyuge_discapacidad || 0},
                    descendientes = ${sql.json(descendientes || [])},
                    ascendientes = ${sql.json(ascendientes || [])},
                    vivienda_tipo = ${vivienda_tipo || 'propiedad'},
                    vivienda_referencia_catastral = ${vivienda_referencia_catastral || null},
                    alquiler_anual = ${alquiler_anual || 0},
                    hipoteca_anual = ${hipoteca_anual || 0},
                    hipoteca_fecha_compra = ${hipoteca_fecha_compra || null},
                    aportacion_plan_pensiones = ${aportacion_plan_pensiones || 0},
                    donaciones_ong = ${donaciones_ong || 0},
                    donaciones_otras = ${donaciones_otras || 0},
                    deducciones_autonomicas = ${sql.json(deducciones_autonomicas || {})},
                    tipo_declaracion_preferida = ${tipo_declaracion_preferida || 'individual'},
                    updated_at = NOW()
                WHERE id = ${existing.id}
                RETURNING *
            `;
        } else {
            [record] = await sql`
                INSERT INTO renta_datos_personales_180 (
                    empresa_id, estado_civil, fecha_nacimiento, discapacidad_porcentaje,
                    conyuge_nif, conyuge_nombre, conyuge_fecha_nacimiento,
                    conyuge_rendimientos, conyuge_discapacidad,
                    descendientes, ascendientes,
                    vivienda_tipo, vivienda_referencia_catastral,
                    alquiler_anual, hipoteca_anual, hipoteca_fecha_compra,
                    aportacion_plan_pensiones, donaciones_ong, donaciones_otras,
                    deducciones_autonomicas, tipo_declaracion_preferida
                ) VALUES (
                    ${empresaId}, ${estado_civil || 'soltero'}, ${fecha_nacimiento || null},
                    ${discapacidad_porcentaje || 0},
                    ${conyuge_nif || null}, ${conyuge_nombre || null},
                    ${conyuge_fecha_nacimiento || null},
                    ${conyuge_rendimientos || 0}, ${conyuge_discapacidad || 0},
                    ${sql.json(descendientes || [])}, ${sql.json(ascendientes || [])},
                    ${vivienda_tipo || 'propiedad'}, ${vivienda_referencia_catastral || null},
                    ${alquiler_anual || 0}, ${hipoteca_anual || 0}, ${hipoteca_fecha_compra || null},
                    ${aportacion_plan_pensiones || 0}, ${donaciones_ong || 0}, ${donaciones_otras || 0},
                    ${sql.json(deducciones_autonomicas || {})},
                    ${tipo_declaracion_preferida || 'individual'}
                )
                RETURNING *
            `;
        }

        res.json({ success: true, data: record });
    } catch (error) {
        console.error("Error saveDatosPersonales:", error);
        res.status(500).json({ success: false, error: "Error guardando datos personales" });
    }
}

// =============================================
// 3. HISTORIAL RENTAS
// =============================================

/**
 * GET /admin/fiscal/renta/historial
 * Lista todas las rentas importadas
 */
export async function getHistorialRentas(req, res) {
    try {
        const empresaId = req.user.empresa_id || await getEmpresaId(req.user.id);

        const rentas = await sql`
            SELECT id, ejercicio, tipo_declaracion, resultado_declaracion,
                   casilla_505, casilla_610, rendimientos_trabajo, rendimientos_actividades,
                   pdf_nombre_archivo, confianza_extraccion, created_at, updated_at
            FROM renta_historica_180
            WHERE empresa_id = ${empresaId}
            ORDER BY ejercicio DESC
        `;

        res.json({ success: true, data: rentas });
    } catch (error) {
        console.error("Error getHistorialRentas:", error);
        res.status(500).json({ success: false, error: "Error obteniendo historial de rentas" });
    }
}

/**
 * GET /admin/fiscal/renta/historial/:ejercicio
 * Detalle completo de una renta
 */
export async function getRentaDetalle(req, res) {
    try {
        const empresaId = req.user.empresa_id || await getEmpresaId(req.user.id);
        const { ejercicio } = req.params;

        const [renta] = await sql`
            SELECT * FROM renta_historica_180
            WHERE empresa_id = ${empresaId} AND ejercicio = ${parseInt(ejercicio)}
        `;

        if (!renta) return res.status(404).json({ error: "Renta no encontrada para ese ejercicio" });

        res.json({ success: true, data: renta });
    } catch (error) {
        console.error("Error getRentaDetalle:", error);
        res.status(500).json({ success: false, error: "Error obteniendo detalle de renta" });
    }
}

/**
 * DELETE /admin/fiscal/renta/historial/:ejercicio
 */
export async function deleteRenta(req, res) {
    try {
        const empresaId = req.user.empresa_id || await getEmpresaId(req.user.id);
        const { ejercicio } = req.params;

        const [deleted] = await sql`
            DELETE FROM renta_historica_180
            WHERE empresa_id = ${empresaId} AND ejercicio = ${parseInt(ejercicio)}
            RETURNING id
        `;

        if (!deleted) return res.status(404).json({ error: "Renta no encontrada" });

        res.json({ success: true });
    } catch (error) {
        console.error("Error deleteRenta:", error);
        res.status(500).json({ success: false, error: "Error eliminando renta" });
    }
}

/**
 * PUT /admin/fiscal/renta/historial/:ejercicio
 * Editar casillas de una renta importada
 */
export async function updateRenta(req, res) {
    try {
        const empresaId = req.user.empresa_id || await getEmpresaId(req.user.id);
        const { ejercicio } = req.params;
        const {
            casilla_505, casilla_510, casilla_595, casilla_600, casilla_610, casilla_611,
            resultado_declaracion, rendimientos_trabajo, rendimientos_actividades,
            rendimientos_capital_inmob, rendimientos_capital_mob, ganancias_patrimoniales,
            retenciones_trabajo, retenciones_actividades, pagos_fraccionados,
            tipo_declaracion
        } = req.body;

        const [record] = await sql`
            UPDATE renta_historica_180 SET
                casilla_505 = ${casilla_505 ?? 0},
                casilla_510 = ${casilla_510 ?? 0},
                casilla_595 = ${casilla_595 ?? 0},
                casilla_600 = ${casilla_600 ?? 0},
                casilla_610 = ${casilla_610 ?? 0},
                casilla_611 = ${casilla_611 ?? 0},
                resultado_declaracion = ${resultado_declaracion ?? 0},
                rendimientos_trabajo = ${rendimientos_trabajo ?? 0},
                rendimientos_actividades = ${rendimientos_actividades ?? 0},
                rendimientos_capital_inmob = ${rendimientos_capital_inmob ?? 0},
                rendimientos_capital_mob = ${rendimientos_capital_mob ?? 0},
                ganancias_patrimoniales = ${ganancias_patrimoniales ?? 0},
                retenciones_trabajo = ${retenciones_trabajo ?? 0},
                retenciones_actividades = ${retenciones_actividades ?? 0},
                pagos_fraccionados = ${pagos_fraccionados ?? 0},
                tipo_declaracion = ${tipo_declaracion || 'individual'},
                updated_at = NOW()
            WHERE empresa_id = ${empresaId} AND ejercicio = ${parseInt(ejercicio)}
            RETURNING *
        `;

        if (!record) return res.status(404).json({ error: "Renta no encontrada" });

        res.json({ success: true, data: record });
    } catch (error) {
        console.error("Error updateRenta:", error);
        res.status(500).json({ success: false, error: "Error actualizando renta" });
    }
}

// =============================================
// 4. DOSSIER PRE-RENTA
// =============================================

/**
 * GET /admin/fiscal/renta/dossier/:ejercicio
 * Genera un dossier completo combinando datos de CONTENDO + renta anterior + datos personales
 */
export async function generarDossier(req, res) {
    try {
        const empresaId = req.user.empresa_id || await getEmpresaId(req.user.id);
        const { ejercicio } = req.params;
        const year = parseInt(ejercicio);

        // 1. Datos personales
        const [datosPersonales] = await sql`
            SELECT * FROM renta_datos_personales_180 WHERE empresa_id = ${empresaId}
        `;

        // 2. Renta anterior (si existe)
        const [rentaAnterior] = await sql`
            SELECT * FROM renta_historica_180
            WHERE empresa_id = ${empresaId} AND ejercicio = ${year - 1}
        `;

        // 3. Datos del emisor
        const [emisor] = await sql`SELECT * FROM emisor_180 WHERE empresa_id = ${empresaId}`;

        // 4. Facturas emitidas en el ejercicio (rendimientos actividades)
        const [facturacion] = await sql`
            SELECT
                COALESCE(SUM(subtotal), 0) as base_total,
                COALESCE(SUM(iva_total), 0) as iva_total,
                COALESCE(SUM(total), 0) as total,
                COALESCE(SUM(retencion_importe), 0) as retenciones_clientes,
                COUNT(*) as num_facturas
            FROM factura_180
            WHERE empresa_id = ${empresaId}
            AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND EXTRACT(YEAR FROM fecha) = ${year}
        `;

        // 5. Gastos deducibles en el ejercicio
        const [gastos] = await sql`
            SELECT
                COALESCE(SUM(base_imponible), 0) as base_total,
                COALESCE(SUM(cuota_iva), 0) as iva_soportado,
                COALESCE(SUM(total), 0) as total,
                COUNT(*) as num_gastos
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND EXTRACT(YEAR FROM fecha_compra) = ${year}
        `;

        // 6. Nóminas (si tiene empleados = costes de personal)
        const [nominas] = await sql`
            SELECT
                COALESCE(SUM(bruto), 0) as bruto_total,
                COALESCE(SUM(irpf_retencion), 0) as irpf_total,
                COALESCE(SUM(seguridad_social_empresa), 0) as ss_empresa,
                COUNT(*) as num_nominas
            FROM nominas_180
            WHERE empresa_id = ${empresaId} AND anio = ${year}
        `;

        // 7. Pagos fraccionados realizados (Modelo 130) - tabla puede no existir aún
        let pagos130 = [];
        let totalPagosFraccionados = 0;
        try {
            pagos130 = await sql`
                SELECT trimestre, resultado_declaracion as importe
                FROM fiscal_presentaciones_180
                WHERE empresa_id = ${empresaId} AND modelo = '130' AND ejercicio = ${year}
                ORDER BY trimestre ASC
            `;
            totalPagosFraccionados = pagos130.reduce((sum, p) => sum + parseFloat(p.importe || 0), 0);
        } catch (e) {
            // Tabla aún no existe, ignorar
        }

        // 8. Retenciones soportadas por actividades profesionales
        const [retencionesActividades] = await sql`
            SELECT COALESCE(SUM(retencion_importe), 0) as total
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND retencion_importe > 0
            AND EXTRACT(YEAR FROM fecha_compra) = ${year}
        `;

        // Calcular rendimiento neto estimado
        const ingresos = parseFloat(facturacion.base_total);
        const gastosDeducibles = parseFloat(gastos.base_total) + parseFloat(nominas.bruto_total) + parseFloat(nominas.ss_empresa);
        const rendimientoNeto = ingresos - gastosDeducibles;

        const dossier = {
            ejercicio: year,
            empresa: {
                nombre: emisor?.nombre || '',
                nif: emisor?.nif || '',
                actividad: emisor?.nombre_comercial || ''
            },
            datos_personales: datosPersonales || null,
            renta_anterior: rentaAnterior ? {
                ejercicio: rentaAnterior.ejercicio,
                resultado: parseFloat(rentaAnterior.resultado_declaracion),
                casilla_505: parseFloat(rentaAnterior.casilla_505),
                casilla_610: parseFloat(rentaAnterior.casilla_610),
                tipo_declaracion: rentaAnterior.tipo_declaracion
            } : null,
            rendimientos_actividades: {
                ingresos: ingresos,
                gastos_deducibles: gastosDeducibles,
                detalle_gastos: {
                    compras_servicios: parseFloat(gastos.base_total),
                    nominas: parseFloat(nominas.bruto_total),
                    seguridad_social_empresa: parseFloat(nominas.ss_empresa)
                },
                rendimiento_neto: rendimientoNeto,
                num_facturas: parseInt(facturacion.num_facturas),
                num_gastos: parseInt(gastos.num_gastos)
            },
            retenciones_y_pagos: {
                retenciones_clientes: parseFloat(facturacion.retenciones_clientes),
                retenciones_actividades: parseFloat(retencionesActividades.total),
                pagos_fraccionados: totalPagosFraccionados,
                detalle_130: pagos130,
                total_anticipado: parseFloat(facturacion.retenciones_clientes) + parseFloat(retencionesActividades.total) + totalPagosFraccionados
            },
            iva_anual: {
                repercutido: parseFloat(facturacion.iva_total),
                soportado: parseFloat(gastos.iva_soportado),
                diferencia: parseFloat(facturacion.iva_total) - parseFloat(gastos.iva_soportado)
            },
            personal: {
                num_empleados: parseInt(nominas.num_nominas) > 0 ? Math.ceil(parseInt(nominas.num_nominas) / 12) : 0,
                coste_nominas: parseFloat(nominas.bruto_total),
                ss_empresa: parseFloat(nominas.ss_empresa),
                irpf_retenido_nominas: parseFloat(nominas.irpf_total)
            },
            resumen: {
                rendimiento_neto_estimado: rendimientoNeto,
                total_anticipado: parseFloat(facturacion.retenciones_clientes) + parseFloat(retencionesActividades.total) + totalPagosFraccionados,
                nota: rendimientoNeto > 0
                    ? `Rendimiento neto positivo de ${rendimientoNeto.toFixed(2)}€. Se han anticipado ${(parseFloat(facturacion.retenciones_clientes) + totalPagosFraccionados).toFixed(2)}€ en retenciones y pagos fraccionados.`
                    : `Rendimiento neto negativo (pérdidas) de ${rendimientoNeto.toFixed(2)}€.`
            }
        };

        res.json({ success: true, data: dossier });

    } catch (error) {
        console.error("Error generarDossier:", error);
        res.status(500).json({ success: false, error: "Error generando dossier pre-renta" });
    }
}
