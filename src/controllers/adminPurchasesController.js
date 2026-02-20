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
                    content: `Eres un experto contable español. Tu tarea es extraer datos de un texto obtenido por OCR de uno o varios tickets/facturas que pueden venir en el mismo documento.
                    
                    INSTRUCCIONES CRÍTICAS:
                    1. Si detectas que hay más de una factura o ticket en el texto, extráelas TODAS como elementos independientes en el array "invoices".
                    2. Proveedor: Identifica el nombre legal o comercial.
                    3. Fecha: Formato YYYY-MM-DD.
                    4. Numero de Factura: Busca 'Nº de factura', 'Factura nº', 'Invoice #', etc.
                    5. Base Imponible: El importe antes de impuestos.
                    6. IVA: Extrae el porcentaje (ej: 21) y el importe del impuesto.
                    7. Total: Importe final con impuestos.
                    8. Retención (IRPF): Si existe, el porcentaje e importe.
                    9. Descripción: Resumen breve de lo comprado.
                    
                    Responde EXCLUSIVAMENTE un objeto JSON con este formato:
                    {
                        "invoices": [
                            {
                                "proveedor": string,
                                "total": number,
                                "fecha_compra": "YYYY-MM-DD",
                                "descripcion": string,
                                "numero_factura": string,
                                "base_imponible": number,
                                "iva_porcentaje": number,
                                "iva_importe": number,
                                "retencion_porcentaje": number,
                                "retencion_importe": number
                            }
                        ]
                    }`
                },
                {
                    role: "user",
                    content: `Texto extraído por OCR:\n${rawText}`
                }
            ],
            response_format: { type: "json_object" }
        });

        const data = JSON.parse(completion.choices[0].message.content);

        // Devolver SOLO datos estructurados (sin guardar archivo aún)
        res.json({
            success: true,
            data: data
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
            query = sql`${query} AND (proveedor ILIKE ${'%' + busqueda + '%'} OR descripcion ILIKE ${'%' + busqueda + '%'} OR numero_factura ILIKE ${'%' + busqueda + '%'})`;
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
            trimestre,
            numero_factura,
            retencion_porcentaje,
            retencion_importe
        } = req.body;

        // 1. Detección de duplicados
        if (numero_factura && proveedor) {
            const [existing] = await sql`
                SELECT id FROM purchases_180 
                WHERE empresa_id = ${empresa_id} 
                AND LOWER(numero_factura) = LOWER(${numero_factura}) 
                AND LOWER(proveedor) = LOWER(${proveedor})
                AND activo = true
                LIMIT 1
            `;
            if (existing) {
                return res.status(409).json({
                    error: `Ya existe un gasto con el número de factura ${numero_factura} para el proveedor ${proveedor}.`
                });
            }
        } else if (proveedor && total && fecha_compra) {
            // Si no hay número de factura, buscamos coincidencia exacta de proveedor, total y fecha
            const [existing] = await sql`
                SELECT id FROM purchases_180 
                WHERE empresa_id = ${empresa_id} 
                AND LOWER(proveedor) = LOWER(${proveedor})
                AND total = ${total}
                AND fecha_compra = ${fecha_compra}
                AND activo = true
                LIMIT 1
            `;
            if (existing) {
                return res.status(409).json({
                    error: `Parece que este gasto ya está registrado (Proveedor: ${proveedor}, Total: ${total}, Fecha: ${fecha_compra}).`
                });
            }
        }

        if (!descripcion || total === undefined) {
            return res.status(400).json({ error: "Descripción e importe total son obligatorios." });
        }

        let finalDocumentUrl = documento_url || null;

        // Si se subió archivo con el create
        if (req.file) {
            const fechaRef = fecha_compra || new Date().toISOString().split('T')[0];
            const y = new Date(fechaRef).getFullYear();
            const t = getTrimestre(fechaRef);
            const folderPath = `gastos/${y}/T${t}`;

            const storageRecord = await saveToStorage({
                empresaId: empresa_id,
                nombre: req.file.originalname,
                buffer: req.file.buffer,
                folder: folderPath,
                mimeType: req.file.mimetype
            });
            // Guardamos la ruta relativa (path en el bucket)
            finalDocumentUrl = storageRecord.storage_path;
        }

        const fechaFinal = fecha_compra || new Date().toISOString().split('T')[0];
        const finalAnio = anio || new Date(fechaFinal).getFullYear();
        const finalTri = trimestre || getTrimestre(fechaFinal);

        // Si ocr_data viene como string (desde FormData), parsearlo
        let parsedOcrData = ocr_data;
        if (typeof ocr_data === 'string') {
            try {
                parsedOcrData = JSON.parse(ocr_data);
            } catch (e) {
                console.warn("Fallo al parsear ocr_data", e);
            }
        }

        const [newPurchase] = await sql`
      INSERT INTO purchases_180 (
        empresa_id, proveedor, descripcion, cantidad, precio_unitario,
        total, fecha_compra, categoria, base_imponible, iva_importe,
        iva_porcentaje, metodo_pago, documento_url, ocr_data, anio, trimestre, 
        numero_factura, retencion_porcentaje, retencion_importe, activo
      ) VALUES (
        ${empresa_id}, ${proveedor || null}, ${descripcion}, ${cantidad}, ${precio_unitario || total},
        ${total}, ${fechaFinal}, 
        ${categoria || 'general'}, ${base_imponible || total}, ${iva_importe || 0},
        ${iva_porcentaje || 0}, ${metodo_pago || 'efectivo'}, 
        ${finalDocumentUrl}, ${parsedOcrData ? JSON.stringify(parsedOcrData) : null},
        ${finalAnio}, ${finalTri}, ${numero_factura || null}, 
        ${retencion_porcentaje || 0}, ${retencion_importe || 0},
        true
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
            'anio', 'trimestre', 'numero_factura', 'retencion_porcentaje', 'retencion_importe'
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

        if (req.file) {
            const fechaRef = finalData.fecha_compra || new Date().toISOString().split('T')[0];
            const y = new Date(fechaRef).getFullYear();
            const t = getTrimestre(fechaRef);
            const folderPath = `gastos/${y}/T${t}`;

            const storageRecord = await saveToStorage({
                empresaId: empresa_id,
                nombre: req.file.originalname,
                buffer: req.file.buffer,
                folder: folderPath,
                mimeType: req.file.mimetype
            });
            // Ruta relativa del bucket
            finalData.documento_url = storageRecord.storage_path;
        }

        // Fix: si ocr_data viene como string JSON (FormData), lo parseamos
        // para que postgres.js lo serialice bien como jsonb o lo pasamos como string
        if (updateData.ocr_data && typeof updateData.ocr_data === 'string') {
            try {
                finalData.ocr_data = JSON.parse(updateData.ocr_data);
            } catch (e) { }
        }

        if (Object.keys(finalData).length === 0) {
            return res.status(400).json({ error: "No se proporcionaron campos para actualizar." });
        }

        const columns = Object.keys(finalData);
        const [updated] = await sql`
      UPDATE purchases_180
      SET ${sql(finalData, columns)}, updated_at = NOW()
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
// ... (código existente)

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

export async function getUniqueValues(req, res) {
    try {
        const { empresa_id } = req.user;
        const { field = 'categoria' } = req.query;

        // Validar campo para evitar inyección SQL (aunque sql`` debería proteger, mejor whitelist)
        const allowedFields = ['categoria', 'metodo_pago', 'proveedor'];
        if (!allowedFields.includes(field)) {
            return res.status(400).json({ error: "Campo no permitido para listar valores únicos" });
        }

        const values = await sql`
            SELECT DISTINCT ${sql(field)} as value
            FROM purchases_180 
            WHERE empresa_id = ${empresa_id} AND activo = true
            ORDER BY ${sql(field)} ASC
        `;

        // Mapear a array de strings
        const list = values.map(v => v.value).filter(Boolean);
        res.json({ data: list });
    } catch (error) {
        console.error("Error getUniqueValues:", error);
        res.status(500).json({ error: "Error al obtener valores únicos" });
    }
}
