import { sql } from "../db.js";

function n(v) {
    return v === undefined || v === null ? null : v;
}

/**
 * Genera un borrador de factura a partir de una plantilla recurrente.
 * Reutiliza la misma lógica de INSERT que createFactura.
 */
async function generarBorradorDesdeRecurrente(plantilla, fecha, empresaId) {
    const lineas = typeof plantilla.lineas === 'string' ? JSON.parse(plantilla.lineas) : plantilla.lineas;

    if (!Array.isArray(lineas) || lineas.length === 0) {
        throw new Error(`Plantilla "${plantilla.nombre}" no tiene líneas de concepto`);
    }

    // Verificar que el cliente sigue existiendo
    const [cliente] = await sql`
        SELECT id FROM clients_180
        WHERE id = ${plantilla.cliente_id} AND empresa_id = ${empresaId}
    `;
    if (!cliente) {
        throw new Error(`Cliente no encontrado para plantilla "${plantilla.nombre}"`);
    }

    let createdFactura;

    await sql.begin(async (tx) => {
        let subtotal = 0;
        let iva_total = 0;

        // Crear factura en BORRADOR
        const [factura] = await tx`
            INSERT INTO factura_180 (
                empresa_id, cliente_id, fecha, estado, iva_global, mensaje_iva, metodo_pago,
                subtotal, iva_total, total,
                retencion_porcentaje, retencion_importe,
                tipo_factura,
                created_at
            ) VALUES (
                ${empresaId},
                ${plantilla.cliente_id},
                ${fecha}::date,
                'BORRADOR',
                ${n(plantilla.iva_global) || 0},
                ${n(plantilla.mensaje_iva)},
                ${n(plantilla.metodo_pago) || 'TRANSFERENCIA'},
                0, 0, 0,
                ${plantilla.retencion_porcentaje || 0}, 0,
                'NORMAL',
                now()
            )
            RETURNING *
        `;

        // Crear líneas
        for (const linea of lineas) {
            const descripcion = (linea.descripcion || "").trim();
            if (!descripcion) continue;

            const cantidad = parseFloat(linea.cantidad || 0);
            const precio_unitario = parseFloat(linea.precio_unitario || 0);
            const iva_pct = parseFloat(linea.iva || plantilla.iva_global || 0);
            const base = cantidad * precio_unitario;
            const importe_iva = base * iva_pct / 100;

            subtotal += base;
            iva_total += importe_iva;

            await tx`
                INSERT INTO lineafactura_180 (
                    factura_id, descripcion, cantidad, precio_unitario, total, iva_percent
                ) VALUES (
                    ${factura.id},
                    ${descripcion},
                    ${cantidad},
                    ${precio_unitario},
                    ${base + importe_iva},
                    ${iva_pct}
                )
            `;
        }

        // Actualizar totales
        const retencion_importe = (subtotal * (plantilla.retencion_porcentaje || 0)) / 100;
        const total = subtotal + iva_total - retencion_importe;

        const [updated] = await tx`
            UPDATE factura_180
            SET subtotal = ${Math.round(subtotal * 100) / 100},
                iva_total = ${Math.round(iva_total * 100) / 100},
                retencion_importe = ${Math.round(retencion_importe * 100) / 100},
                total = ${Math.round(total * 100) / 100}
            WHERE id = ${factura.id}
            RETURNING *
        `;
        createdFactura = updated;
    });

    // Actualizar última generación
    await sql`
        UPDATE factura_recurrente_180
        SET ultima_generacion = ${fecha}, updated_at = NOW()
        WHERE id = ${plantilla.id}
    `;

    return createdFactura;
}

/**
 * GET / — Listar plantillas de facturación recurrente
 */
export async function listar(req, res) {
    try {
        const empresaId = req.user.empresa_id;
        const plantillas = await sql`
            SELECT fr.*, c.nombre AS cliente_nombre
            FROM factura_recurrente_180 fr
            LEFT JOIN clients_180 c ON c.id = fr.cliente_id
            WHERE fr.empresa_id = ${empresaId}
            ORDER BY fr.activo DESC, c.nombre ASC
        `;
        res.json({ data: plantillas });
    } catch (error) {
        console.error("[FacturaRecurrente] Error listar:", error);
        res.status(500).json({ error: "Error al listar plantillas recurrentes." });
    }
}

/**
 * POST / — Crear plantilla
 */
export async function crear(req, res) {
    try {
        const empresaId = req.user.empresa_id;
        const { nombre, cliente_id, lineas, iva_global, mensaje_iva, metodo_pago, retencion_porcentaje, dia_generacion } = req.body;

        if (!nombre?.trim()) return res.status(400).json({ error: "El nombre es obligatorio." });
        if (!cliente_id) return res.status(400).json({ error: "El cliente es obligatorio." });
        if (!Array.isArray(lineas) || lineas.length === 0) return res.status(400).json({ error: "Debe incluir al menos una línea." });

        const dia = parseInt(dia_generacion) || 1;
        if (dia < 1 || dia > 28) return res.status(400).json({ error: "El día debe estar entre 1 y 28." });

        // Verificar cliente
        const [cliente] = await sql`SELECT id FROM clients_180 WHERE id = ${cliente_id} AND empresa_id = ${empresaId}`;
        if (!cliente) return res.status(400).json({ error: "Cliente no encontrado." });

        const [plantilla] = await sql`
            INSERT INTO factura_recurrente_180 (
                empresa_id, cliente_id, nombre, lineas, iva_global, mensaje_iva,
                metodo_pago, retencion_porcentaje, dia_generacion
            ) VALUES (
                ${empresaId}, ${cliente_id}, ${nombre.trim()}, ${JSON.stringify(lineas)},
                ${iva_global || 21}, ${n(mensaje_iva)},
                ${metodo_pago || 'TRANSFERENCIA'}, ${retencion_porcentaje || 0}, ${dia}
            ) RETURNING *
        `;

        res.status(201).json(plantilla);
    } catch (error) {
        console.error("[FacturaRecurrente] Error crear:", error);
        res.status(500).json({ error: "Error al crear plantilla recurrente." });
    }
}

/**
 * PUT /:id — Actualizar plantilla
 */
export async function actualizar(req, res) {
    try {
        const { id } = req.params;
        const empresaId = req.user.empresa_id;

        const [existing] = await sql`
            SELECT * FROM factura_recurrente_180
            WHERE id = ${id} AND empresa_id = ${empresaId}
        `;
        if (!existing) return res.status(404).json({ error: "Plantilla no encontrada." });

        const {
            nombre, cliente_id, lineas, iva_global, mensaje_iva,
            metodo_pago, retencion_porcentaje, dia_generacion, activo
        } = req.body;

        if (dia_generacion !== undefined) {
            const dia = parseInt(dia_generacion);
            if (dia < 1 || dia > 28) return res.status(400).json({ error: "El día debe estar entre 1 y 28." });
        }

        const [result] = await sql`
            UPDATE factura_recurrente_180
            SET
                nombre = ${nombre ?? existing.nombre},
                cliente_id = ${cliente_id ?? existing.cliente_id},
                lineas = ${lineas ? JSON.stringify(lineas) : existing.lineas},
                iva_global = ${iva_global ?? existing.iva_global},
                mensaje_iva = ${mensaje_iva !== undefined ? mensaje_iva : existing.mensaje_iva},
                metodo_pago = ${metodo_pago ?? existing.metodo_pago},
                retencion_porcentaje = ${retencion_porcentaje ?? existing.retencion_porcentaje},
                dia_generacion = ${dia_generacion ?? existing.dia_generacion},
                activo = ${activo ?? existing.activo},
                updated_at = NOW()
            WHERE id = ${id} AND empresa_id = ${empresaId}
            RETURNING *
        `;

        res.json(result);
    } catch (error) {
        console.error("[FacturaRecurrente] Error actualizar:", error);
        res.status(500).json({ error: "Error al actualizar plantilla." });
    }
}

/**
 * DELETE /:id — Eliminar plantilla
 */
export async function eliminar(req, res) {
    try {
        const { id } = req.params;
        const empresaId = req.user.empresa_id;

        const [deleted] = await sql`
            DELETE FROM factura_recurrente_180
            WHERE id = ${id} AND empresa_id = ${empresaId}
            RETURNING id
        `;
        if (!deleted) return res.status(404).json({ error: "Plantilla no encontrada." });

        res.json({ message: "Plantilla eliminada." });
    } catch (error) {
        console.error("[FacturaRecurrente] Error eliminar:", error);
        res.status(500).json({ error: "Error al eliminar plantilla." });
    }
}

/**
 * POST /:id/generar — Generar borrador manual para una plantilla
 */
export async function generarUno(req, res) {
    try {
        const { id } = req.params;
        const empresaId = req.user.empresa_id;
        const { fecha } = req.body;

        if (!fecha) return res.status(400).json({ error: "La fecha es obligatoria." });

        const [plantilla] = await sql`
            SELECT * FROM factura_recurrente_180
            WHERE id = ${id} AND empresa_id = ${empresaId}
        `;
        if (!plantilla) return res.status(404).json({ error: "Plantilla no encontrada." });

        const factura = await generarBorradorDesdeRecurrente(plantilla, fecha, empresaId);
        res.status(201).json({ message: "Borrador generado.", factura });
    } catch (error) {
        console.error("[FacturaRecurrente] Error generar:", error);
        res.status(500).json({ error: error.message || "Error al generar borrador." });
    }
}

/**
 * POST /generar-lote — Generar borradores para TODAS las plantillas activas
 */
export async function generarLote(req, res) {
    try {
        const empresaId = req.user.empresa_id;
        const { fecha } = req.body;

        if (!fecha) return res.status(400).json({ error: "La fecha es obligatoria." });

        const plantillas = await sql`
            SELECT * FROM factura_recurrente_180
            WHERE empresa_id = ${empresaId} AND activo = true
        `;

        if (plantillas.length === 0) {
            return res.json({ message: "No hay plantillas activas.", generadas: 0, errores: [] });
        }

        const generadas = [];
        const errores = [];

        for (const plantilla of plantillas) {
            try {
                const factura = await generarBorradorDesdeRecurrente(plantilla, fecha, empresaId);
                generadas.push({ id: plantilla.id, nombre: plantilla.nombre, factura_id: factura.id });
            } catch (err) {
                errores.push({ id: plantilla.id, nombre: plantilla.nombre, error: err.message });
            }
        }

        res.json({
            message: `${generadas.length} borradores generados, ${errores.length} errores.`,
            generadas,
            errores
        });
    } catch (error) {
        console.error("[FacturaRecurrente] Error generar lote:", error);
        res.status(500).json({ error: "Error al generar borradores." });
    }
}

// Export para uso desde cron
export { generarBorradorDesdeRecurrente };
