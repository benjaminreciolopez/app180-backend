
import { sql } from "../db.js";
import Anthropic from "@anthropic-ai/sdk";
import { extractFullPdfText } from "../services/ocr/ocrEngine.js";
import { saveToStorage } from "./storageController.js";
import {
    FiscalRules,
    calcularCuotaTramos,
    calcularMinimosPersonales,
    calcularDeduccionesAutonomicas,
    calcularDeduccionFamiliaNumerosa,
    COMUNIDADES_AUTONOMAS,
    extractCasillasConRegex,
    parseImporteEspanol
} from "../services/fiscalRulesEngine.js";
import { calcularAmortizacionAcumulada } from "../services/amortizacionService.js";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || ""
});

/**
 * Helper: obtener empresa_id del usuario
 */
async function getEmpresaId(userIdOrReq) {
    if (typeof userIdOrReq === 'object' && userIdOrReq.user) {
        if (userIdOrReq.user.empresa_id) return userIdOrReq.user.empresa_id;
        userIdOrReq = userIdOrReq.user.id;
    }
    const r = await sql`SELECT id FROM empresa_180 WHERE user_id=${userIdOrReq} LIMIT 1`;
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
        const empresaId = await getEmpresaId(req);

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

        // 1b. AUTO-DETECTAR ejercicio del contenido del PDF
        // Los PDFs de AEAT contienen "Ejercicio 2024" o "Ejercicio: 2024" o "EJERCICIO 2024"
        const ejercicioMatch = pdfText.match(/[Ee]jercicio\s*:?\s*(20\d{2})/);
        if (ejercicioMatch) {
            const ejercicioDetectado = parseInt(ejercicioMatch[1]);
            if (ejercicioDetectado !== year) {
            } else {
            }
            // Siempre usar el ejercicio detectado del PDF si es válido
            if (ejercicioDetectado >= 2000 && ejercicioDetectado <= 2099) {
                // Sobrescribir year con el detectado del PDF
                // No reasignamos year (const) sino que usaremos yearFinal
            }
        }
        const yearFinal = ejercicioMatch
            ? parseInt(ejercicioMatch[1])
            : year;

        // 2. PASO 1: Intentar extracción con REGEX (gratis, instantáneo)
        const regexResult = await extractCasillasConRegex(pdfText);

        let extracted;
        let metodoExtraccion = 'regex';

        if (regexResult.confianza >= 0.7 && regexResult.sinResolver.length <= 4) {
            // Regex capturó suficientes casillas — no necesitamos IA para casillas
            // Pero sí usamos IA (Haiku, barato) solo para datos personales
            extracted = {
                tipo_declaracion: 'individual',
                casillas: regexResult.casillas,
                confianza: regexResult.confianza,
                notas: `Extracción por regex: ${regexResult.totalResueltas} casillas. Sin resolver: ${regexResult.sinResolver.join(', ') || 'ninguna'}`,
                datos_personales: {}
            };

            // IA ligera solo para datos personales (primeras 3 páginas, Haiku = barato)
            try {
                const dpText = pdfText.substring(0, 8000); // Solo primeras páginas
                const dpResponse = await anthropic.messages.create({
                    model: "claude-haiku-4-5-20251001",
                    max_tokens: 2048,
                    system: `Extrae SOLO los datos personales/familiares de un PDF de declaración de renta española.
Responde con JSON: {"estado_civil":"soltero|casado|viudo|separado|divorciado","fecha_nacimiento":"YYYY-MM-DD o null","discapacidad_porcentaje":0,"conyuge_nif":"o null","conyuge_nombre":"o null","descendientes":[{"nombre":"","fecha_nacimiento":"","discapacidad_porcentaje":0,"convivencia":true}],"ascendientes":[],"vivienda_tipo":"propiedad|alquiler|otro","tipo_declaracion":"individual|conjunta"}`,
                    messages: [{ role: "user", content: dpText }]
                });
                const dpRaw = dpResponse.content.find(b => b.type === "text")?.text || "{}";
                const dpMatch = dpRaw.match(/\{[\s\S]*\}/);
                if (dpMatch) {
                    extracted.datos_personales = JSON.parse(dpMatch[0]);
                    extracted.tipo_declaracion = extracted.datos_personales.tipo_declaracion || 'individual';
                }
                metodoExtraccion = 'regex+haiku_dp';
            } catch (dpErr) {
                console.warn("Error extrayendo datos personales con IA:", dpErr.message);
            }
        } else {
            // Regex no fue suficiente — usar IA completa (Sonnet) como fallback
            metodoExtraccion = 'sonnet_completo';

            // Cargar lista de casillas desde reglas configurables
            const rules = await FiscalRules.forYear(year);
            const casillasRef = rules.get('casillas_modelo100', 'principales', {});

            const systemPrompt = `Eres un experto fiscal español. Extrae casillas y datos personales de un PDF de declaración de renta (Modelo 100 IRPF).

FORMATO IMPORTES ESPAÑOLES: punto=miles, coma=decimal. "25.432,18" → 25432.18
FORMATO CASILLAS EN PDF AEAT: Los números de casilla van al FINAL de cada línea tras el importe.
Ejemplo: "Base liquidable general sometida a gravamen 14.980,65 0505" → casilla 505 = 14980.65
Las casillas pueden tener 3 o 4 dígitos (003 o 0003 = misma casilla).
Si una casilla no existe en el PDF, déjala en 0.

CASILLAS PRIORITARIAS A EXTRAER:
- Rendimientos: 003(trabajo), 180(ingresos AAEE), 223(gastos AAEE), 224(rto neto AAEE), 231(suma rtos netos), 235(total rto neto AAEE ED)
- Capital: 027(mobiliario), 063(inmobiliario)
- Ganancias: 420(saldo ganancias BI general)
- Bases: 435(BI general), 460(BI ahorro), 505(BL general), 510(BL ahorro)
- Mínimos: 519(mínimo personal familiar estatal), 520(mínimo personal familiar autonómico)
- Cuotas: 545(CI estatal), 546(CI autonómica), 570(CL estatal), 571(CL autonómica), 587(CL incrementada), 595(cuota resultante)
- Retenciones: 012(ret. trabajo), 130(ret. actividades), 604(pagos fraccionados AAEE), 609(total pagos a cuenta)
- Resultado: 610(cuota diferencial), 670(resultado declaración), 695(resultado final), 700(a ingresar/devolver)

Casillas configurables: ${Object.entries(casillasRef).map(([k, v]) => `${k}: ${v}`).join(' | ')}

Responde SOLO con JSON válido:
{"tipo_declaracion":"individual|conjunta","casillas":{"003":0,"012":0,"015":0,"027":0,"028":0,"063":0,"109":0,"110":0,"130":0,"180":0,"223":0,"224":0,"231":0,"235":0,"366":0,"420":0,"435":0,"460":0,"505":0,"510":0,"519":0,"520":0,"545":0,"546":0,"570":0,"571":0,"587":0,"595":0,"604":0,"609":0,"610":0,"611":0,"618":0,"623":0,"670":0,"695":0,"700":0},"resultado_declaracion":0,"ingresos_actividades":0,"gastos_actividades":0,"rendimientos_trabajo":0,"rendimientos_actividades":0,"rendimientos_capital_inmob":0,"rendimientos_capital_mob":0,"ganancias_patrimoniales":0,"retenciones_trabajo":0,"retenciones_actividades":0,"pagos_fraccionados":0,"deducciones_autonomicas":0,"datos_personales":{"estado_civil":"","fecha_nacimiento":null,"discapacidad_porcentaje":0,"conyuge_nif":null,"conyuge_nombre":null,"conyuge_fecha_nacimiento":null,"descendientes":[],"ascendientes":[],"vivienda_tipo":"propiedad","aportacion_plan_pensiones":0,"donaciones_ong":0,"donaciones_otras":0},"casillas_extra":{},"confianza":0.85,"notas":""}`;

            const textToSend = pdfText.length > 150000 ? pdfText.substring(0, 150000) : pdfText;

            const response = await anthropic.messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 8192,
                system: systemPrompt,
                messages: [{
                    role: "user",
                    content: `Declaración de la Renta ejercicio ${year}. Extrae casillas y datos personales:\n\n${textToSend}`
                }]
            });

            // Parseo robusto de JSON
            const rawText = response.content.find(b => b.type === "text")?.text || "{}";
            try {
                extracted = JSON.parse(rawText);
            } catch {
                const jsonMatch = rawText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        extracted = JSON.parse(jsonMatch[0]);
                    } catch {
                        const cleaned = jsonMatch[0]
                            .replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')
                            .replace(/[\x00-\x1F\x7F]/g, ' ').replace(/"""/g, '"');
                        try {
                            extracted = JSON.parse(cleaned);
                        } catch {
                            console.error("Error parseando JSON de Claude:", rawText.substring(0, 500));
                            return res.status(500).json({
                                success: false,
                                error: "La IA no pudo devolver datos válidos. Intenta subir el PDF de nuevo."
                            });
                        }
                    }
                } else {
                    return res.status(500).json({
                        success: false,
                        error: "La IA no devolvió datos estructurados. Intenta subir el PDF de nuevo."
                    });
                }
            }

            // Mezclar: regex tiene prioridad (más fiable), IA rellena huecos
            const iaCasillas = extracted.casillas || {};
            for (const [casilla, valor] of Object.entries(regexResult.casillas)) {
                iaCasillas[casilla] = valor; // Regex sobreescribe IA
            }
            extracted.casillas = iaCasillas;
        }

        // Mapear casillas al formato plano de BD
        const casillas = extracted.casillas || {};

        // Casillas directas
        extracted.casilla_003 = casillas["003"] || 0;
        extracted.casilla_027 = casillas["027"] || 0;
        extracted.casilla_063 = casillas["063"] || 0;
        extracted.casilla_109 = casillas["109"] || 0;
        extracted.casilla_505 = casillas["505"] || 0;
        extracted.casilla_510 = casillas["510"] || 0;
        extracted.casilla_595 = casillas["595"] || 0;
        extracted.casilla_600 = casillas["600"] || 0;
        extracted.casilla_610 = casillas["610"] || 0;
        extracted.casilla_611 = casillas["611"] || 0;

        // Nuevas casillas extendidas
        extracted.casilla_435 = casillas["435"] || 0;
        extracted.casilla_545 = casillas["545"] || 0;
        extracted.casilla_546 = casillas["546"] || 0;
        extracted.casilla_570 = casillas["570"] || 0;
        extracted.casilla_571 = casillas["571"] || 0;
        extracted.casilla_604 = casillas["604"] || 0;
        extracted.casilla_609 = casillas["609"] || 0;
        extracted.casilla_670 = casillas["670"] || 0;
        extracted.casilla_700 = casillas["700"] || 0;

        // Mapear campos de rendimientos CON FALLBACKS para autónomos
        // Rendimientos trabajo: casilla 003
        if (!extracted.rendimientos_trabajo) extracted.rendimientos_trabajo = casillas["003"] || 0;

        // Rendimientos actividades: casilla 109, FALLBACK a 235 → 231 → 224 (formato AEAT autónomos)
        if (!extracted.rendimientos_actividades) {
            extracted.rendimientos_actividades = casillas["109"] || casillas["235"] || casillas["231"] || casillas["224"] || 0;
        }

        // Capital
        if (!extracted.rendimientos_capital_inmob) extracted.rendimientos_capital_inmob = casillas["063"] || 0;
        if (!extracted.rendimientos_capital_mob) extracted.rendimientos_capital_mob = casillas["027"] || 0;

        // Ganancias patrimoniales: casilla 420
        if (!extracted.ganancias_patrimoniales) extracted.ganancias_patrimoniales = casillas["420"] || 0;

        // Retenciones
        if (!extracted.retenciones_trabajo) extracted.retenciones_trabajo = casillas["012"] || 0;
        if (!extracted.retenciones_actividades) extracted.retenciones_actividades = casillas["130"] || 0;

        // Pagos fraccionados: casilla 604
        if (!extracted.pagos_fraccionados) extracted.pagos_fraccionados = casillas["604"] || 0;

        // Ingresos y gastos actividades económicas (NUEVO)
        if (!extracted.ingresos_actividades) extracted.ingresos_actividades = casillas["180"] || 0;
        if (!extracted.gastos_actividades) extracted.gastos_actividades = casillas["223"] || casillas["218"] || 0;

        // Deducciones autonómicas
        if (!extracted.deducciones_autonomicas) extracted.deducciones_autonomicas = casillas["564"] || 0;

        // Mínimo personal y familiar (mayor de estatal/autonómico)
        if (!extracted.minimo_personal_familiar) extracted.minimo_personal_familiar = casillas["520"] || casillas["519"] || 0;

        // Resultado declaración: casilla 695, FALLBACK a 670 → 700 (formato AEAT)
        if (!extracted.resultado_declaracion) {
            extracted.resultado_declaracion = casillas["695"] || casillas["670"] || casillas["700"] || 0;
        }
        extracted._metodo_extraccion = metodoExtraccion;

        // 3. Guardar PDF en storage
        const storageRecord = await saveToStorage({
            empresaId,
            nombre: file.originalname,
            buffer: file.buffer,
            folder: 'renta',
            mimeType: file.mimetype
        });

        // 4. Guardar o actualizar en BD (usar yearFinal = ejercicio detectado del PDF)
        const [existing] = await sql`
            SELECT id FROM renta_historica_180
            WHERE empresa_id = ${empresaId} AND ejercicio = ${yearFinal}
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
                    casilla_435 = ${extracted.casilla_435 || 0},
                    casilla_545 = ${extracted.casilla_545 || 0},
                    casilla_546 = ${extracted.casilla_546 || 0},
                    casilla_570 = ${extracted.casilla_570 || 0},
                    casilla_571 = ${extracted.casilla_571 || 0},
                    casilla_604 = ${extracted.casilla_604 || 0},
                    casilla_609 = ${extracted.casilla_609 || 0},
                    casilla_670 = ${extracted.casilla_670 || 0},
                    casilla_700 = ${extracted.casilla_700 || 0},
                    resultado_declaracion = ${extracted.resultado_declaracion || 0},
                    rendimientos_trabajo = ${extracted.rendimientos_trabajo || 0},
                    rendimientos_actividades = ${extracted.rendimientos_actividades || 0},
                    rendimientos_capital_inmob = ${extracted.rendimientos_capital_inmob || 0},
                    rendimientos_capital_mob = ${extracted.rendimientos_capital_mob || 0},
                    ganancias_patrimoniales = ${extracted.ganancias_patrimoniales || 0},
                    retenciones_trabajo = ${extracted.retenciones_trabajo || 0},
                    retenciones_actividades = ${extracted.retenciones_actividades || 0},
                    pagos_fraccionados = ${extracted.pagos_fraccionados || 0},
                    ingresos_actividades = ${extracted.ingresos_actividades || 0},
                    gastos_actividades = ${extracted.gastos_actividades || 0},
                    deducciones_autonomicas = ${extracted.deducciones_autonomicas || 0},
                    minimo_personal_familiar = ${extracted.minimo_personal_familiar || 0},
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
                    casilla_435, casilla_545, casilla_546, casilla_570, casilla_571,
                    casilla_604, casilla_609, casilla_670, casilla_700,
                    resultado_declaracion, rendimientos_trabajo, rendimientos_actividades,
                    rendimientos_capital_inmob, rendimientos_capital_mob, ganancias_patrimoniales,
                    retenciones_trabajo, retenciones_actividades, pagos_fraccionados,
                    ingresos_actividades, gastos_actividades, deducciones_autonomicas, minimo_personal_familiar,
                    pdf_storage_path, pdf_nombre_archivo, datos_extraidos_json, confianza_extraccion
                ) VALUES (
                    ${empresaId}, ${yearFinal}, ${extracted.tipo_declaracion || 'individual'},
                    ${extracted.casilla_505 || 0}, ${extracted.casilla_510 || 0},
                    ${extracted.casilla_595 || 0}, ${extracted.casilla_600 || 0},
                    ${extracted.casilla_610 || 0}, ${extracted.casilla_611 || 0},
                    ${extracted.casilla_435 || 0}, ${extracted.casilla_545 || 0},
                    ${extracted.casilla_546 || 0}, ${extracted.casilla_570 || 0},
                    ${extracted.casilla_571 || 0}, ${extracted.casilla_604 || 0},
                    ${extracted.casilla_609 || 0}, ${extracted.casilla_670 || 0},
                    ${extracted.casilla_700 || 0},
                    ${extracted.resultado_declaracion || 0},
                    ${extracted.rendimientos_trabajo || 0},
                    ${extracted.rendimientos_actividades || 0},
                    ${extracted.rendimientos_capital_inmob || 0},
                    ${extracted.rendimientos_capital_mob || 0},
                    ${extracted.ganancias_patrimoniales || 0},
                    ${extracted.retenciones_trabajo || 0},
                    ${extracted.retenciones_actividades || 0},
                    ${extracted.pagos_fraccionados || 0},
                    ${extracted.ingresos_actividades || 0},
                    ${extracted.gastos_actividades || 0},
                    ${extracted.deducciones_autonomicas || 0},
                    ${extracted.minimo_personal_familiar || 0},
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
// 1b. DATOS MANUALES DEL EJERCICIO (cuando no hay facturas/gastos en CONTENDO)
// =============================================

/**
 * POST /admin/fiscal/renta/datos-ejercicio/:ejercicio
 * Permite al usuario introducir manualmente ingresos, gastos, retenciones y pagos fraccionados
 * cuando no tiene facturas/gastos registrados en CONTENDO para ese ejercicio.
 * Guarda en renta_historica_180 como tipo_declaracion='manual'
 */
export async function saveDatosEjercicio(req, res) {
    try {
        const empresaId = await getEmpresaId(req);
        const year = parseInt(req.params.ejercicio);
        const {
            ingresos_actividades = 0,
            gastos_actividades = 0,
            retenciones_clientes = 0,
            retenciones_actividades = 0,
            pagos_fraccionados = 0
        } = req.body;

        const rendimientoNeto = ingresos_actividades - gastos_actividades;

        // Buscar si ya existe un registro manual para este ejercicio
        const [existing] = await sql`
            SELECT id FROM renta_historica_180
            WHERE empresa_id = ${empresaId} AND ejercicio = ${year}
            AND tipo_declaracion = 'manual'
        `;

        let record;
        if (existing) {
            [record] = await sql`
                UPDATE renta_historica_180 SET
                    ingresos_actividades = ${ingresos_actividades},
                    gastos_actividades = ${gastos_actividades},
                    rendimientos_actividades = ${rendimientoNeto},
                    retenciones_actividades = ${retenciones_actividades},
                    pagos_fraccionados = ${pagos_fraccionados},
                    resultado_declaracion = ${rendimientoNeto - retenciones_clientes - retenciones_actividades - pagos_fraccionados},
                    datos_extraidos_json = ${sql.json({
                        retenciones_clientes,
                        retenciones_actividades,
                        pagos_fraccionados,
                        fuente: 'manual'
                    })},
                    confianza_extraccion = 1,
                    updated_at = NOW()
                WHERE id = ${existing.id}
                RETURNING *
            `;
        } else {
            [record] = await sql`
                INSERT INTO renta_historica_180 (
                    empresa_id, ejercicio, tipo_declaracion,
                    ingresos_actividades, gastos_actividades, rendimientos_actividades,
                    retenciones_actividades, pagos_fraccionados,
                    resultado_declaracion, confianza_extraccion, datos_extraidos_json
                ) VALUES (
                    ${empresaId}, ${year}, 'manual',
                    ${ingresos_actividades}, ${gastos_actividades}, ${rendimientoNeto},
                    ${retenciones_actividades}, ${pagos_fraccionados},
                    ${rendimientoNeto - retenciones_clientes - retenciones_actividades - pagos_fraccionados},
                    1, ${sql.json({
                        retenciones_clientes,
                        retenciones_actividades,
                        pagos_fraccionados,
                        fuente: 'manual'
                    })}
                )
                RETURNING *
            `;
        }


        res.json({ success: true, data: record });
    } catch (error) {
        console.error("Error saveDatosEjercicio:", error);
        res.status(500).json({ success: false, error: "Error guardando datos del ejercicio" });
    }
}

// =============================================
// 2. DATOS PERSONALES / FAMILIARES
// =============================================

/**
 * GET /admin/fiscal/renta/datos-personales
 */
export function getComunidadesAutonomas(req, res) {
    res.json({ success: true, data: COMUNIDADES_AUTONOMAS });
}

export async function getDatosPersonales(req, res) {
    try {
        const empresaId = await getEmpresaId(req);

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
        const empresaId = await getEmpresaId(req);
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
            tipo_declaracion_preferida,
            comunidad_autonoma,
            anticipo_familia_numerosa
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
                    comunidad_autonoma = ${comunidad_autonoma || 'andalucia'},
                    anticipo_familia_numerosa = ${anticipo_familia_numerosa !== undefined ? anticipo_familia_numerosa : true},
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
                    deducciones_autonomicas, tipo_declaracion_preferida, comunidad_autonoma,
                    anticipo_familia_numerosa
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
                    ${tipo_declaracion_preferida || 'individual'},
                    ${comunidad_autonoma || 'andalucia'},
                    ${anticipo_familia_numerosa !== undefined ? anticipo_familia_numerosa : true}
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
        const empresaId = await getEmpresaId(req);

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
        const empresaId = await getEmpresaId(req);
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
        const empresaId = await getEmpresaId(req);
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
        const empresaId = await getEmpresaId(req);
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
// 4. SIMULADOR IRPF - MOTOR DE REGLAS DINÁMICO
// =============================================
// Tramos, mínimos, deducciones y límites se cargan desde fiscal_reglas_180
// Para cambiar valores → actualizar BD, sin tocar código

/**
 * GET /admin/fiscal/renta/simular/:ejercicio
 * Simula la declaración de la renta con datos reales de la app + reglas configurables
 */
export async function simularIRPF(req, res) {
    try {
        const empresaId = await getEmpresaId(req);
        const { ejercicio } = req.params;
        const year = parseInt(ejercicio);

        // Cargar reglas fiscales del ejercicio desde BD (con caché)
        const rules = await FiscalRules.forYear(year);

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
        const gastosDirectos = parseFloat(gastos.total_gastos)
            + parseFloat(nominas.bruto_total)
            + parseFloat(nominas.ss_empresa);

        // Amortización lineal del inmovilizado (Art. 28 RIRPF, ED simplificada)
        const amortizacion = await calcularAmortizacionAcumulada(
            empresaId, `${year}-01-01`, `${year}-12-31`
        );
        const gastoAmortizacion = parseFloat(amortizacion.total) || 0;

        // Rendimiento neto previo (antes de gastos de difícil justificación)
        const rendimientoNetoPrevio = ingresos - gastosDirectos - gastoAmortizacion;

        // Gastos de difícil justificación (Art. 30 RIRPF — ED simplificada):
        // 5% del rendimiento neto previo positivo, máximo 2.000 €/año.
        // Aplica solo en estimación directa simplificada; permite override por reglas BD.
        const dificilJustPct = rules.getNum('deducciones', 'dificil_justificacion_pct', 5) / 100;
        const dificilJustMax = rules.getNum('deducciones', 'dificil_justificacion_max', 2000);
        const gastosDificilJustificacion = rendimientoNetoPrevio > 0
            ? Math.min(rendimientoNetoPrevio * dificilJustPct, dificilJustMax)
            : 0;

        const rendimientoNeto = rendimientoNetoPrevio - gastosDificilJustificacion;
        const gastosDeducibles = gastosDirectos + gastoAmortizacion + gastosDificilJustificacion;

        // 3. Reducciones (límites desde BD)
        const planPensiones = datosPersonales?.aportacion_plan_pensiones || 0;
        const limitePensiones = rules.getNum('deducciones', 'pension_limite', 1500);
        const reduccionPensiones = Math.min(planPensiones, limitePensiones);

        const baseImponibleGeneral = Math.max(0, rendimientoNeto - reduccionPensiones);

        // 4. Mínimo personal y familiar (estatal + autonómico por separado)
        const ccaa = datosPersonales?.comunidad_autonoma || 'andalucia';
        const esForal = ccaa === 'pais_vasco' || ccaa === 'navarra';
        const minimoEstatalVal = calcularMinimosPersonales(datosPersonales, rules, { tipo: 'estatal' });
        const minimoAutonomicoVal = calcularMinimosPersonales(datosPersonales, rules, { tipo: 'autonomico', ccaa });

        const baseLiquidable = Math.max(0, baseImponibleGeneral);

        // 5. Calcular cuota íntegra (tramos según CCAA)
        let cuotaIntegraEstatal, cuotaIntegraAutonomica, cuotaIntegra;
        let estatal, autonomico, minimoEstatal, minimoAutonomico;

        if (esForal) {
            // Régimen foral: tarifa única completa
            const tramosForal = rules.getTramos(`foral_${ccaa}`);
            estatal = calcularCuotaTramos(baseLiquidable, tramosForal);
            minimoEstatal = calcularCuotaTramos(minimoEstatalVal, tramosForal);
            autonomico = { cuota: 0, desglose: [] };
            minimoAutonomico = { cuota: 0, desglose: [] };
            cuotaIntegraEstatal = Math.max(0, estatal.cuota - minimoEstatal.cuota);
            cuotaIntegraAutonomica = 0;
        } else {
            const tramosEstatal = rules.getTramos('estatal');
            const tramosAutonomico = rules.getTramos(`autonomico_${ccaa}`);

            estatal = calcularCuotaTramos(baseLiquidable, tramosEstatal);
            autonomico = calcularCuotaTramos(baseLiquidable, tramosAutonomico);
            minimoEstatal = calcularCuotaTramos(minimoEstatalVal, tramosEstatal);
            minimoAutonomico = calcularCuotaTramos(minimoAutonomicoVal, tramosAutonomico);

            cuotaIntegraEstatal = Math.max(0, estatal.cuota - minimoEstatal.cuota);
            cuotaIntegraAutonomica = Math.max(0, autonomico.cuota - minimoAutonomico.cuota);

            // Ceuta/Melilla: 50% deducción en cuota íntegra
            if (ccaa === 'ceuta_melilla') {
                cuotaIntegraEstatal *= 0.5;
                cuotaIntegraAutonomica *= 0.5;
            }
        }

        cuotaIntegra = Math.round((cuotaIntegraEstatal + cuotaIntegraAutonomica) * 100) / 100;

        // 6. Deducciones estatales (vivienda, donaciones)
        let deducciones = 0;

        if (datosPersonales?.vivienda_tipo === 'propiedad' && datosPersonales?.hipoteca_anual > 0) {
            const viviendaLimite = rules.getNum('deducciones', 'vivienda_limite', 9040);
            const viviendaPct = rules.getNum('deducciones', 'vivienda_porcentaje', 15) / 100;
            const viviendaFechaLimite = rules.getString('deducciones', 'vivienda_fecha_limite', '2013-01-01');
            const fechaCompra = datosPersonales.hipoteca_fecha_compra
                ? new Date(datosPersonales.hipoteca_fecha_compra)
                : null;
            if (fechaCompra && fechaCompra < new Date(viviendaFechaLimite)) {
                deducciones += Math.min(datosPersonales.hipoteca_anual, viviendaLimite) * viviendaPct;
            }
        }
        const donacionesONG = datosPersonales?.donaciones_ong || 0;
        if (donacionesONG > 0) {
            const umbral = rules.getNum('deducciones', 'donacion_ong_umbral', 250);
            const tipoBajo = rules.getNum('deducciones', 'donacion_ong_tipo_bajo', 80) / 100;
            const tipoAlto = rules.getNum('deducciones', 'donacion_ong_tipo_alto', 40) / 100;
            deducciones += Math.min(donacionesONG, umbral) * tipoBajo;
            if (donacionesONG > umbral) deducciones += (donacionesONG - umbral) * tipoAlto;
        }
        const donacionesOtras = datosPersonales?.donaciones_otras || 0;
        if (donacionesOtras > 0) {
            const tipoOtras = rules.getNum('deducciones', 'donacion_otras_tipo', 10) / 100;
            deducciones += donacionesOtras * tipoOtras;
        }

        // 6b. Deducciones autonómicas
        const deduccionesAut = calcularDeduccionesAutonomicas(datosPersonales, rules, ccaa, baseImponibleGeneral);
        deducciones += deduccionesAut.total;

        // 7. Cuota líquida
        const cuotaLiquida = Math.max(0, cuotaIntegra - deducciones);

        // 8. Retenciones y pagos a cuenta
        const totalAnticipado = parseFloat(facturacion.retenciones_clientes)
            + parseFloat(nominas.irpf_nominas)
            + totalPagos130;

        // 8b. Deducción familia numerosa estatal (Art. 81 bis) - cuota diferencial
        // Si cobra anticipos mensuales (Modelo 143), efecto neto = 0
        // Si NO cobra anticipos, se aplica íntegra en la declaración
        const cobraAnticipos = datosPersonales?.anticipo_familia_numerosa !== false; // default true
        const familiaNumerosa = calcularDeduccionFamiliaNumerosa(datosPersonales, rules, 0);
        const famNumAnticipado = cobraAnticipos ? familiaNumerosa.deduccion_bruta : 0;

        // 9. Resultado
        const resultadoDeclaracion = Math.round((cuotaLiquida - totalAnticipado - (familiaNumerosa.deduccion_bruta - famNumAnticipado)) * 100) / 100;

        // 10. Tipo efectivo
        const tipoEfectivo = baseLiquidable > 0
            ? Math.round((cuotaLiquida / baseLiquidable) * 10000) / 100
            : 0;

        res.json({
            success: true,
            data: {
                ejercicio: year,
                reglas_ejercicio: rules.ejercicio, // Confirma qué año de reglas se usó
                rendimientos: {
                    ingresos_actividades: ingresos,
                    gastos_directos: Math.round(gastosDirectos * 100) / 100,
                    amortizacion: Math.round(gastoAmortizacion * 100) / 100,
                    amortizacion_detalle: amortizacion.detalle,
                    rendimiento_neto_previo: Math.round(rendimientoNetoPrevio * 100) / 100,
                    gastos_dificil_justificacion: Math.round(gastosDificilJustificacion * 100) / 100,
                    gastos_deducibles: Math.round(gastosDeducibles * 100) / 100,
                    rendimiento_neto: Math.round(rendimientoNeto * 100) / 100,
                },
                reducciones: {
                    plan_pensiones: reduccionPensiones,
                    limite_legal: limitePensiones,
                    total: reduccionPensiones,
                },
                base_imponible_general: baseImponibleGeneral,
                base_liquidable: baseLiquidable,
                comunidad_autonoma: ccaa,
                regimen: esForal ? 'foral' : 'comun',
                minimo_personal_familiar: {
                    estatal: Math.round(minimoEstatalVal * 100) / 100,
                    autonomico: Math.round(minimoAutonomicoVal * 100) / 100,
                },
                cuota_integra: {
                    estatal: Math.round(cuotaIntegraEstatal * 100) / 100,
                    autonomica: Math.round(cuotaIntegraAutonomica * 100) / 100,
                    total: Math.round(cuotaIntegra * 100) / 100,
                },
                tramos_desglose: {
                    estatal: estatal.desglose,
                    autonomico: autonomico.desglose,
                },
                deducciones: {
                    estatales: Math.round((deducciones - deduccionesAut.total) * 100) / 100,
                    autonomicas: deduccionesAut,
                    total: Math.round(deducciones * 100) / 100,
                },
                cuota_liquida: Math.round(cuotaLiquida * 100) / 100,
                anticipado: {
                    retenciones_clientes: parseFloat(facturacion.retenciones_clientes),
                    retenciones_nominas: parseFloat(nominas.irpf_nominas),
                    pagos_fraccionados_130: totalPagos130,
                    total: Math.round(totalAnticipado * 100) / 100,
                },
                familia_numerosa: familiaNumerosa,
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
// 5. MODELO 100 — CASILLAS PARA RENTAWEB
// =============================================

/**
 * GET /admin/fiscal/renta/modelo-100/:ejercicio
 *
 * Construye un mapa de casillas oficiales del Modelo 100 (RentaWEB) a partir
 * del cálculo de simularIRPF. AEAT no admite presentación telemática del
 * 100 desde software propio; el gestor debe copiar los importes en RentaWEB.
 *
 * Los códigos de casilla pueden cambiar año a año en RentaWEB; este endpoint
 * mantiene la nomenclatura usada por la AEAT en los últimos ejercicios. El
 * gestor debe verificar contra la versión vigente del modelo cada campaña.
 */
export async function getCasillas100(req, res) {
    try {
        // Reutilizamos simularIRPF construyendo un res "fake" que captura su
        // payload y luego lo transformamos en casillas oficiales.
        let captured = null;
        const captureRes = {
            json: (payload) => { captured = payload; return captureRes; },
            status: () => captureRes,
        };
        await simularIRPF(req, captureRes);

        if (!captured?.success) {
            return res.status(500).json({
                success: false,
                error: captured?.error || "Error simulando IRPF para modelo 100"
            });
        }

        const d = captured.data;

        const casillas = [
            // Rendimientos de actividades económicas (ED simplificada)
            { codigo: "0165", descripcion: "Ingresos íntegros de actividades económicas", importe: d.rendimientos.ingresos_actividades },
            { codigo: "0186", descripcion: "Gastos fiscalmente deducibles (directos)",   importe: d.rendimientos.gastos_directos },
            { codigo: "0188", descripcion: "Amortizaciones del inmovilizado",             importe: d.rendimientos.amortizacion },
            { codigo: "0224", descripcion: "Rendimiento neto previo",                     importe: d.rendimientos.rendimiento_neto_previo },
            { codigo: "0228", descripcion: "Gastos de difícil justificación (5%, máx 2.000 €)", importe: d.rendimientos.gastos_dificil_justificacion },
            { codigo: "0229", descripcion: "Rendimiento neto reducido",                   importe: d.rendimientos.rendimiento_neto },

            // Reducciones
            { codigo: "0500", descripcion: "Reducciones por aportaciones a planes de pensiones", importe: d.reducciones.plan_pensiones },

            // Bases
            { codigo: "0505", descripcion: "Base imponible general", importe: d.base_imponible_general },
            { codigo: "0510", descripcion: "Base liquidable general", importe: d.base_liquidable },

            // Mínimo personal y familiar
            { codigo: "0596", descripcion: "Mínimo personal y familiar (estatal)",   importe: d.minimo_personal_familiar.estatal },
            { codigo: "0597", descripcion: "Mínimo personal y familiar (autonómico)", importe: d.minimo_personal_familiar.autonomico },

            // Cuotas íntegras
            { codigo: "0532", descripcion: "Cuota íntegra estatal",   importe: d.cuota_integra.estatal },
            { codigo: "0546", descripcion: "Cuota íntegra autonómica", importe: d.cuota_integra.autonomica },

            // Deducciones
            { codigo: "0553", descripcion: "Deducciones estatales (vivienda, donaciones)", importe: d.deducciones.estatales },
            { codigo: "0564", descripcion: "Deducciones autonómicas",                       importe: d.deducciones.autonomicas?.total || 0 },

            // Cuota líquida
            { codigo: "0595", descripcion: "Cuota líquida total", importe: d.cuota_liquida },

            // Pagos a cuenta
            { codigo: "0599", descripcion: "Retenciones (clientes)",          importe: d.anticipado.retenciones_clientes },
            { codigo: "0600", descripcion: "Retenciones de nóminas (IRPF)",   importe: d.anticipado.retenciones_nominas },
            { codigo: "0610", descripcion: "Pagos fraccionados Modelo 130",   importe: d.anticipado.pagos_fraccionados_130 },

            // Resultado
            { codigo: "0670", descripcion: "Resultado de la declaración (a pagar +, a devolver -)", importe: d.resultado },
        ];

        res.json({
            success: true,
            data: {
                ejercicio: d.ejercicio,
                comunidad_autonoma: d.comunidad_autonoma,
                regimen: d.regimen,
                tipo_efectivo: d.tipo_efectivo,
                resultado_texto: d.resultado_texto,
                casillas,
                aviso: "El Modelo 100 no se presenta vía API desde software externo. Copiar importes en RentaWEB de la AEAT. Verificar códigos de casilla vigentes para la campaña."
            }
        });
    } catch (error) {
        console.error("Error getCasillas100:", error);
        res.status(500).json({ success: false, error: "Error generando casillas Modelo 100" });
    }
}

// =============================================
// 6. DOSSIER PRE-RENTA
// =============================================

/**
 * GET /admin/fiscal/renta/dossier/:ejercicio
 * Genera un dossier completo combinando datos de CONTENDO + renta anterior + datos personales
 */
export async function generarDossier(req, res) {
    try {
        const empresaId = await getEmpresaId(req);
        const { ejercicio } = req.params;
        const year = parseInt(ejercicio);

        // 1. Datos personales
        const [datosPersonales] = await sql`
            SELECT * FROM renta_datos_personales_180 WHERE empresa_id = ${empresaId}
        `;

        // 2. Renta anterior (si existe)
        // Primero buscar año exacto (year-1), si no existe buscar el más reciente disponible
        let [rentaAnterior] = await sql`
            SELECT * FROM renta_historica_180
            WHERE empresa_id = ${empresaId} AND ejercicio = ${year - 1}
        `;
        if (!rentaAnterior) {
            [rentaAnterior] = await sql`
                SELECT * FROM renta_historica_180
                WHERE empresa_id = ${empresaId}
                ORDER BY ejercicio DESC LIMIT 1
            `;
            if (rentaAnterior) {
            }
        } else {
        }

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

        // 9. Datos manuales del ejercicio (si el usuario los introdujo)
        const [datosManual] = await sql`
            SELECT * FROM renta_historica_180
            WHERE empresa_id = ${empresaId} AND ejercicio = ${year}
            AND tipo_declaracion = 'manual'
        `;

        // Detectar si hay datos reales en CONTENDO para este ejercicio
        const tieneDataContendo = parseInt(facturacion.num_facturas) > 0 || parseInt(gastos.num_gastos) > 0;

        // Calcular rendimiento neto estimado - PRIORIDAD: CONTENDO > Manual > 0
        let ingresos, gastosDeducibles, rendimientoNeto;
        let fuenteDatos = 'sin_datos';
        let retencionesClientesManual = 0;

        if (tieneDataContendo) {
            // Datos de CONTENDO (facturas/gastos reales)
            ingresos = parseFloat(facturacion.base_total);
            gastosDeducibles = parseFloat(gastos.base_total) + parseFloat(nominas.bruto_total) + parseFloat(nominas.ss_empresa);
            rendimientoNeto = ingresos - gastosDeducibles;
            fuenteDatos = 'contendo';
        } else if (datosManual) {
            // Datos introducidos manualmente por el usuario
            ingresos = parseFloat(datosManual.ingresos_actividades || 0);
            gastosDeducibles = parseFloat(datosManual.gastos_actividades || 0);
            rendimientoNeto = ingresos - gastosDeducibles;
            fuenteDatos = 'manual';
            const jsonExtra = datosManual.datos_extraidos_json || {};
            retencionesClientesManual = parseFloat(jsonExtra.retenciones_clientes || 0);
        } else if (rentaAnterior) {
            fuenteDatos = 'renta_importada';
            ingresos = 0;
            gastosDeducibles = 0;
            rendimientoNeto = 0;
        } else {
            ingresos = 0;
            gastosDeducibles = 0;
            rendimientoNeto = 0;
        }


        const dossier = {
            ejercicio: year,
            fuente_datos: fuenteDatos,
            empresa: {
                nombre: emisor?.nombre || '',
                nif: emisor?.nif || '',
                actividad: emisor?.nombre_comercial || ''
            },
            datos_personales: datosPersonales || null,
            renta_anterior: rentaAnterior ? {
                ejercicio: rentaAnterior.ejercicio,
                resultado: parseFloat(rentaAnterior.resultado_declaracion || 0),
                tipo_declaracion: rentaAnterior.tipo_declaracion,
                // Rendimientos desglosados
                rendimientos_trabajo: parseFloat(rentaAnterior.rendimientos_trabajo || 0),
                rendimientos_actividades: parseFloat(rentaAnterior.rendimientos_actividades || 0),
                rendimientos_capital_inmob: parseFloat(rentaAnterior.rendimientos_capital_inmob || 0),
                rendimientos_capital_mob: parseFloat(rentaAnterior.rendimientos_capital_mob || 0),
                ganancias_patrimoniales: parseFloat(rentaAnterior.ganancias_patrimoniales || 0),
                // Detalle actividades económicas
                ingresos_actividades: parseFloat(rentaAnterior.ingresos_actividades || 0),
                gastos_actividades: parseFloat(rentaAnterior.gastos_actividades || 0),
                // Retenciones y pagos
                retenciones_trabajo: parseFloat(rentaAnterior.retenciones_trabajo || 0),
                retenciones_actividades: parseFloat(rentaAnterior.retenciones_actividades || 0),
                pagos_fraccionados: parseFloat(rentaAnterior.pagos_fraccionados || 0),
                // Casillas principales
                casilla_435: parseFloat(rentaAnterior.casilla_435 || 0),
                casilla_505: parseFloat(rentaAnterior.casilla_505 || 0),
                casilla_510: parseFloat(rentaAnterior.casilla_510 || 0),
                casilla_545: parseFloat(rentaAnterior.casilla_545 || 0),
                casilla_546: parseFloat(rentaAnterior.casilla_546 || 0),
                casilla_570: parseFloat(rentaAnterior.casilla_570 || 0),
                casilla_571: parseFloat(rentaAnterior.casilla_571 || 0),
                casilla_595: parseFloat(rentaAnterior.casilla_595 || 0),
                casilla_604: parseFloat(rentaAnterior.casilla_604 || 0),
                casilla_609: parseFloat(rentaAnterior.casilla_609 || 0),
                casilla_610: parseFloat(rentaAnterior.casilla_610 || 0),
                casilla_670: parseFloat(rentaAnterior.casilla_670 || 0),
                deducciones_autonomicas: parseFloat(rentaAnterior.deducciones_autonomicas || 0),
                minimo_personal_familiar: parseFloat(rentaAnterior.minimo_personal_familiar || 0),
                // Calculados
                rendimiento_neto: parseFloat(rentaAnterior.rendimientos_trabajo || 0)
                    + parseFloat(rentaAnterior.rendimientos_actividades || 0)
                    + parseFloat(rentaAnterior.rendimientos_capital_inmob || 0)
                    + parseFloat(rentaAnterior.rendimientos_capital_mob || 0)
                    + parseFloat(rentaAnterior.ganancias_patrimoniales || 0),
                total_anticipado: parseFloat(rentaAnterior.retenciones_trabajo || 0)
                    + parseFloat(rentaAnterior.retenciones_actividades || 0)
                    + parseFloat(rentaAnterior.pagos_fraccionados || 0)
            } : null,
            rendimientos_actividades: {
                ingresos: ingresos,
                gastos_deducibles: gastosDeducibles,
                detalle_gastos: fuenteDatos === 'manual' ? {
                    compras_servicios: gastosDeducibles,
                    nominas: 0,
                    seguridad_social_empresa: 0
                } : {
                    compras_servicios: parseFloat(gastos.base_total),
                    nominas: parseFloat(nominas.bruto_total),
                    seguridad_social_empresa: parseFloat(nominas.ss_empresa)
                },
                rendimiento_neto: rendimientoNeto,
                num_facturas: fuenteDatos === 'manual' ? 0 : parseInt(facturacion.num_facturas),
                num_gastos: fuenteDatos === 'manual' ? 0 : parseInt(gastos.num_gastos)
            },
            retenciones_y_pagos: {
                retenciones_clientes: fuenteDatos === 'manual' ? retencionesClientesManual : parseFloat(facturacion.retenciones_clientes),
                retenciones_actividades: fuenteDatos === 'manual' ? parseFloat(datosManual.retenciones_actividades || 0) : parseFloat(retencionesActividades.total),
                pagos_fraccionados: fuenteDatos === 'manual' ? parseFloat(datosManual.pagos_fraccionados || 0) : totalPagosFraccionados,
                detalle_130: fuenteDatos === 'manual' ? [] : pagos130,
                total_anticipado: fuenteDatos === 'manual'
                    ? retencionesClientesManual + parseFloat(datosManual.retenciones_actividades || 0) + parseFloat(datosManual.pagos_fraccionados || 0)
                    : parseFloat(facturacion.retenciones_clientes) + parseFloat(retencionesActividades.total) + totalPagosFraccionados
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
            resultado_estimado: await (async () => {
                // Calcular resultado estimado con simulación IRPF real (CCAA-aware)
                try {
                    if (fuenteDatos === 'sin_datos' && !rentaAnterior) {
                        return { valor: 0, fuente: 'sin_datos', descripcion: 'Sin datos para estimar' };
                    }

                    if (fuenteDatos === 'renta_importada') {
                        return {
                            valor: parseFloat(rentaAnterior.resultado_declaracion || 0),
                            fuente: 'renta_anterior',
                            ejercicio_referencia: rentaAnterior.ejercicio,
                            descripcion: `Resultado de la declaración ${rentaAnterior.ejercicio} como referencia`
                        };
                    }

                    const rules = await FiscalRules.forYear(year);
                    const ccaa = datosPersonales?.comunidad_autonoma || 'andalucia';
                    const esForal = ccaa === 'pais_vasco' || ccaa === 'navarra';

                    // Reducciones
                    const planPensiones = datosPersonales?.aportacion_plan_pensiones || 0;
                    const limitePensiones = rules.getNum('deducciones', 'pension_limite', 1500);
                    const reduccionPensiones = Math.min(planPensiones, limitePensiones);
                    const baseImponibleGeneral = Math.max(0, rendimientoNeto - reduccionPensiones);
                    const baseLiquidable = Math.max(0, baseImponibleGeneral);

                    // Mínimos personales (estatal y autonómico por separado)
                    const minimoEstatalVal = calcularMinimosPersonales(datosPersonales, rules, { tipo: 'estatal' });
                    const minimoAutonomicoVal = calcularMinimosPersonales(datosPersonales, rules, { tipo: 'autonomico', ccaa });

                    // Tramos IRPF según CCAA
                    let cuotaIntegraEst, cuotaIntegraAut;
                    if (esForal) {
                        const tramosForal = rules.getTramos(`foral_${ccaa}`);
                        const foralCuota = calcularCuotaTramos(baseLiquidable, tramosForal);
                        const foralMinimo = calcularCuotaTramos(minimoEstatalVal, tramosForal);
                        cuotaIntegraEst = Math.max(0, foralCuota.cuota - foralMinimo.cuota);
                        cuotaIntegraAut = 0;
                    } else {
                        const tramosEst = rules.getTramos('estatal');
                        const tramosAut = rules.getTramos(`autonomico_${ccaa}`);
                        const estCuota = calcularCuotaTramos(baseLiquidable, tramosEst);
                        const autCuota = calcularCuotaTramos(baseLiquidable, tramosAut);
                        const minEst = calcularCuotaTramos(minimoEstatalVal, tramosEst);
                        const minAut = calcularCuotaTramos(minimoAutonomicoVal, tramosAut);
                        cuotaIntegraEst = Math.max(0, estCuota.cuota - minEst.cuota);
                        cuotaIntegraAut = Math.max(0, autCuota.cuota - minAut.cuota);
                        if (ccaa === 'ceuta_melilla') { cuotaIntegraEst *= 0.5; cuotaIntegraAut *= 0.5; }
                    }
                    const cuotaIntegra = cuotaIntegraEst + cuotaIntegraAut;

                    // Deducciones estatales
                    let deduccionesTotal = 0;
                    if (datosPersonales?.vivienda_tipo === 'propiedad' && datosPersonales?.hipoteca_anual > 0) {
                        const viviendaLimite = rules.getNum('deducciones', 'vivienda_limite', 9040);
                        const viviendaPct = rules.getNum('deducciones', 'vivienda_porcentaje', 15) / 100;
                        const viviendaFechaLimite = rules.getString('deducciones', 'vivienda_fecha_limite', '2013-01-01');
                        const fechaCompra = datosPersonales?.hipoteca_fecha_compra ? new Date(datosPersonales.hipoteca_fecha_compra) : null;
                        if (fechaCompra && fechaCompra < new Date(viviendaFechaLimite)) {
                            deduccionesTotal += Math.min(datosPersonales.hipoteca_anual, viviendaLimite) * viviendaPct;
                        }
                    }
                    const donacionesONG = datosPersonales?.donaciones_ong || 0;
                    if (donacionesONG > 0) {
                        const umbral = rules.getNum('deducciones', 'donacion_ong_umbral', 250);
                        const tipoBajo = rules.getNum('deducciones', 'donacion_ong_tipo_bajo', 80) / 100;
                        const tipoAlto = rules.getNum('deducciones', 'donacion_ong_tipo_alto', 40) / 100;
                        deduccionesTotal += Math.min(donacionesONG, umbral) * tipoBajo;
                        if (donacionesONG > umbral) deduccionesTotal += (donacionesONG - umbral) * tipoAlto;
                    }

                    // Deducciones autonómicas
                    const deduccionesAut = calcularDeduccionesAutonomicas(datosPersonales, rules, ccaa, baseImponibleGeneral);
                    deduccionesTotal += deduccionesAut.total;

                    const cuotaLiquida = Math.max(0, cuotaIntegra - deduccionesTotal);

                    // Total anticipado
                    let totalAnt;
                    if (fuenteDatos === 'manual') {
                        totalAnt = retencionesClientesManual + parseFloat(datosManual?.retenciones_actividades || 0) + parseFloat(datosManual?.pagos_fraccionados || 0);
                    } else {
                        totalAnt = parseFloat(facturacion.retenciones_clientes) + parseFloat(retencionesActividades.total) + totalPagosFraccionados;
                    }

                    // Familia numerosa estatal (Art. 81 bis)
                    const cobraAnticiposFN = datosPersonales?.anticipo_familia_numerosa !== false;
                    const famNum = calcularDeduccionFamiliaNumerosa(datosPersonales, rules, 0);
                    const famNumNeta = cobraAnticiposFN ? 0 : famNum.deduccion_bruta;
                    const resultado = Math.round((cuotaLiquida - totalAnt - famNumNeta) * 100) / 100;


                    return {
                        valor: resultado,
                        fuente: fuenteDatos,
                        comunidad_autonoma: ccaa,
                        descripcion: fuenteDatos === 'manual'
                            ? `Simulación IRPF ${ccaa} con datos manuales`
                            : `Simulación IRPF ${ccaa} con datos de CONTENDO`,
                        desglose: {
                            rendimiento_neto: Math.round(rendimientoNeto * 100) / 100,
                            base_liquidable: Math.round(baseLiquidable * 100) / 100,
                            minimo_personal_familiar: Math.round(minimoEstatalVal * 100) / 100,
                            minimo_autonomico: Math.round(minimoAutonomicoVal * 100) / 100,
                            cuota_integra: Math.round(cuotaIntegra * 100) / 100,
                            deducciones_estatales: Math.round((deduccionesTotal - deduccionesAut.total) * 100) / 100,
                            deducciones_autonomicas: deduccionesAut,
                            familia_numerosa: famNum,
                            cuota_liquida: Math.round(cuotaLiquida * 100) / 100,
                            total_anticipado: Math.round(totalAnt * 100) / 100,
                        }
                    };
                } catch (simErr) {
                    console.error("Error simulando IRPF en dossier:", simErr.message);
                    if (rentaAnterior) {
                        return {
                            valor: parseFloat(rentaAnterior.resultado_declaracion || 0),
                            fuente: 'renta_anterior',
                            ejercicio_referencia: rentaAnterior.ejercicio,
                            descripcion: `Resultado de la declaración ${rentaAnterior.ejercicio} (simulación no disponible)`
                        };
                    }
                    return { valor: 0, fuente: 'error', descripcion: 'Error en la simulación IRPF' };
                }
            })(),
            resumen: {
                rendimiento_neto_estimado: rendimientoNeto,
                total_anticipado: fuenteDatos === 'manual'
                    ? retencionesClientesManual + parseFloat(datosManual?.retenciones_actividades || 0) + parseFloat(datosManual?.pagos_fraccionados || 0)
                    : parseFloat(facturacion.retenciones_clientes) + parseFloat(retencionesActividades.total) + totalPagosFraccionados,
                tiene_datos_contendo: tieneDataContendo,
                nota: fuenteDatos === 'manual'
                    ? `Datos introducidos manualmente para ${year}. Rendimiento neto: ${rendimientoNeto.toFixed(2)}€.`
                    : fuenteDatos === 'renta_importada'
                        ? `Sin actividad en CONTENDO para ${year}. Se muestra el resultado de la renta ${rentaAnterior.ejercicio} como referencia.`
                        : fuenteDatos === 'contendo'
                            ? rendimientoNeto >= 0
                                ? `Rendimiento neto positivo de ${rendimientoNeto.toFixed(2)}€. Se han anticipado ${(parseFloat(facturacion.retenciones_clientes) + totalPagosFraccionados).toFixed(2)}€ en retenciones y pagos fraccionados.`
                                : `Rendimiento neto negativo (pérdidas) de ${rendimientoNeto.toFixed(2)}€.`
                            : `Sin datos disponibles para ${year}. Importa una declaración anterior o introduce los datos manualmente.`
            }
        };

        res.json({ success: true, data: dossier });

    } catch (error) {
        console.error("Error generarDossier:", error);
        res.status(500).json({ success: false, error: "Error generando dossier pre-renta" });
    }
}
