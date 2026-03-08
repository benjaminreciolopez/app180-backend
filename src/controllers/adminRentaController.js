
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

        // 1. Extraer texto del PDF con layout preservado (posiciones X/Y para casillas)
        const pdfText = await extractFullPdfText(file.buffer, 30, null, { preserveLayout: true });

        if (!pdfText || pdfText.trim().length < 100) {
            return res.status(400).json({
                error: "No se pudo extraer texto suficiente del PDF. Asegúrate de que es un PDF de texto (no escaneado)."
            });
        }

        // 2. Usar Claude Sonnet para extraer casillas + datos personales
        const systemPrompt = `Eres un experto fiscal español especializado en la Declaración de la Renta (Modelo 100 IRPF de la AEAT).
Tu tarea es extraer con MÁXIMA PRECISIÓN las casillas clave y los datos personales de un PDF de declaración de renta.

## FORMATO DEL PDF DE LA AEAT (Modelo 100)
El PDF de la declaración de la renta de la AEAT tiene un formato muy específico:
- Las casillas se identifican con NÚMEROS DE 3 DÍGITOS entre corchetes [xxx] o precedidos del texto "Casilla" o simplemente como número seguido de un importe.
- Los formatos típicos de casilla son:
  * "[003]  25.432,18" → Casilla 003 con valor 25432.18
  * "003    25.432,18" → Casilla 003 con valor 25432.18
  * "Casilla 003: 25.432,18" → Casilla 003 con valor 25432.18
  * "Rendimientos del trabajo [003]    25.432,18"
- Los importes en el PDF de la AEAT usan formato ESPAÑOL: punto para miles, coma para decimales.
  * "25.432,18" → 25432.18
  * "1.234,56" → 1234.56
  * "432,00" → 432.00
  * "-1.500,00" → -1500.00 (negativo)
- El PDF tiene secciones: Datos personales, Rendimientos del trabajo, Capital mobiliario, Capital inmobiliario,
  Actividades económicas, Ganancias patrimoniales, Base imponible, Cuota íntegra, Deducciones, Resultado.
- Las primeras páginas contienen datos personales (NIF, nombre, dirección, estado civil, cónyuge, descendientes).
- Las páginas centrales tienen las casillas de ingresos, gastos y deducciones.
- Las últimas páginas tienen el resumen: base imponible, cuota, retenciones y resultado final.

## CASILLAS PRINCIPALES A EXTRAER (busca específicamente estos números de casilla)
| Casilla | Concepto | Sección del PDF |
|---------|----------|-----------------|
| 003 | Rendimientos íntegros del trabajo | Rendimientos del trabajo |
| 012 | Retenciones del trabajo | Rendimientos del trabajo |
| 015 | Rendimiento neto del trabajo | Rendimientos del trabajo |
| 027 | Rendimientos del capital mobiliario | Capital mobiliario |
| 028 | Retenciones capital mobiliario | Capital mobiliario |
| 063 | Rendimientos del capital inmobiliario (imputación) | Capital inmobiliario |
| 109 | Rendimiento neto actividades económicas (estimación directa) | Actividades económicas |
| 110 | Rendimiento neto actividades económicas (estimación objetiva) | Actividades económicas |
| 130 | Retenciones de actividades económicas | Actividades económicas |
| 231 | Ganancias patrimoniales sometidas a retención | Ganancias y pérdidas |
| 235 | Ganancias patrimoniales no sometidas a retención | Ganancias y pérdidas |
| 366 | Saldo neto ganancias/pérdidas base general | Ganancias y pérdidas |
| 420 | Saldo neto ganancias/pérdidas base ahorro | Ganancias y pérdidas |
| 435 | Base imponible general | Determinación de la base |
| 460 | Base imponible del ahorro | Determinación de la base |
| 505 | Base liquidable general | Adecuación del impuesto |
| 510 | Base liquidable del ahorro | Adecuación del impuesto |
| 520 | Mínimo personal y familiar | Adecuación del impuesto |
| 595 | Cuota íntegra estatal | Cálculo del impuesto |
| 600 | Cuota íntegra autonómica | Cálculo del impuesto |
| 609 | Cuota líquida estatal | Cuota líquida |
| 610 | Cuota líquida total | Cuota líquida |
| 611 | Total deducciones de la cuota | Deducciones |
| 618 | Deducción vivienda habitual | Deducciones |
| 623 | Deducción donativos | Deducciones |
| 595 | Cuota resultante autoliquidación | Resultado |
| 670 | Retenciones y demás pagos a cuenta | Resultado |
| 695 | Resultado de la declaración | Resultado final |

## INSTRUCCIONES DE EXTRACCIÓN
1. Busca CADA número de casilla en el texto. Los números de casilla son siempre 3 dígitos (003, 027, 505, etc.).
2. El valor de la casilla suele estar a la DERECHA del número de casilla, en la misma línea o separado por espacios/tabulaciones.
3. Convierte importes españoles a número: "25.432,18" → 25432.18, "1.500,00" → 1500.00
4. Si un número aparece con signo negativo (- o entre paréntesis), devuélvelo como negativo.
5. Si una casilla NO aparece en el documento, pon 0 (no inventes valores).
6. Busca también el texto "A INGRESAR" o "A DEVOLVER" cerca del resultado final.

## FORMATO DE RESPUESTA
Responde EXCLUSIVAMENTE con un JSON válido (sin explicaciones ni texto extra):
{
    "tipo_declaracion": "individual|conjunta",
    "casillas": {
        "003": 0, "012": 0, "015": 0, "027": 0, "028": 0, "063": 0,
        "109": 0, "110": 0, "130": 0, "231": 0, "235": 0, "366": 0,
        "420": 0, "435": 0, "460": 0, "505": 0, "510": 0, "520": 0,
        "595": 0, "600": 0, "609": 0, "610": 0, "611": 0, "618": 0,
        "623": 0, "670": 0, "695": 0
    },
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
    "casillas_extra": {},
    "confianza": 0.85,
    "notas": "Observaciones sobre la extracción"
}

IMPORTANTE para "casillas_extra": Si encuentras CUALQUIER otra casilla con valor > 0 que no esté en la lista principal,
inclúyela en "casillas_extra" con formato { "NNN": valor }. Esto permite capturar casillas que varían entre declaraciones.`;

        // Enviar TODO el texto (Sonnet maneja hasta 200K tokens), sin truncar
        const textToSend = pdfText.length > 150000 ? pdfText.substring(0, 150000) : pdfText;

        const response = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 8192,
            system: systemPrompt,
            messages: [{
                role: "user",
                content: `Analiza este texto extraído de la Declaración de la Renta (Modelo 100 IRPF) del ejercicio ${year}.\n\nEXTRAE TODAS las casillas con sus valores numéricos exactos. Presta especial atención a los números de casilla (3 dígitos) y sus importes asociados.\n\n---\n${textToSend}`
            }]
        });

        // Parsear JSON con manejo robusto de errores
        const rawText = response.content.find(b => b.type === "text")?.text || "{}";
        let extracted;
        try {
            // Intentar parsear directamente
            extracted = JSON.parse(rawText);
        } catch {
            // Si falla, buscar el JSON dentro del texto (puede tener texto antes/después)
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    extracted = JSON.parse(jsonMatch[0]);
                } catch (e2) {
                    // Limpiar posibles caracteres problemáticos y reintentar
                    const cleaned = jsonMatch[0]
                        .replace(/,\s*}/g, '}')           // trailing commas
                        .replace(/,\s*]/g, ']')            // trailing commas en arrays
                        .replace(/[\x00-\x1F\x7F]/g, ' ') // caracteres de control
                        .replace(/"""/g, '"');              // triple quotes
                    try {
                        extracted = JSON.parse(cleaned);
                    } catch (e3) {
                        console.error("Error parseando JSON de Claude. Raw:", rawText.substring(0, 500));
                        return res.status(500).json({
                            success: false,
                            error: "La IA no pudo devolver datos válidos. Intenta subir el PDF de nuevo.",
                            debug_raw: process.env.NODE_ENV === 'development' ? rawText.substring(0, 1000) : undefined
                        });
                    }
                }
            } else {
                console.error("No se encontró JSON en respuesta de Claude:", rawText.substring(0, 500));
                return res.status(500).json({
                    success: false,
                    error: "La IA no devolvió datos estructurados. Intenta subir el PDF de nuevo."
                });
            }
        }

        // Mapear casillas del nuevo formato al formato de BD
        const casillas = extracted.casillas || {};
        extracted.casilla_003 = casillas["003"] || extracted.casilla_003 || 0;
        extracted.casilla_027 = casillas["027"] || extracted.casilla_027 || 0;
        extracted.casilla_063 = casillas["063"] || extracted.casilla_063 || 0;
        extracted.casilla_109 = casillas["109"] || extracted.casilla_109 || 0;
        extracted.casilla_505 = casillas["505"] || extracted.casilla_505 || 0;
        extracted.casilla_510 = casillas["510"] || extracted.casilla_510 || 0;
        extracted.casilla_595 = casillas["595"] || extracted.casilla_595 || 0;
        extracted.casilla_600 = casillas["600"] || extracted.casilla_600 || 0;
        extracted.casilla_610 = casillas["610"] || extracted.casilla_610 || 0;
        extracted.casilla_611 = casillas["611"] || extracted.casilla_611 || 0;

        // Mapear campos de rendimientos desde casillas si no vienen directamente
        if (!extracted.rendimientos_trabajo && casillas["003"]) extracted.rendimientos_trabajo = casillas["003"];
        if (!extracted.rendimientos_actividades && casillas["109"]) extracted.rendimientos_actividades = casillas["109"];
        if (!extracted.rendimientos_capital_inmob && casillas["063"]) extracted.rendimientos_capital_inmob = casillas["063"];
        if (!extracted.rendimientos_capital_mob && casillas["027"]) extracted.rendimientos_capital_mob = casillas["027"];
        if (!extracted.retenciones_trabajo && casillas["012"]) extracted.retenciones_trabajo = casillas["012"];
        if (!extracted.retenciones_actividades && casillas["130"]) extracted.retenciones_actividades = casillas["130"];
        if (!extracted.resultado_declaracion && casillas["695"]) extracted.resultado_declaracion = casillas["695"];

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
// 4. SIMULADOR IRPF - CÁLCULO DE TRAMOS
// =============================================

/**
 * Tramos IRPF estatal + autonómico 2025/2026 (general España)
 * El IRPF se divide: ~50% estatal, ~50% autonómico
 * Estos son los tramos de la escala general (Ley 35/2006, actualizada)
 */
const TRAMOS_IRPF_ESTATAL = [
    { hasta: 12450,  tipo: 9.50 },
    { hasta: 20200,  tipo: 12.00 },
    { hasta: 35200,  tipo: 15.00 },
    { hasta: 60000,  tipo: 18.50 },
    { hasta: 300000, tipo: 22.50 },
    { hasta: Infinity, tipo: 24.50 },
];

const TRAMOS_IRPF_AUTONOMICO = [
    { hasta: 12450,  tipo: 9.50 },
    { hasta: 20200,  tipo: 12.00 },
    { hasta: 35200,  tipo: 15.00 },
    { hasta: 60000,  tipo: 18.50 },
    { hasta: 300000, tipo: 22.50 },
    { hasta: Infinity, tipo: 22.50 },
];

/**
 * Calcula cuota por tramos progresivos
 */
function calcularCuotaTramos(baseImponible, tramos) {
    let cuota = 0;
    let baseRestante = baseImponible;
    let limiteAnterior = 0;
    const desglose = [];

    for (const tramo of tramos) {
        if (baseRestante <= 0) break;

        const anchoTramo = tramo.hasta === Infinity
            ? baseRestante
            : tramo.hasta - limiteAnterior;
        const baseEnTramo = Math.min(baseRestante, anchoTramo);
        const cuotaTramo = baseEnTramo * tramo.tipo / 100;

        desglose.push({
            desde: limiteAnterior,
            hasta: tramo.hasta === Infinity ? null : tramo.hasta,
            tipo: tramo.tipo,
            base: Math.round(baseEnTramo * 100) / 100,
            cuota: Math.round(cuotaTramo * 100) / 100,
        });

        cuota += cuotaTramo;
        baseRestante -= baseEnTramo;
        limiteAnterior = tramo.hasta === Infinity ? limiteAnterior : tramo.hasta;
    }

    return { cuota: Math.round(cuota * 100) / 100, desglose };
}

/**
 * Reducciones personales y familiares (mínimo personal/familiar)
 */
function calcularMinimosPersonales(datosPersonales) {
    let minimo = 5550; // Mínimo personal general

    if (!datosPersonales) return minimo;

    // Edad > 65 años
    if (datosPersonales.fecha_nacimiento) {
        const nacimiento = new Date(datosPersonales.fecha_nacimiento);
        const edad = Math.floor((Date.now() - nacimiento.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        if (edad >= 75) minimo += 1400;
        else if (edad >= 65) minimo += 1150;
    }

    // Discapacidad declarante
    const disc = datosPersonales.discapacidad_porcentaje || 0;
    if (disc >= 65) minimo += 12000;
    else if (disc >= 33) minimo += 3000;

    // Descendientes
    const descendientes = datosPersonales.descendientes || [];
    descendientes.forEach((d, i) => {
        const nacDesc = d.fecha_nacimiento ? new Date(d.fecha_nacimiento) : null;
        const edadDesc = nacDesc
            ? Math.floor((Date.now() - nacDesc.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
            : 99;

        if (edadDesc < 25 || (d.discapacidad_porcentaje && d.discapacidad_porcentaje >= 33)) {
            // Mínimo por descendientes según orden
            const minimosDesc = [2400, 2700, 4000, 4500]; // 1º, 2º, 3º, 4º y siguientes
            minimo += minimosDesc[Math.min(i, 3)];

            // Menor de 3 años: +2800
            if (edadDesc < 3) minimo += 2800;

            // Discapacidad del descendiente
            const discDesc = d.discapacidad_porcentaje || 0;
            if (discDesc >= 65) minimo += 12000;
            else if (discDesc >= 33) minimo += 3000;
        }
    });

    // Ascendientes
    const ascendientes = datosPersonales.ascendientes || [];
    ascendientes.forEach(a => {
        const nacAsc = a.fecha_nacimiento ? new Date(a.fecha_nacimiento) : null;
        const edadAsc = nacAsc
            ? Math.floor((Date.now() - nacAsc.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
            : 0;

        if (edadAsc >= 65 && a.convivencia) {
            minimo += 1150;
            if (edadAsc >= 75) minimo += 1400;

            const discAsc = a.discapacidad_porcentaje || 0;
            if (discAsc >= 65) minimo += 12000;
            else if (discAsc >= 33) minimo += 3000;
        }
    });

    return minimo;
}

/**
 * GET /admin/fiscal/renta/simular/:ejercicio
 * Simula la declaración de la renta con datos reales de la app
 */
export async function simularIRPF(req, res) {
    try {
        const empresaId = req.user.empresa_id || await getEmpresaId(req.user.id);
        const { ejercicio } = req.params;
        const year = parseInt(ejercicio);

        // 1. Recopilar datos reales del ejercicio
        const [facturacion] = await sql`
            SELECT
                COALESCE(SUM(subtotal), 0) as ingresos,
                COALESCE(SUM(retencion_importe), 0) as retenciones_clientes
            FROM factura_180
            WHERE empresa_id = ${empresaId}
            AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND EXTRACT(YEAR FROM fecha) = ${year}
        `;

        const [gastos] = await sql`
            SELECT COALESCE(SUM(base_imponible), 0) as total_gastos
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND EXTRACT(YEAR FROM fecha_compra) = ${year}
        `;

        const [nominas] = await sql`
            SELECT
                COALESCE(SUM(bruto), 0) as bruto_total,
                COALESCE(SUM(seguridad_social_empresa), 0) as ss_empresa,
                COALESCE(SUM(irpf_retencion), 0) as irpf_nominas
            FROM nominas_180
            WHERE empresa_id = ${empresaId} AND anio = ${year}
        `;

        // Pagos fraccionados M130 presentados
        let totalPagos130 = 0;
        try {
            const [p130] = await sql`
                SELECT COALESCE(SUM(resultado_importe), 0) as total
                FROM fiscal_models_180
                WHERE empresa_id = ${empresaId} AND modelo = '130'
                AND ejercicio = ${year} AND estado IN ('GENERADO', 'PRESENTADO')
            `;
            totalPagos130 = parseFloat(p130.total);
        } catch (e) { /* tabla puede no existir */ }

        // Datos personales
        const [datosPersonales] = await sql`
            SELECT * FROM renta_datos_personales_180 WHERE empresa_id = ${empresaId}
        `.catch(() => [null]);

        // 2. Calcular rendimiento neto
        const ingresos = parseFloat(facturacion.ingresos);
        const gastosDeducibles = parseFloat(gastos.total_gastos)
            + parseFloat(nominas.bruto_total)
            + parseFloat(nominas.ss_empresa);
        const rendimientoNeto = ingresos - gastosDeducibles;

        // Reducción por rendimientos del trabajo (si aplica, para empleados)
        // Para autónomos solo aplica la reducción general

        // 3. Reducciones
        const planPensiones = datosPersonales?.aportacion_plan_pensiones || 0;
        const reduccionPensiones = Math.min(planPensiones, 1500); // Límite legal

        // Cuota sindical, etc. — por ahora solo plan de pensiones
        const baseImponibleGeneral = Math.max(0, rendimientoNeto - reduccionPensiones);

        // 4. Mínimo personal y familiar
        const minimoPersonalFamiliar = calcularMinimosPersonales(datosPersonales);

        // Base liquidable = base imponible - mínimo (pero mínimo se aplica como reducción en cuota)
        const baseLiquidable = Math.max(0, baseImponibleGeneral);

        // 5. Calcular cuota íntegra
        const estatal = calcularCuotaTramos(baseLiquidable, TRAMOS_IRPF_ESTATAL);
        const autonomico = calcularCuotaTramos(baseLiquidable, TRAMOS_IRPF_AUTONOMICO);

        // Cuota del mínimo personal (se resta de la cuota)
        const minimoEstatal = calcularCuotaTramos(minimoPersonalFamiliar, TRAMOS_IRPF_ESTATAL);
        const minimoAutonomico = calcularCuotaTramos(minimoPersonalFamiliar, TRAMOS_IRPF_AUTONOMICO);

        const cuotaIntegra = Math.max(0,
            (estatal.cuota - minimoEstatal.cuota) + (autonomico.cuota - minimoAutonomico.cuota)
        );

        // 6. Deducciones
        let deducciones = 0;

        // Deducción por vivienda habitual (solo hipotecas anteriores a 2013)
        if (datosPersonales?.vivienda_tipo === 'propiedad' && datosPersonales?.hipoteca_anual > 0) {
            // La deducción por vivienda es transitoria, solo adquisiciones antes de 01/01/2013
            const fechaCompra = datosPersonales.hipoteca_fecha_compra
                ? new Date(datosPersonales.hipoteca_fecha_compra)
                : null;
            if (fechaCompra && fechaCompra < new Date('2013-01-01')) {
                deducciones += Math.min(datosPersonales.hipoteca_anual, 9040) * 0.15;
            }
        }

        // Deducción por donaciones
        const donacionesONG = datosPersonales?.donaciones_ong || 0;
        if (donacionesONG > 0) {
            // Primeros 250€ al 80%, resto al 40%
            deducciones += Math.min(donacionesONG, 250) * 0.80;
            if (donacionesONG > 250) {
                deducciones += (donacionesONG - 250) * 0.40;
            }
        }
        const donacionesOtras = datosPersonales?.donaciones_otras || 0;
        if (donacionesOtras > 0) {
            deducciones += donacionesOtras * 0.10; // General 10%
        }

        // 7. Cuota líquida
        const cuotaLiquida = Math.max(0, cuotaIntegra - deducciones);

        // 8. Retenciones y pagos a cuenta (ya anticipados)
        const totalAnticipado = parseFloat(facturacion.retenciones_clientes)
            + parseFloat(nominas.irpf_nominas)
            + totalPagos130;

        // 9. Resultado: positivo = a pagar, negativo = a devolver
        const resultadoDeclaracion = Math.round((cuotaLiquida - totalAnticipado) * 100) / 100;

        // 10. Tipo efectivo
        const tipoEfectivo = baseLiquidable > 0
            ? Math.round((cuotaLiquida / baseLiquidable) * 10000) / 100
            : 0;

        res.json({
            success: true,
            data: {
                ejercicio: year,
                rendimientos: {
                    ingresos_actividades: ingresos,
                    gastos_deducibles: gastosDeducibles,
                    rendimiento_neto: rendimientoNeto,
                },
                reducciones: {
                    plan_pensiones: reduccionPensiones,
                    total: reduccionPensiones,
                },
                base_imponible_general: baseImponibleGeneral,
                base_liquidable: baseLiquidable,
                minimo_personal_familiar: minimoPersonalFamiliar,
                cuota_integra: {
                    estatal: Math.round((estatal.cuota - minimoEstatal.cuota) * 100) / 100,
                    autonomica: Math.round((autonomico.cuota - minimoAutonomico.cuota) * 100) / 100,
                    total: Math.round(cuotaIntegra * 100) / 100,
                },
                tramos_desglose: {
                    estatal: estatal.desglose,
                    autonomico: autonomico.desglose,
                },
                deducciones: Math.round(deducciones * 100) / 100,
                cuota_liquida: Math.round(cuotaLiquida * 100) / 100,
                anticipado: {
                    retenciones_clientes: parseFloat(facturacion.retenciones_clientes),
                    retenciones_nominas: parseFloat(nominas.irpf_nominas),
                    pagos_fraccionados_130: totalPagos130,
                    total: Math.round(totalAnticipado * 100) / 100,
                },
                resultado: resultadoDeclaracion,
                resultado_texto: resultadoDeclaracion > 0
                    ? `A PAGAR: ${resultadoDeclaracion.toFixed(2)}€`
                    : `A DEVOLVER: ${Math.abs(resultadoDeclaracion).toFixed(2)}€`,
                tipo_efectivo: tipoEfectivo,
                aviso: rendimientoNeto < 0
                    ? 'Rendimiento negativo: las pérdidas se pueden compensar en los 4 ejercicios siguientes.'
                    : null,
            }
        });

    } catch (error) {
        console.error("Error simularIRPF:", error);
        res.status(500).json({ success: false, error: "Error simulando IRPF" });
    }
}

// =============================================
// 5. DOSSIER PRE-RENTA
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
