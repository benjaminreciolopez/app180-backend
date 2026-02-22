import { sql } from "../db.js";
import Anthropic from "@anthropic-ai/sdk";
import { ocrExtractTextFromUpload, extractFullPdfText } from "../services/ocr/ocrEngine.js";
import { saveToStorage } from "./storageController.js";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || ""
});

/**
 * Helper para calcular trimestre
 */
function getTrimestre(fechaStr) {
    const mes = new Date(fechaStr).getMonth() + 1;
    return Math.ceil(mes / 3);
}

/**
 * OCR para gastos: Extrae texto, usa Claude para estructurar y sube a carpeta dinámica
 */
export async function ocrGasto(req, res) {
    try {
        const file = req.file;

        if (!file) return res.status(400).json({ error: "No se subió ningún archivo" });

        // 1. Extraer texto bruto (Tesseract)
        const rawText = await ocrExtractTextFromUpload(file);

        // 2. Usar Claude para estructurar los datos
        const systemPrompt = `Eres un experto contable español. Tu tarea es extraer datos de un texto obtenido por OCR de uno o varios tickets/facturas que pueden venir en el mismo documento.

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
}
NOTA: base_imponible e iva_importe son OBLIGATORIOS. Si la cuota de IVA no es cero, es IMPRESCINDIBLE que intentes desglosar la base imponible y el importe del IVA.`;

        const response = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 2048,
            system: systemPrompt,
            messages: [
                {
                    role: "user",
                    content: `Texto extraído por OCR:\n${rawText}`
                }
            ]
        });

        const textContent = response.content.find(b => b.type === "text")?.text || "{}";
        // Extraer JSON del texto (puede venir envuelto en ```json ... ```)
        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        const data = JSON.parse(jsonMatch ? jsonMatch[0] : textContent);
        const { empresa_id } = req.user;

        // 3. Verificar duplicados para cada factura extraída
        if (data.invoices && Array.isArray(data.invoices)) {
            for (let inv of data.invoices) {
                inv.es_duplicado = false;

                if (inv.numero_factura && inv.proveedor) {
                    const [existing] = await sql`
                        SELECT id FROM purchases_180 
                        WHERE empresa_id = ${empresa_id} 
                        AND LOWER(numero_factura) = LOWER(${inv.numero_factura}) 
                        AND LOWER(proveedor) = LOWER(${inv.proveedor})
                        AND activo = true
                        LIMIT 1
                    `;
                    if (existing) inv.es_duplicado = true;
                } else if (inv.proveedor && inv.total && inv.fecha_compra) {
                    const [existing] = await sql`
                        SELECT id FROM purchases_180 
                        WHERE empresa_id = ${empresa_id} 
                        AND LOWER(proveedor) = LOWER(${inv.proveedor})
                        AND total = ${inv.total}
                        AND fecha_compra = ${inv.fecha_compra}
                        AND activo = true
                        LIMIT 1
                    `;
                    if (existing) inv.es_duplicado = true;
                }
            }
        }

        // Devolver datos estructurados con flags de duplicados
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
            retencion_importe,
            ignorar_duplicado
        } = req.body;

        // 1. Detección de duplicados
        if (!ignorar_duplicado) {
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
        }

        if (!descripcion || total === undefined) {
            return res.status(400).json({ error: "Descripción e importe total son obligatorios." });
        }

        // Validación fiscal estricta
        if (!base_imponible || parseFloat(base_imponible) === 0) {
            return res.status(400).json({ error: "La Base Imponible es obligatoria para la declaración fiscal." });
        }
        if (iva_importe === undefined || iva_importe === null) {
            return res.status(400).json({ error: "La Cuota de IVA es obligatoria." });
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

// ============================
// IMPORTACIÓN BANCARIA
// ============================

function parseDateDMY(str) {
    const m = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (!m) return null;
    let [, d, mo, y] = m;
    if (y.length === 2) y = "20" + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function parseSpanishNumber(str) {
    if (!str || typeof str !== "string") return NaN;
    return parseFloat(str.replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
}

function classifyDocument(text) {
    const lower = text.toLowerCase();
    const bankKeywords = ["extracto", "movimientos", "saldo", "fecha valor", "debe", "haber", "bbva", "santander", "caixabank", "bankinter", "iban", "cuenta corriente", "disponible"];
    const invoiceKeywords = ["factura", "nif", "base imponible", "iva", "total factura", "cif", "razón social"];
    const bankScore = bankKeywords.filter(k => lower.includes(k)).length;
    const invoiceScore = invoiceKeywords.filter(k => lower.includes(k)).length;
    if (bankScore > invoiceScore) return "bank_statement_pdf";
    if (invoiceScore > 0) return "invoice";
    return "bank_statement_pdf"; // default: assume bank statement
}

function parseBankCSV(buffer) {
    let text;
    try {
        text = buffer.toString("utf-8");
        if (text.includes("�")) text = buffer.toString("latin1");
    } catch {
        text = buffer.toString("latin1");
    }

    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const separator = lines.some(l => l.split(";").length > 3) ? ";" : ",";

    // Find header row
    let headerIdx = -1;
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
        const lower = lines[i].toLowerCase();
        if ((lower.includes("fecha") && (lower.includes("concepto") || lower.includes("importe") || lower.includes("movimiento"))) ||
            (lower.includes("date") && lower.includes("amount"))) {
            headerIdx = i;
            break;
        }
    }
    if (headerIdx === -1) throw new Error("No se detectó la cabecera del CSV. Asegúrate de que el archivo tiene columnas como Fecha, Concepto, Importe.");

    const headers = lines[headerIdx].split(separator).map(h => h.trim().toLowerCase().replace(/"/g, ""));
    const fechaCol = headers.findIndex(h => h.includes("fecha") && !h.includes("valor"));
    const conceptoCol = headers.findIndex(h => h.includes("concepto") || h.includes("descripci"));
    const importeCol = headers.findIndex(h => h.includes("importe") || h.includes("movimiento") || h.includes("amount"));
    const saldoCol = headers.findIndex(h => h.includes("saldo") || h.includes("disponible"));

    if (fechaCol === -1 || importeCol === -1) throw new Error("No se encontraron las columnas de Fecha e Importe en el CSV.");

    const transactions = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const cols = lines[i].split(separator).map(c => c.trim().replace(/^"|"$/g, ""));
        if (cols.length < 3) continue;

        const fechaRaw = cols[fechaCol];
        const concepto = conceptoCol >= 0 ? cols[conceptoCol] : "Movimiento bancario";
        const importeRaw = cols[importeCol];

        if (!fechaRaw || !importeRaw) continue;
        const fecha = parseDateDMY(fechaRaw);
        if (!fecha) continue;

        const importe = parseSpanishNumber(importeRaw);
        if (isNaN(importe)) continue;

        const saldo = saldoCol >= 0 ? parseSpanishNumber(cols[saldoCol]) : null;

        transactions.push({
            idx: transactions.length,
            fecha,
            concepto: concepto || "Movimiento bancario",
            importe,
            saldo: isNaN(saldo) ? null : saldo,
            es_gasto: importe < 0,
            total_abs: Math.round(Math.abs(importe) * 100) / 100
        });
    }
    return transactions;
}

/**
 * POST /api/admin/purchases/bank-import — Preview de extracto bancario
 */
export async function bankImportPreview(req, res) {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: "No se subió ningún archivo" });
        const { empresa_id } = req.user;

        const mime = file.mimetype || "";
        const name = (file.originalname || "").toLowerCase();
        const isCSV = mime.includes("csv") || name.endsWith(".csv") || (mime === "text/plain" && name.endsWith(".csv"));
        const isPDF = mime.includes("pdf") || name.endsWith(".pdf");

        let transactions = [];
        let documentType, bankName = "desconocido";

        if (isCSV) {
            documentType = "bank_statement_csv";
            transactions = parseBankCSV(file.buffer);
            const textLower = file.buffer.toString("utf-8").toLowerCase();
            if (textLower.includes("bbva")) bankName = "BBVA";
            else if (textLower.includes("santander")) bankName = "Santander";
            else if (textLower.includes("caixabank") || textLower.includes("caixa")) bankName = "CaixaBank";
            else if (textLower.includes("bankinter")) bankName = "Bankinter";

        } else if (isPDF) {
            const fullText = await extractFullPdfText(file.buffer, 20);
            if (fullText.length < 30) {
                return res.status(400).json({ error: "No se pudo extraer texto del PDF. Puede ser un documento escaneado." });
            }

            documentType = classifyDocument(fullText);

            if (documentType === "invoice") {
                return res.json({ success: true, document_type: "invoice", redirect_ocr: true });
            }

            // Parse bank statement with Claude
            const bankPrompt = `Eres un experto financiero español. Extrae TODOS los movimientos bancarios de este extracto de cuenta.

INSTRUCCIONES:
1. Extrae CADA línea de movimiento individual.
2. Fecha: Formato YYYY-MM-DD.
3. Concepto: El texto descriptivo del movimiento.
4. Importe: Negativo para cargos/gastos, positivo para abonos/ingresos.
5. Saldo: Si está disponible, el saldo tras el movimiento.

Responde EXCLUSIVAMENTE un JSON:
{
  "bank_name": string,
  "movements": [
    { "fecha": "YYYY-MM-DD", "concepto": string, "importe": number, "saldo": number | null }
  ]
}`;

            const response = await anthropic.messages.create({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 4096,
                system: bankPrompt,
                messages: [{ role: "user", content: `Extracto bancario:\n${fullText}` }]
            });

            const textContent = response.content.find(b => b.type === "text")?.text || "{}";
            const jsonMatch = textContent.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : textContent);
            bankName = parsed.bank_name || "desconocido";

            transactions = (parsed.movements || []).map((m, i) => ({
                idx: i,
                fecha: m.fecha,
                concepto: m.concepto || "Movimiento",
                importe: m.importe,
                saldo: m.saldo,
                es_gasto: m.importe < 0,
                total_abs: Math.round(Math.abs(m.importe) * 100) / 100
            }));
        } else {
            return res.status(400).json({ error: "Formato no soportado. Sube un CSV o PDF." });
        }

        // Duplicate detection
        for (const tx of transactions) {
            tx.es_duplicado = false;
            tx.duplicado_id = null;
            const [existing] = await sql`
                SELECT id FROM purchases_180
                WHERE empresa_id = ${empresa_id}
                AND total = ${tx.total_abs}
                AND fecha_compra = ${tx.fecha}
                AND activo = true
                LIMIT 1
            `;
            if (existing) {
                tx.es_duplicado = true;
                tx.duplicado_id = existing.id;
            }
        }

        // AI enrichment: suggest proveedor and category
        const gastosParaEnriquecer = transactions.filter(t => t.es_gasto).slice(0, 50);
        if (gastosParaEnriquecer.length > 0 && process.env.ANTHROPIC_API_KEY) {
            try {
                const enrichPrompt = `Para cada movimiento bancario, sugiere un nombre de proveedor corto y una categoría.
Categorías válidas: suministros, alquiler, telefonia, seguros, material, transporte, formacion, publicidad, software, comisiones_bancarias, impuestos, general.

Movimientos:
${gastosParaEnriquecer.map((t, i) => `${i}. "${t.concepto}" (${t.total_abs}€)`).join("\n")}

Responde SOLO un JSON array:
[{ "idx": number, "proveedor": string, "categoria": string }]`;

                const enrichResp = await anthropic.messages.create({
                    model: "claude-haiku-4-5-20251001",
                    max_tokens: 2048,
                    messages: [{ role: "user", content: enrichPrompt }]
                });
                const enrichText = enrichResp.content.find(b => b.type === "text")?.text || "[]";
                const enrichMatch = enrichText.match(/\[[\s\S]*\]/);
                const enriched = JSON.parse(enrichMatch ? enrichMatch[0] : "[]");

                for (const e of enriched) {
                    const tx = gastosParaEnriquecer[e.idx];
                    if (tx) {
                        tx.proveedor_sugerido = e.proveedor || "";
                        tx.categoria_sugerida = e.categoria || "general";
                    }
                }
            } catch (err) {
                console.warn("[BankImport] Error enriching:", err.message);
            }
        }

        const gastos = transactions.filter(t => t.es_gasto);
        const ingresos = transactions.filter(t => !t.es_gasto);

        res.json({
            success: true,
            document_type: documentType,
            bank_name: bankName,
            transactions,
            resumen: {
                total_movimientos: transactions.length,
                total_gastos: gastos.length,
                total_ingresos: ingresos.length,
                suma_gastos: Math.round(gastos.reduce((s, t) => s + t.importe, 0) * 100) / 100,
                periodo: transactions.length > 0
                    ? `${transactions[transactions.length - 1].fecha} — ${transactions[0].fecha}`
                    : null
            }
        });
    } catch (error) {
        console.error("[BankImport] Error preview:", error);
        res.status(500).json({ error: error.message || "Error al procesar el extracto bancario." });
    }
}

/**
 * POST /api/admin/purchases/bank-import/confirm — Importar transacciones seleccionadas
 */
export async function bankImportConfirm(req, res) {
    try {
        const { empresa_id } = req.user;
        const { transactions, source_file_name } = req.body;

        if (!Array.isArray(transactions) || transactions.length === 0) {
            return res.status(400).json({ error: "No hay transacciones para importar" });
        }

        const imported = [];
        const errors = [];

        for (const tx of transactions) {
            try {
                const fecha = tx.fecha_compra;
                const anio = new Date(fecha).getFullYear();
                const trimestre = getTrimestre(fecha);

                const [newPurchase] = await sql`
                    INSERT INTO purchases_180 (
                        empresa_id, proveedor, descripcion, total, fecha_compra,
                        categoria, metodo_pago, base_imponible, iva_importe, iva_porcentaje,
                        anio, trimestre, numero_factura, ocr_data, activo
                    ) VALUES (
                        ${empresa_id}, ${tx.proveedor || null}, ${tx.descripcion},
                        ${tx.total}, ${fecha},
                        ${tx.categoria || 'general'}, ${tx.metodo_pago || 'domiciliacion'},
                        ${tx.base_imponible || tx.total}, ${tx.iva_importe || 0}, ${tx.iva_porcentaje || 0},
                        ${anio}, ${trimestre}, ${tx.numero_factura || null},
                        ${JSON.stringify({ origen: "bank_import", source_file: source_file_name || null, concepto_original: tx.concepto_original || null })},
                        true
                    ) RETURNING id
                `;
                imported.push(newPurchase.id);
            } catch (e) {
                errors.push({ descripcion: tx.descripcion, error: e.message });
            }
        }

        res.json({ success: true, imported: imported.length, errors });
    } catch (error) {
        console.error("[BankImport] Error confirm:", error);
        res.status(500).json({ error: "Error al importar las transacciones." });
    }
}
