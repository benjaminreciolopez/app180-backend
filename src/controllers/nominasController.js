
import { sql } from "../db.js";
import Groq from "groq-sdk";
import { ocrExtractTextFromUpload } from "../services/ocr/ocrEngine.js";

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY || ""
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

        // 2. Usar Groq para estructurar
        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                {
                    role: "system",
                    content: `Eres un experto laboral. Tu tarea es extraer datos de una nómina española.
                    
                    EXTRAE LOS SIGUIENTES CAMPOS:
                    1. anio: Año de devengo (ej: 2024).
                    2. mes: Mes de devengo (1-12).
                    3. bruto: Total Devengado (Salario Bruto).
                    4. seguridad_social_empleado: Aportación trabajador a la SS.
                    5. irpf_retencion: Importe de la retención IRPF.
                    6. liquido: Líquido a Percibir (Neto).
                    7. seguridad_social_empresa: Coste empresa o total aportación empresa (si aparece). Si no aparece, pon 0.
                    
                    Responde EXCLUSIVAMENTE un objeto JSON:
                    {
                        "anio": number,
                        "mes": number,
                        "bruto": number,
                        "seguridad_social_empleado": number,
                        "irpf_retencion": number,
                        "liquido": number,
                        "seguridad_social_empresa": number
                    }`
                },
                {
                    role: "user",
                    content: `Texto de la nómina:\n${rawText}`
                }
            ],
            response_format: { type: "json_object" }
        });

        const data = JSON.parse(completion.choices[0].message.content);

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
        const { year, month } = req.query;
        const empresaId = req.user.empresa_id;

        if (!year) {
            return res.status(400).json({ error: "Año requerido" });
        }

        let query = sql`
      SELECT n.*, e.nombre, e.apellidos 
      FROM nominas_180 n
      LEFT JOIN employees_180 em ON n.empleado_id = em.id
      LEFT JOIN users_180 e ON em.user_id = e.id
      WHERE n.empresa_id = ${empresaId}
      AND n.anio = ${year}
    `;

        if (month) {
            query = sql`${query} AND n.mes = ${month}`;
        }

        query = sql`${query} ORDER BY n.mes DESC, e.apellidos ASC`;

        const nominas = await query;

        res.json({ success: true, data: nominas });
    } catch (error) {
        console.error("Error al obtener nóminas:", error);
        res.status(500).json({ success: false, error: "Error al obtener nóminas" });
    }
};

import { saveToStorage } from "./storageController.js";

/**
 * @desc Crear una nueva nómina
 * @route POST /api/nominas
 */
export const createNomina = async (req, res) => {
    try {
        const { empleado_id, anio, mes, bruto, seguridad_social_empresa, seguridad_social_empleado, irpf_retencion, liquido } = req.body;
        const empresaId = req.user.empresa_id;

        if (!anio || !mes || bruto === undefined) {
            return res.status(400).json({ error: "Datos obligatorios faltantes (año, mes, bruto)" });
        }

        let pdfPath = req.body.pdf_path || null;

        // Si se sube archivo
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
                // Continuamos aunque falle el PDF, pero avisamos?
                // Mejor fallar si el usuario esperaba guardar el PDF
            }
        }


        const [nuevaNomina] = await sql`
      INSERT INTO nominas_180 (
        empresa_id, empleado_id, anio, mes, 
        bruto, seguridad_social_empresa, seguridad_social_empleado, 
        irpf_retencion, liquido, pdf_path
      ) VALUES (
        ${empresaId}, ${empleado_id || null}, ${anio}, ${mes},
        ${bruto}, ${seguridad_social_empresa || 0}, ${seguridad_social_empleado || 0},
        ${irpf_retencion || 0}, ${liquido || 0}, ${pdfPath || null}
      )
      RETURNING *
    `;

        res.json({ success: true, data: nuevaNomina });
    } catch (error) {
        console.error("Error al crear nómina:", error);
        res.status(500).json({ success: false, error: "Error al registrar la nómina" });
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
      DELETE FROM nominas_180
      WHERE id = ${id} AND empresa_id = ${empresaId}
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
