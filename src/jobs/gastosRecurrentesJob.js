/**
 * Cron Job: Ejecución automática de gastos recurrentes
 * Se ejecuta cada día a las 7:00 AM.
 * Busca plantillas activas cuyo dia_ejecucion coincide con el día actual
 * y que no se hayan ejecutado ya este mes.
 *
 * También detecta gastos repetidos mensualmente para sugerir
 * la creación de plantillas recurrentes.
 */

import { sql } from "../db.js";
import { ejecutarGastoRecurrenteInterno } from "../controllers/gastosRecurrentesController.js";

export async function ejecutarGastosRecurrentes() {
    try {
        const hoy = new Date();
        const diaActual = hoy.getDate();
        const mesActual = hoy.getMonth() + 1;
        const anioActual = hoy.getFullYear();
        const fechaHoy = hoy.toISOString().split('T')[0];

        console.log(`[GastosRecurrentes] Cron ejecutando. Día ${diaActual}, ${mesActual}/${anioActual}`);

        // Buscar plantillas activas para hoy que no se hayan ejecutado este mes
        const plantillas = await sql`
            SELECT gr.*, e.id AS _empresa_check
            FROM gastos_recurrentes_180 gr
            JOIN empresas_180 e ON e.id = gr.empresa_id
            WHERE gr.activo = true
              AND gr.dia_ejecucion = ${diaActual}
              AND (
                  gr.ultima_ejecucion IS NULL
                  OR EXTRACT(MONTH FROM gr.ultima_ejecucion) != ${mesActual}
                  OR EXTRACT(YEAR FROM gr.ultima_ejecucion) != ${anioActual}
              )
        `;

        console.log(`[GastosRecurrentes] ${plantillas.length} plantillas para ejecutar hoy`);

        for (const plantilla of plantillas) {
            try {
                await ejecutarGastoRecurrenteInterno(plantilla, fechaHoy, plantilla.empresa_id);
                console.log(`[GastosRecurrentes] OK: "${plantilla.nombre}" (empresa ${plantilla.empresa_id})`);
            } catch (err) {
                console.error(`[GastosRecurrentes] Error ejecutando "${plantilla.nombre}":`, err.message);
            }
        }

        console.log("[GastosRecurrentes] Cron completado.");
    } catch (err) {
        console.error("[GastosRecurrentes] Error en cron:", err);
    }
}

/**
 * Detectar gastos repetidos mensualmente y notificar para crear recurrentes.
 * Se ejecuta el día 1 de cada mes.
 * Busca proveedores con gastos similares en 3+ meses consecutivos
 * que NO tengan ya una plantilla recurrente.
 */
export async function detectarGastosRecurrentes() {
    try {
        console.log("[GastosRecurrentes] Detectando patrones de gastos repetidos...");

        // Buscar proveedores con gastos iguales (mismo proveedor, mismo importe ±5%) en 3+ meses distintos
        const patrones = await sql`
            WITH gastos_por_mes AS (
                SELECT
                    empresa_id,
                    LOWER(TRIM(proveedor)) AS proveedor_norm,
                    proveedor,
                    categoria,
                    metodo_pago,
                    total,
                    base_imponible,
                    iva_porcentaje,
                    iva_importe,
                    retencion_porcentaje,
                    retencion_importe,
                    cuenta_contable,
                    EXTRACT(YEAR FROM fecha_compra) AS anio,
                    EXTRACT(MONTH FROM fecha_compra) AS mes
                FROM purchases_180
                WHERE activo = true
                  AND proveedor IS NOT NULL
                  AND proveedor != ''
            ),
            repetidos AS (
                SELECT
                    empresa_id,
                    proveedor_norm,
                    MAX(proveedor) AS proveedor,
                    MAX(categoria) AS categoria,
                    MAX(metodo_pago) AS metodo_pago,
                    ROUND(AVG(total), 2) AS total_promedio,
                    ROUND(AVG(base_imponible), 2) AS base_promedio,
                    MAX(iva_porcentaje) AS iva_porcentaje,
                    ROUND(AVG(iva_importe), 2) AS iva_promedio,
                    MAX(retencion_porcentaje) AS retencion_porcentaje,
                    ROUND(AVG(retencion_importe), 2) AS retencion_promedio,
                    MAX(cuenta_contable) AS cuenta_contable,
                    COUNT(DISTINCT (anio || '-' || mes)) AS meses_distintos,
                    MAX(total) AS max_total,
                    MIN(total) AS min_total
                FROM gastos_por_mes
                GROUP BY empresa_id, proveedor_norm
                HAVING COUNT(DISTINCT (anio || '-' || mes)) >= 2
            )
            SELECT r.*
            FROM repetidos r
            WHERE NOT EXISTS (
                SELECT 1 FROM gastos_recurrentes_180 gr
                WHERE gr.empresa_id = r.empresa_id
                  AND LOWER(TRIM(gr.proveedor)) = r.proveedor_norm
            )
            AND NOT EXISTS (
                SELECT 1 FROM gastos_recurrentes_silenciados_180 gs
                WHERE gs.empresa_id = r.empresa_id
                  AND gs.proveedor_norm = r.proveedor_norm
            )
            AND (r.max_total - r.min_total) / NULLIF(r.total_promedio, 0) < 0.1
        `;

        console.log(`[GastosRecurrentes] ${patrones.length} patrones detectados`);

        for (const patron of patrones) {
            const metadata = {
                proveedor: patron.proveedor,
                proveedor_norm: patron.proveedor_norm,
                total: patron.total_promedio,
                base_imponible: patron.base_promedio,
                iva_porcentaje: patron.iva_porcentaje || 21,
                iva_importe: patron.iva_promedio || 0,
                categoria: patron.categoria || 'general',
                metodo_pago: patron.metodo_pago || 'transferencia',
                retencion_porcentaje: patron.retencion_porcentaje || 0,
                retencion_importe: patron.retencion_promedio || 0,
                cuenta_contable: patron.cuenta_contable || '',
                meses_distintos: patron.meses_distintos,
            };

            await sql`
                INSERT INTO notificaciones_180 (
                    empresa_id, tipo, titulo, mensaje, leida, metadata
                ) VALUES (
                    ${patron.empresa_id},
                    'GASTO_RECURRENTE_SUGERIDO',
                    ${'Gasto recurrente detectado: ' + patron.proveedor},
                    ${'Se han detectado ' + patron.meses_distintos + ' gastos similares de "' + patron.proveedor + '" (~' + patron.total_promedio + '€/mes). ¿Quieres crear un gasto recurrente automático?'},
                    false,
                    ${JSON.stringify(metadata)}
                )
            `;

            console.log(`[GastosRecurrentes] Notificación creada para "${patron.proveedor}" (empresa ${patron.empresa_id})`);
        }

        console.log("[GastosRecurrentes] Detección de patrones completada.");
    } catch (err) {
        console.error("[GastosRecurrentes] Error detectando patrones:", err);
    }
}
