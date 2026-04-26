
import { sql } from "../db.js";
import Anthropic from "@anthropic-ai/sdk";
import { ocrExtractTextFromUpload } from "../services/ocr/ocrEngine.js";
import { saveToStorage } from "./storageController.js";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || ""
});

/**
 * @desc OCR para nóminas: Extrae datos usando IA
 * @route POST /api/nominas/ocr
 */
export const ocrNomina = async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: "No se subió ningún archivo" });

        // 1. Extraer texto base
        const rawText = await ocrExtractTextFromUpload(file);

        // 2. Usar Claude para estructurar
        const response = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1024,
            system: `Eres un experto laboral. Tu tarea es extraer datos de una nómina española.

EXTRAE LOS SIGUIENTES CAMPOS:
1. anio: Año de devengo (ej: 2024).
2. mes: Mes de devengo (1-12).
3. bruto: Total Devengado (Salario Bruto).
4. seguridad_social_empleado: Aportación total del trabajador a la SS.
5. irpf_retencion: Importe de la retención IRPF.
6. liquido: Líquido a Percibir (Neto).
7. seguridad_social_empresa: Coste empresa o total aportación empresa (si aparece, 0 si no).
8. base_cotizacion: Base de cotización a la SS (si aparece, 0 si no).
9. tipo_contingencias_comunes: Importe por contingencias comunes del trabajador (si aparece, 0 si no).
10. tipo_desempleo: Importe por desempleo del trabajador (si aparece, 0 si no).
11. tipo_formacion: Importe por formación profesional del trabajador (si aparece, 0 si no).
12. horas_extra: Importe de horas extraordinarias (si aparece, 0 si no).
13. complementos: Total de complementos salariales (si aparece, 0 si no).

Responde EXCLUSIVAMENTE un objeto JSON:
{
    "anio": number, "mes": number, "bruto": number,
    "seguridad_social_empleado": number, "irpf_retencion": number, "liquido": number,
    "seguridad_social_empresa": number, "base_cotizacion": number,
    "tipo_contingencias_comunes": number, "tipo_desempleo": number,
    "tipo_formacion": number, "horas_extra": number, "complementos": number
}`,
            messages: [
                {
                    role: "user",
                    content: `Texto de la nómina:\n${rawText}`
                }
            ]
        });

        const textContent = response.content.find(b => b.type === "text")?.text || "{}";
        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        const data = JSON.parse(jsonMatch ? jsonMatch[0] : textContent);

        // Calcular SS Empresa estimado si es 0 (aprox 30% del bruto) como fallback visual
        // Pero mejor dejarlo en 0 para que el usuario lo rellene si no está en el PDF

        res.json({ success: true, data });

    } catch (error) {
        console.error("Error OCR Nómina:", error);
        res.status(500).json({ success: false, error: "Error analizando nómina" });
    }
};

/**
 * @desc Obtener lista de nóminas filtrada por año y mes
 * @route GET /api/nominas
 */
export const getNominas = async (req, res) => {
    try {
        const yearRaw = req.query.year;
        const monthRaw = req.query.month;
        const empresaId = req.user.empresa_id;

        if (!yearRaw) {
            return res.status(400).json({ error: "Año requerido" });
        }

        const year = parseInt(yearRaw, 10);
        const month = monthRaw ? parseInt(monthRaw, 10) : null;

        if (isNaN(year)) {
            return res.status(400).json({ error: "Año inválido" });
        }

        let query = sql`
      SELECT n.*, e.nombre AS nombre_empleado
      FROM nominas_180 n
      LEFT JOIN employees_180 em ON n.empleado_id = em.id
      LEFT JOIN users_180 e ON em.user_id = e.id
      WHERE n.empresa_id = ${empresaId}
      AND n.anio = ${year}
      AND n.deleted_at IS NULL
    `;

        if (month) {
            query = sql`${query} AND n.mes = ${month}`;
        }

        query = sql`${query} ORDER BY n.mes DESC, e.nombre ASC`;

        const nominas = await query;

        res.json({ success: true, data: nominas });
    } catch (error) {
        console.error("Error al obtener nóminas:", error);
        res.status(500).json({ success: false, error: "Error al obtener nóminas" });
    }
};

/**
 * @desc Crear una nueva nómina
 * @route POST /api/nominas
 */
export const createNomina = async (req, res) => {
    try {
        const {
            empleado_id, anio, mes, bruto,
            seguridad_social_empresa, seguridad_social_empleado, irpf_retencion, liquido,
            base_cotizacion, tipo_contingencias_comunes, tipo_desempleo, tipo_formacion, tipo_fogasa,
            horas_extra, complementos, notas
        } = req.body;
        const empresaId = req.user.empresa_id;

        if (!anio || !mes || bruto === undefined) {
            return res.status(400).json({ error: "Datos obligatorios faltantes (año, mes, bruto)" });
        }

        // Validation: bruto ≈ liquido + irpf + ss_empleado (warn if >5% deviation)
        const warnings = [];
        const brutoNum = parseFloat(bruto) || 0;
        const liquidoNum = parseFloat(liquido) || 0;
        const irpfNum = parseFloat(irpf_retencion) || 0;
        const ssEmpleadoNum = parseFloat(seguridad_social_empleado) || 0;

        if (liquidoNum > 0 && brutoNum > 0) {
            const expectedLiquido = brutoNum - irpfNum - ssEmpleadoNum;
            const deviation = Math.abs(expectedLiquido - liquidoNum);
            const deviationPct = (deviation / brutoNum) * 100;
            if (deviationPct > 5) {
                warnings.push(`Desviación del ${deviationPct.toFixed(1)}% entre bruto y líquido (esperado ~${expectedLiquido.toFixed(2)}, recibido ${liquidoNum.toFixed(2)})`);
            }
        }

        let pdfPath = req.body.pdf_path || null;

        if (req.file) {
            try {
                const folderPath = `nominas/${anio}/${mes}`;
                const storageRecord = await saveToStorage({
                    empresaId: empresaId,
                    nombre: req.file.originalname,
                    buffer: req.file.buffer,
                    folder: folderPath,
                    mimeType: req.file.mimetype
                });
                pdfPath = storageRecord.storage_path;
            } catch (storageError) {
                console.error("Error guardando PDF nómina:", storageError);
            }
        }

        const [nuevaNomina] = await sql`
      INSERT INTO nominas_180 (
        empresa_id, empleado_id, anio, mes,
        bruto, seguridad_social_empresa, seguridad_social_empleado,
        irpf_retencion, liquido, pdf_path,
        base_cotizacion, tipo_contingencias_comunes, tipo_desempleo,
        tipo_formacion, tipo_fogasa, horas_extra, complementos, notas
      ) VALUES (
        ${empresaId}, ${empleado_id || null}, ${anio}, ${mes},
        ${brutoNum}, ${parseFloat(seguridad_social_empresa) || 0}, ${ssEmpleadoNum},
        ${irpfNum}, ${liquidoNum}, ${pdfPath || null},
        ${parseFloat(base_cotizacion) || 0}, ${parseFloat(tipo_contingencias_comunes) || 0},
        ${parseFloat(tipo_desempleo) || 0}, ${parseFloat(tipo_formacion) || 0},
        ${parseFloat(tipo_fogasa) || 0}, ${parseFloat(horas_extra) || 0},
        ${parseFloat(complementos) || 0}, ${notas || null}
      )
      RETURNING *
    `;

        res.json({ success: true, data: nuevaNomina, warnings });
    } catch (error) {
        console.error("Error al crear nómina:", error);
        res.status(500).json({ success: false, error: "Error al registrar la nómina" });
    }
};

/**
 * @desc Actualizar una nómina (solo si no está aprobada/enviada).
 * @route PUT /api/admin/nominas/:id
 */
export const updateNomina = async (req, res) => {
    try {
        const { id } = req.params;
        const empresaId = req.user.empresa_id;

        // Comprobar existencia y estado
        const [existing] = await sql`
          SELECT id, estado, estado_entrega
          FROM nominas_180
          WHERE id = ${id} AND empresa_id = ${empresaId} AND deleted_at IS NULL
          LIMIT 1
        `;
        if (!existing) {
            return res.status(404).json({ error: "Nómina no encontrada" });
        }
        // No permitir editar nómina aprobada o ya entregada al empleado
        if (existing.estado === "aprobada") {
            return res.status(409).json({ error: "No se puede editar una nómina aprobada. Anúlala primero." });
        }
        if (["enviada", "recibida", "firmada"].includes(existing.estado_entrega)) {
            return res.status(409).json({ error: "No se puede editar una nómina ya entregada al empleado." });
        }

        const allowed = [
            "empleado_id", "anio", "mes",
            "bruto", "seguridad_social_empresa", "seguridad_social_empleado",
            "irpf_retencion", "liquido",
            "base_cotizacion", "tipo_contingencias_comunes", "tipo_desempleo",
            "tipo_formacion", "tipo_fogasa", "horas_extra", "complementos", "notas",
        ];
        const updates = {};
        for (const k of allowed) {
            if (k in req.body) {
                const v = req.body[k];
                if (k === "empleado_id" || k === "notas") {
                    updates[k] = v === "" || v === undefined ? null : v;
                } else if (k === "anio" || k === "mes") {
                    updates[k] = v === "" || v === undefined ? null : parseInt(v, 10);
                } else {
                    updates[k] = v === "" || v === undefined || v === null ? 0 : parseFloat(v);
                }
            }
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: "Sin campos para actualizar" });
        }
        updates.updated_at = new Date();

        const [updated] = await sql`
          UPDATE nominas_180
          SET ${sql(updates)}
          WHERE id = ${id} AND empresa_id = ${empresaId}
          RETURNING *
        `;

        return res.json({ success: true, data: updated });
    } catch (error) {
        console.error("Error updateNomina:", error);
        return res.status(500).json({ success: false, error: "Error al actualizar nómina" });
    }
};

/**
 * @desc Eliminar una nómina
 * @route DELETE /api/nominas/:id
 */
export const deleteNomina = async (req, res) => {
    try {
        const { id } = req.params;
        const empresaId = req.user.empresa_id;

        const [deleted] = await sql`
      UPDATE nominas_180 SET deleted_at = NOW()
      WHERE id = ${id} AND empresa_id = ${empresaId} AND deleted_at IS NULL
      RETURNING id
    `;

        if (!deleted) {
            return res.status(404).json({ error: "Nómina no encontrada o no tienes permiso" });
        }

        res.json({ success: true, message: "Nómina eliminada correctamente" });
    } catch (error) {
        console.error("Error al eliminar nómina:", error);
        res.status(500).json({ success: false, error: "Error al eliminar nómina" });
    }
};

/**
 * @desc Resumen anual de nóminas por empleado
 * @route GET /api/nominas/resumen-anual?year=2025
 */
export const resumenAnual = async (req, res) => {
    try {
        const yearRaw = req.query.year;
        const empresaId = req.user.empresa_id;

        if (!yearRaw) return res.status(400).json({ error: "Año requerido" });
        const year = parseInt(yearRaw, 10);
        if (isNaN(year)) return res.status(400).json({ error: "Año inválido" });

        const resumen = await sql`
      SELECT
        n.empleado_id,
        u.nombre AS nombre_empleado,
        COUNT(*)::int AS num_nominas,
        SUM(n.bruto)::numeric AS total_bruto,
        SUM(n.liquido)::numeric AS total_liquido,
        SUM(n.irpf_retencion)::numeric AS total_irpf,
        SUM(n.seguridad_social_empleado)::numeric AS total_ss_empleado,
        SUM(n.seguridad_social_empresa)::numeric AS total_ss_empresa,
        SUM(n.base_cotizacion)::numeric AS total_base_cotizacion,
        SUM(n.tipo_contingencias_comunes)::numeric AS total_contingencias,
        SUM(n.tipo_desempleo)::numeric AS total_desempleo,
        SUM(n.tipo_formacion)::numeric AS total_formacion,
        SUM(n.tipo_fogasa)::numeric AS total_fogasa,
        SUM(n.horas_extra)::numeric AS total_horas_extra,
        SUM(n.complementos)::numeric AS total_complementos,
        AVG(n.bruto)::numeric AS media_bruto,
        CASE WHEN SUM(n.bruto) > 0
          THEN (SUM(n.irpf_retencion) / SUM(n.bruto) * 100)::numeric
          ELSE 0
        END AS tipo_irpf_medio
      FROM nominas_180 n
      LEFT JOIN employees_180 em ON n.empleado_id = em.id
      LEFT JOIN users_180 u ON em.user_id = u.id
      WHERE n.empresa_id = ${empresaId}
        AND n.anio = ${year}
        AND n.deleted_at IS NULL
      GROUP BY n.empleado_id, u.nombre
      ORDER BY u.nombre ASC
    `;

        // Totals across all employees
        const totals = {
            total_bruto: 0, total_liquido: 0, total_irpf: 0,
            total_ss_empleado: 0, total_ss_empresa: 0, num_nominas: 0
        };
        for (const r of resumen) {
            totals.total_bruto += parseFloat(r.total_bruto) || 0;
            totals.total_liquido += parseFloat(r.total_liquido) || 0;
            totals.total_irpf += parseFloat(r.total_irpf) || 0;
            totals.total_ss_empleado += parseFloat(r.total_ss_empleado) || 0;
            totals.total_ss_empresa += parseFloat(r.total_ss_empresa) || 0;
            totals.num_nominas += r.num_nominas;
        }

        res.json({ success: true, year, empleados: resumen, totals });
    } catch (error) {
        console.error("Error resumen anual nóminas:", error);
        res.status(500).json({ success: false, error: "Error generando resumen anual" });
    }
};

/**
 * @desc Resumen mensual para entregar al empresario: totales del mes, neto a pagar a cada empleado,
 *       coste total empresa (bruto + SS empresa), agrupado por empleado. Útil para que el empresario
 *       sepa cuánto va a transferir en nóminas y cuánto cuesta su plantilla en total.
 * @route GET /api/admin/nominas/resumen-empresario?year=2026&month=4
 */
export const resumenEmpresario = async (req, res) => {
    try {
        const empresaId = req.user.empresa_id;
        const yearRaw = req.query.year;
        const monthRaw = req.query.month;

        if (!yearRaw || !monthRaw) {
            return res.status(400).json({ error: "Año y mes requeridos" });
        }
        const year = parseInt(yearRaw, 10);
        const month = parseInt(monthRaw, 10);
        if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
            return res.status(400).json({ error: "Año o mes inválido" });
        }

        const empleados = await sql`
          SELECT
            n.id,
            n.empleado_id,
            COALESCE(u.nombre, em.nombre, '(sin nombre)') AS nombre_empleado,
            n.bruto::numeric,
            n.irpf_retencion::numeric,
            n.seguridad_social_empleado::numeric,
            n.seguridad_social_empresa::numeric,
            n.liquido::numeric,
            n.estado,
            n.estado_entrega
          FROM nominas_180 n
          LEFT JOIN employees_180 em ON n.empleado_id = em.id
          LEFT JOIN users_180 u ON em.user_id = u.id
          WHERE n.empresa_id = ${empresaId}
            AND n.anio = ${year}
            AND n.mes = ${month}
            AND n.deleted_at IS NULL
          ORDER BY u.nombre ASC
        `;

        // Totales agregados
        let total_bruto = 0;
        let total_irpf = 0;
        let total_ss_empleado = 0;
        let total_ss_empresa = 0;
        let total_liquido = 0;
        for (const r of empleados) {
            total_bruto += Number(r.bruto || 0);
            total_irpf += Number(r.irpf_retencion || 0);
            total_ss_empleado += Number(r.seguridad_social_empleado || 0);
            total_ss_empresa += Number(r.seguridad_social_empresa || 0);
            total_liquido += Number(r.liquido || 0);
        }

        const coste_total_empresa = total_bruto + total_ss_empresa;
        const transferencias_a_empleados = total_liquido;
        const a_pagar_a_aeat = total_irpf;
        const a_pagar_a_seg_social = total_ss_empleado + total_ss_empresa;

        return res.json({
            success: true,
            year,
            month,
            num_nominas: empleados.length,
            empleados: empleados.map((r) => ({
                nomina_id: r.id,
                empleado_id: r.empleado_id,
                nombre: r.nombre_empleado,
                bruto: Number(r.bruto || 0),
                irpf: Number(r.irpf_retencion || 0),
                ss_empleado: Number(r.seguridad_social_empleado || 0),
                ss_empresa: Number(r.seguridad_social_empresa || 0),
                neto_a_pagar: Number(r.liquido || 0),
                estado: r.estado,
                estado_entrega: r.estado_entrega,
            })),
            totales: {
                total_bruto,
                total_irpf,
                total_ss_empleado,
                total_ss_empresa,
                total_liquido,
                coste_total_empresa,
                transferencias_a_empleados,
                a_pagar_a_aeat,
                a_pagar_a_seg_social,
            },
        });
    } catch (error) {
        console.error("Error resumenEmpresario:", error);
        return res.status(500).json({ success: false, error: "Error generando resumen empresario" });
    }
};
