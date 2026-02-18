import { sql } from "../db.js";
import Groq from "groq-sdk";
import { ocrExtractTextFromUpload } from "../services/ocr/ocrEngine.js";
import { saveToStorage } from "./storageController.js";

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY || ""
});

/**
 * Helper para calcular trimestre
 */
function getTrimestre(fechaStr) {
    const mes = new Date(fechaStr).getMonth() + 1;
    return Math.ceil(mes / 3);
}

/**
 * OCR para gastos: Extrae texto, usa Groq para estructurar y sube a carpeta dinámica
 */
export async function ocrGasto(req, res) {
    try {
        const { empresa_id } = req.user;
        const file = req.file;

        if (!file) return res.status(400).json({ error: "No se subió ningún archivo" });

        // 1. Extraer texto bruto (Tesseract)
        const rawText = await ocrExtractTextFromUpload(file);

        // 2. Usar Groq para estructurar los datos
        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                {
                    role: "system",
                    content: "Eres un experto contable. Extrae los siguientes datos de un ticket o factura en JSON: proveedor (string), total (number), fecha_compra (YYYY-MM-DD), descripcion (breve resumen). Si no encuentras alguno, pon null. SOLO RESPONDE EL JSON."
                },
                {
                    role: "user",
                    content: `Texto extraído por OCR:\n${rawText}`
                }
            ],
            response_format: { type: "json_object" }
        });

        const data = JSON.parse(completion.choices[0].message.content);

        // 3. Determinar carpeta dinámica (Año/Trimestre)
        const fecha = data.fecha_compra || new Date().toISOString().split('T')[0];
        const anio = new Date(fecha).getFullYear();
        const tri = getTrimestre(fecha);
        const folderPath = `gastos/${anio}/T${tri}`;

        // 4. Guardar archivo en Supabase
        const storageRecord = await saveToStorage({
            empresaId: empresa_id,
            nombre: file.originalname,
            buffer: file.buffer,
            folder: folderPath,
            mimeType: file.mimetype
        });

        // Devolver datos estructurados + URL del documento
        res.json({
            success: true,
            data: {
                ...data,
                document_url: storageRecord.storage_path, // Ajustar según si es URL pública o path
                anio,
                trimestre: tri
            }
        });

    } catch (error) {
        console.error("[Purchases] Error OCR:", error);
        res.status(500).json({ error: "Error al procesar el documento con IA." });
    }
}

/**
 * Listar todas las compras/gastos con filtros
 */
export async function listarCompras(req, res) {
    try {
        const { empresa_id } = req.user;
        let {
            fecha_inicio,
            fecha_fin,
            categoria,
            busqueda,
            anio,
            trimestre,
            limite = 50,
            offset = 0
        } = req.query;

        const safeLimite = Number(limite) || 50;
        const safeOffset = Number(offset) || 0;
        const safeEmpresaId = empresa_id || null;

        if (!safeEmpresaId) {
            return res.status(401).json({ error: "Sesión inválida o empresa no identificada." });
        }

        let query = sql`
      SELECT * FROM purchases_180 
      WHERE empresa_id = ${safeEmpresaId} AND activo = true
    `;

        if (fecha_inicio) query = sql`${query} AND fecha_compra >= ${fecha_inicio}`;
        if (fecha_fin) query = sql`${query} AND fecha_compra <= ${fecha_fin}`;
        if (categoria && categoria !== 'all') query = sql`${query} AND categoria = ${categoria}`;
        if (anio) query = sql`${query} AND anio = ${anio}`;
        if (trimestre) query = sql`${query} AND trimestre = ${trimestre}`;

        if (busqueda) {
            query = sql`${query} AND (proveedor ILIKE ${'%' + busqueda + '%'} OR descripcion ILIKE ${'%' + busqueda + '%'})`;
        }

        query = sql`${query} ORDER BY fecha_compra DESC, created_at DESC LIMIT ${safeLimite} OFFSET ${safeOffset}`;

        const rows = await query;
        const [count] = await sql`
      SELECT COUNT(*) FROM purchases_180 
      WHERE empresa_id = ${safeEmpresaId} AND activo = true
    `;

        res.json({
            data: rows,
            total: parseInt(count.count),
            limite: safeLimite,
            offset: safeOffset
        });
    } catch (error) {
        console.error("[Purchases] Error listarCompras:", error);
        res.status(500).json({ error: "Error al obtener la lista de gastos." });
    }
}

/**
 * Crear un nuevo gasto
 */
export async function crearCompra(req, res) {
    try {
        const { empresa_id } = req.user;
        const {
            proveedor,
            descripcion,
            cantidad = 1,
            precio_unitario,
            total,
            fecha_compra,
            categoria,
            base_imponible,
            iva_importe,
            iva_porcentaje,
            metodo_pago,
            documento_url,
            ocr_data,
            anio,
            trimestre
        } = req.body;

        if (!descripcion || total === undefined) {
            return res.status(400).json({ error: "Descripción e importe total son obligatorios." });
        }

        const fechaFinal = fecha_compra || new Date().toISOString().split('T')[0];
        const finalAnio = anio || new Date(fechaFinal).getFullYear();
        const finalTri = trimestre || getTrimestre(fechaFinal);

        const [newPurchase] = await sql`
      INSERT INTO purchases_180 (
        empresa_id, proveedor, descripcion, cantidad, precio_unitario,
        total, fecha_compra, categoria, base_imponible, iva_importe,
        iva_porcentaje, metodo_pago, documento_url, ocr_data, anio, trimestre, activo
      ) VALUES (
        ${empresa_id}, ${proveedor || null}, ${descripcion}, ${cantidad}, ${precio_unitario || total},
        ${total}, ${fechaFinal}, 
        ${categoria || 'general'}, ${base_imponible || total}, ${iva_importe || 0},
        ${iva_porcentaje || 0}, ${metodo_pago || 'efectivo'}, 
        ${documento_url || null}, ${ocr_data ? JSON.stringify(ocr_data) : null},
        ${finalAnio}, ${finalTri}, true
      ) RETURNING *
    `;

        res.status(201).json(newPurchase);
    } catch (error) {
        console.error("[Purchases] Error crearCompra:", error);
        res.status(500).json({ error: "Error al registrar el gasto." });
    }
}

/**
 * Actualizar un gasto existente
 */
export async function actualizarCompra(req, res) {
    try {
        const { id } = req.params;
        const { empresa_id } = req.user;
        const updateData = req.body;

        const allowedFields = [
            'proveedor', 'descripcion', 'cantidad', 'precio_unitario', 'total',
            'fecha_compra', 'categoria', 'base_imponible', 'iva_importe',
            'iva_porcentaje', 'metodo_pago', 'documento_url', 'ocr_data',
            'anio', 'trimestre'
        ];

        const finalData = {};
        allowedFields.forEach(field => {
            if (updateData[field] !== undefined) {
                finalData[field] = field === 'ocr_data' && updateData[field]
                    ? JSON.stringify(updateData[field])
                    : updateData[field];
            }
        });

        // Si cambia la fecha y no vienen año/trimestre, recalcular
        if (finalData.fecha_compra && (!finalData.anio || !finalData.trimestre)) {
            finalData.anio = new Date(finalData.fecha_compra).getFullYear();
            finalData.trimestre = getTrimestre(finalData.fecha_compra);
        }

        if (Object.keys(finalData).length === 0) {
            return res.status(400).json({ error: "No se proporcionaron campos para actualizar." });
        }

        const [updated] = await sql`
      UPDATE purchases_180
      SET ${sql(finalData)}, updated_at = NOW()
      WHERE id = ${id} AND empresa_id = ${empresa_id}
      RETURNING *
    `;

        if (!updated) {
            return res.status(404).json({ error: "Gasto no encontrado." });
        }

        res.json(updated);
    } catch (error) {
        console.error("[Purchases] Error actualizarCompra:", error);
        res.status(500).json({ error: "Error al actualizar el gasto." });
    }
}

/**
 * Eliminar (desactivar) un gasto
 */
export async function eliminarCompra(req, res) {
    try {
        const { id } = req.params;
        const { empresa_id } = req.user;

        const [deleted] = await sql`
      UPDATE purchases_180
      SET activo = false, updated_at = NOW()
      WHERE id = ${id} AND empresa_id = ${empresa_id}
      RETURNING id
    `;

        if (!deleted) {
            return res.status(404).json({ error: "Gasto no encontrado." });
        }

        res.json({ message: "Gasto eliminado correctamente.", id: deleted.id });
    } catch (error) {
        console.error("[Purchases] Error eliminarCompra:", error);
        res.status(500).json({ error: "Error al eliminar el gasto." });
    }
}
