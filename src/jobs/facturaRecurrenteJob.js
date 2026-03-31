/**
 * Cron Job: Generación automática de borradores de facturas recurrentes
 * Se ejecuta cada día a las 6:00 AM.
 * Busca plantillas activas cuyo dia_generacion coincide con el día actual
 * y que no se hayan generado ya este mes.
 * Genera borradores (NO valida) y notifica al usuario.
 */

import { sql } from "../db.js";
import { generarBorradorDesdeRecurrente } from "../controllers/facturaRecurrenteController.js";

export async function ejecutarFacturasRecurrentes() {
    try {
        const hoy = new Date();
        const diaActual = hoy.getDate();
        const mesActual = hoy.getMonth() + 1;
        const anioActual = hoy.getFullYear();
        const fechaHoy = hoy.toISOString().split('T')[0];

        console.log(`[FacturaRecurrente] Cron ejecutando. Día ${diaActual}, ${mesActual}/${anioActual}`);

        const plantillas = await sql`
            SELECT fr.*
            FROM factura_recurrente_180 fr
            WHERE fr.activo = true
              AND fr.dia_generacion = ${diaActual}
              AND (
                  fr.ultima_generacion IS NULL
                  OR EXTRACT(MONTH FROM fr.ultima_generacion) != ${mesActual}
                  OR EXTRACT(YEAR FROM fr.ultima_generacion) != ${anioActual}
              )
        `;

        console.log(`[FacturaRecurrente] ${plantillas.length} plantillas para generar hoy`);

        // Agrupar por empresa para enviar una sola notificación
        const porEmpresa = {};

        for (const plantilla of plantillas) {
            try {
                await generarBorradorDesdeRecurrente(plantilla, fechaHoy, plantilla.empresa_id);
                console.log(`[FacturaRecurrente] OK: "${plantilla.nombre}" (empresa ${plantilla.empresa_id})`);

                if (!porEmpresa[plantilla.empresa_id]) porEmpresa[plantilla.empresa_id] = 0;
                porEmpresa[plantilla.empresa_id]++;
            } catch (err) {
                console.error(`[FacturaRecurrente] Error "${plantilla.nombre}":`, err.message);
            }
        }

        // Notificar a cada empresa
        for (const [empresaId, count] of Object.entries(porEmpresa)) {
            try {
                await sql`
                    INSERT INTO notificaciones_180 (
                        empresa_id, tipo, titulo, mensaje, leida, accion_url, accion_label
                    ) VALUES (
                        ${empresaId},
                        'FACTURA_RECURRENTE',
                        ${'Facturas recurrentes generadas'},
                        ${'Se han generado ' + count + ' borradores de facturas recurrentes. Revísalos y añade los extras antes de validar.'},
                        false,
                        '/admin/facturacion/listado',
                        'Ver borradores'
                    )
                `;
            } catch (e) {
                console.error(`[FacturaRecurrente] Error notificación empresa ${empresaId}:`, e.message);
            }
        }

        console.log("[FacturaRecurrente] Cron completado.");
    } catch (err) {
        console.error("[FacturaRecurrente] Error en cron:", err);
    }
}
