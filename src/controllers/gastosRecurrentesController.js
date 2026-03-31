import { sql } from "../db.js";
import { generarAsientoGasto, generarAsientoPagoGasto } from "../services/contabilidadService.js";

function getTrimestre(fechaStr) {
    const mes = new Date(fechaStr).getMonth() + 1;
    return Math.ceil(mes / 3);
}

/**
 * Ejecutar una plantilla de gasto recurrente: crea el gasto en purchases_180 + asientos contables
 * Compartida entre ejecución manual y cron
 */
export async function ejecutarGastoRecurrenteInterno(plantilla, fecha, empresaId, userId = null) {
    const fechaStr = typeof fecha === 'string' ? fecha : fecha.toISOString().split('T')[0];
    const anio = new Date(fechaStr).getFullYear();
    const trimestre = getTrimestre(fechaStr);

    // Insertar gasto en purchases_180
    const [newPurchase] = await sql`
        INSERT INTO purchases_180 (
            empresa_id, proveedor, descripcion, cantidad, precio_unitario,
            total, fecha_compra, categoria, base_imponible, iva_importe, cuota_iva,
            iva_porcentaje, metodo_pago, anio, trimestre,
            retencion_porcentaje, retencion_importe, activo
        ) VALUES (
            ${empresaId}, ${plantilla.proveedor || null}, ${plantilla.descripcion || plantilla.nombre},
            1, ${plantilla.total},
            ${plantilla.total}, ${fechaStr},
            ${plantilla.categoria || 'general'}, ${plantilla.base_imponible}, ${plantilla.iva_importe || 0}, ${plantilla.iva_importe || 0},
            ${plantilla.iva_porcentaje || 0}, ${plantilla.metodo_pago || 'transferencia'},
            ${anio}, ${trimestre},
            ${plantilla.retencion_porcentaje || 0}, ${plantilla.retencion_importe || 0},
            true
        ) RETURNING *
    `;

    // Pasar cuenta_contable si la plantilla la tiene
    if (plantilla.cuenta_contable) {
        newPurchase.cuenta_contable = plantilla.cuenta_contable;
    }

    // Generar asiento contable de devengo
    try {
        const asientoResult = await generarAsientoGasto(empresaId, newPurchase, userId);
        console.log(`[GastosRecurrentes] Asiento de gasto generado para ${newPurchase.id}`);

        if (asientoResult?.lineas?.length > 0) {
            const lineaGasto = asientoResult.lineas.find(l => l.debe > 0 && l.cuenta_codigo !== '472' && l.cuenta_codigo !== '4751');
            if (lineaGasto) {
                await sql`UPDATE purchases_180 SET cuenta_contable = ${lineaGasto.cuenta_codigo} WHERE id = ${newPurchase.id}`;
            }
        }
    } catch (err) {
        console.error("[GastosRecurrentes] Error generando asiento de gasto:", err.message);
    }

    // Generar asiento de pago
    if (newPurchase.metodo_pago) {
        try {
            await generarAsientoPagoGasto(empresaId, newPurchase, userId);
            console.log(`[GastosRecurrentes] Asiento de pago generado para ${newPurchase.id}`);
        } catch (err) {
            console.error("[GastosRecurrentes] Error generando asiento de pago:", err.message);
        }
    }

    // Actualizar última ejecución
    await sql`
        UPDATE gastos_recurrentes_180
        SET ultima_ejecucion = ${fechaStr}, updated_at = NOW()
        WHERE id = ${plantilla.id}
    `;

    return newPurchase;
}

/**
 * GET / — Listar plantillas de gastos recurrentes
 */
export async function listar(req, res) {
    try {
        const { empresa_id } = req.user;
        const plantillas = await sql`
            SELECT * FROM gastos_recurrentes_180
            WHERE empresa_id = ${empresa_id}
            ORDER BY activo DESC, nombre ASC
        `;
        res.json({ data: plantillas });
    } catch (error) {
        console.error("[GastosRecurrentes] Error listar:", error);
        res.status(500).json({ error: "Error al listar gastos recurrentes." });
    }
}

/**
 * POST / — Crear nueva plantilla
 */
export async function crear(req, res) {
    try {
        const { empresa_id } = req.user;
        const {
            nombre, proveedor, descripcion, base_imponible, iva_porcentaje,
            iva_importe, retencion_porcentaje, retencion_importe, total,
            categoria, metodo_pago, cuenta_contable, dia_ejecucion
        } = req.body;

        if (!nombre || !nombre.trim()) {
            return res.status(400).json({ error: "El nombre es obligatorio." });
        }
        if (!total || parseFloat(total) === 0) {
            return res.status(400).json({ error: "El total es obligatorio." });
        }
        if (!base_imponible || parseFloat(base_imponible) === 0) {
            return res.status(400).json({ error: "La base imponible es obligatoria." });
        }

        const dia = parseInt(dia_ejecucion) || 1;
        if (dia < 1 || dia > 28) {
            return res.status(400).json({ error: "El día de ejecución debe estar entre 1 y 28." });
        }

        const [plantilla] = await sql`
            INSERT INTO gastos_recurrentes_180 (
                empresa_id, nombre, proveedor, descripcion, base_imponible,
                iva_porcentaje, iva_importe, retencion_porcentaje, retencion_importe,
                total, categoria, metodo_pago, cuenta_contable, dia_ejecucion
            ) VALUES (
                ${empresa_id}, ${nombre.trim()}, ${proveedor || null}, ${descripcion || null},
                ${base_imponible}, ${iva_porcentaje || 21}, ${iva_importe || 0},
                ${retencion_porcentaje || 0}, ${retencion_importe || 0},
                ${total}, ${categoria || 'general'}, ${metodo_pago || 'transferencia'},
                ${cuenta_contable || null}, ${dia}
            ) RETURNING *
        `;

        res.status(201).json(plantilla);
    } catch (error) {
        console.error("[GastosRecurrentes] Error crear:", error);
        res.status(500).json({ error: "Error al crear gasto recurrente." });
    }
}

/**
 * PUT /:id — Actualizar plantilla
 */
export async function actualizar(req, res) {
    try {
        const { id } = req.params;
        const { empresa_id } = req.user;

        const [existing] = await sql`
            SELECT * FROM gastos_recurrentes_180
            WHERE id = ${id} AND empresa_id = ${empresa_id}
        `;
        if (!existing) {
            return res.status(404).json({ error: "Gasto recurrente no encontrado." });
        }

        const {
            nombre, proveedor, descripcion, base_imponible, iva_porcentaje,
            iva_importe, retencion_porcentaje, retencion_importe, total,
            categoria, metodo_pago, cuenta_contable, dia_ejecucion, activo
        } = req.body;

        if (dia_ejecucion !== undefined) {
            const dia = parseInt(dia_ejecucion);
            if (dia < 1 || dia > 28) {
                return res.status(400).json({ error: "El día de ejecución debe estar entre 1 y 28." });
            }
        }

        const [result] = await sql`
            UPDATE gastos_recurrentes_180
            SET
                nombre = ${nombre ?? existing.nombre},
                proveedor = ${proveedor !== undefined ? proveedor : existing.proveedor},
                descripcion = ${descripcion !== undefined ? descripcion : existing.descripcion},
                base_imponible = ${base_imponible ?? existing.base_imponible},
                iva_porcentaje = ${iva_porcentaje ?? existing.iva_porcentaje},
                iva_importe = ${iva_importe ?? existing.iva_importe},
                retencion_porcentaje = ${retencion_porcentaje ?? existing.retencion_porcentaje},
                retencion_importe = ${retencion_importe ?? existing.retencion_importe},
                total = ${total ?? existing.total},
                categoria = ${categoria ?? existing.categoria},
                metodo_pago = ${metodo_pago ?? existing.metodo_pago},
                cuenta_contable = ${cuenta_contable !== undefined ? cuenta_contable : existing.cuenta_contable},
                dia_ejecucion = ${dia_ejecucion ?? existing.dia_ejecucion},
                activo = ${activo ?? existing.activo},
                updated_at = NOW()
            WHERE id = ${id} AND empresa_id = ${empresa_id}
            RETURNING *
        `;

        res.json(result);
    } catch (error) {
        console.error("[GastosRecurrentes] Error actualizar:", error);
        res.status(500).json({ error: "Error al actualizar gasto recurrente." });
    }
}

/**
 * DELETE /:id — Eliminar plantilla (borrado real)
 */
export async function eliminar(req, res) {
    try {
        const { id } = req.params;
        const { empresa_id } = req.user;

        const [deleted] = await sql`
            DELETE FROM gastos_recurrentes_180
            WHERE id = ${id} AND empresa_id = ${empresa_id}
            RETURNING id
        `;

        if (!deleted) {
            return res.status(404).json({ error: "Gasto recurrente no encontrado." });
        }

        res.json({ message: "Gasto recurrente eliminado." });
    } catch (error) {
        console.error("[GastosRecurrentes] Error eliminar:", error);
        res.status(500).json({ error: "Error al eliminar gasto recurrente." });
    }
}

/**
 * POST /:id/ejecutar — Ejecución manual con fecha seleccionada
 */
export async function ejecutar(req, res) {
    try {
        const { id } = req.params;
        const { empresa_id } = req.user;
        const { fecha } = req.body;

        if (!fecha) {
            return res.status(400).json({ error: "La fecha de ejecución es obligatoria." });
        }

        const [plantilla] = await sql`
            SELECT * FROM gastos_recurrentes_180
            WHERE id = ${id} AND empresa_id = ${empresa_id}
        `;

        if (!plantilla) {
            return res.status(404).json({ error: "Gasto recurrente no encontrado." });
        }

        const gasto = await ejecutarGastoRecurrenteInterno(plantilla, fecha, empresa_id, req.user?.id || null);

        res.status(201).json({ message: "Gasto ejecutado correctamente.", gasto });
    } catch (error) {
        console.error("[GastosRecurrentes] Error ejecutar:", error);
        res.status(500).json({ error: "Error al ejecutar gasto recurrente." });
    }
}
