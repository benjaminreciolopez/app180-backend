import { sql } from "../db.js";

/**
 * Listar todas las compras/gastos con filtros
 */
export async function listarCompras(req, res) {
    try {
        const { empresaId } = req.user;
        const {
            fecha_inicio,
            fecha_fin,
            categoria,
            busqueda,
            limite = 50,
            offset = 0
        } = req.query;

        let query = sql`
      SELECT * FROM purchases_180 
      WHERE empresa_id = ${empresaId} AND activo = true
    `;

        if (fecha_inicio) {
            query = sql`${query} AND fecha_compra >= ${fecha_inicio}`;
        }
        if (fecha_fin) {
            query = sql`${query} AND fecha_compra <= ${fecha_fin}`;
        }
        if (categoria) {
            query = sql`${query} AND categoria = ${categoria}`;
        }
        if (busqueda) {
            query = sql`${query} AND (proveedor ILIKE ${'%' + busqueda + '%'} OR descripcion ILIKE ${'%' + busqueda + '%'})`;
        }

        query = sql`${query} ORDER BY fecha_compra DESC, created_at DESC LIMIT ${limite} OFFSET ${offset}`;

        const rows = await query;
        const [count] = await sql`
      SELECT COUNT(*) FROM purchases_180 
      WHERE empresa_id = ${empresaId} AND activo = true
    `;

        res.json({
            data: rows,
            total: parseInt(count.count),
            limite: parseInt(limite),
            offset: parseInt(offset)
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
        const { empresaId } = req.user;
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
            ocr_data
        } = req.body;

        if (!descripcion || total === undefined) {
            return res.status(400).json({ error: "Descripción e importe total son obligatorios." });
        }

        const [newPurchase] = await sql`
      INSERT INTO purchases_180 (
        empresa_id, proveedor, descripcion, cantidad, precio_unitario,
        total, fecha_compra, categoria, base_imponible, iva_importe,
        iva_porcentaje, metodo_pago, documento_url, ocr_data, activo
      ) VALUES (
        ${empresaId}, ${proveedor || null}, ${descripcion}, ${cantidad}, ${precio_unitario || total},
        ${total}, ${fecha_compra || new Date().toISOString().split('T')[0]}, 
        ${categoria || 'general'}, ${base_imponible || total}, ${iva_importe || 0},
        ${iva_porcentaje || 0}, ${metodo_pago || 'efectivo'}, 
        ${documento_url || null}, ${ocr_data ? JSON.stringify(ocr_data) : null}, true
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
        const { empresaId } = req.user;
        const updateData = req.body;

        // Campos permitidos para actualizar
        const allowedFields = [
            'proveedor', 'descripcion', 'cantidad', 'precio_unitario', 'total',
            'fecha_compra', 'categoria', 'base_imponible', 'iva_importe',
            'iva_porcentaje', 'metodo_pago', 'documento_url', 'ocr_data'
        ];

        const finalData = {};
        allowedFields.forEach(field => {
            if (updateData[field] !== undefined) {
                finalData[field] = field === 'ocr_data' && updateData[field]
                    ? JSON.stringify(updateData[field])
                    : updateData[field];
            }
        });

        if (Object.keys(finalData).length === 0) {
            return res.status(400).json({ error: "No se proporcionaron campos para actualizar." });
        }

        const [updated] = await sql`
      UPDATE purchases_180
      SET ${sql(finalData)}, updated_at = NOW()
      WHERE id = ${id} AND empresa_id = ${empresaId}
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
        const { empresaId } = req.user;

        const [deleted] = await sql`
      UPDATE purchases_180
      SET activo = false, updated_at = NOW()
      WHERE id = ${id} AND empresa_id = ${empresaId}
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
