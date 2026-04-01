/**
 * Cron Job: Alertas de pago de modelos fiscales
 * Se ejecuta el día 15 de abril, julio, octubre y enero.
 * Calcula los importes de los modelos 130, 303, 111, 115 del trimestre anterior
 * y genera notificaciones con botones Sí/No para registrar el pago automáticamente.
 */

import { sql } from "../db.js";
import { calcularDatosModelos } from "../controllers/adminFiscalController.js";
import { crearNotificacionSistema } from "../controllers/notificacionesController.js";

/**
 * Determina el trimestre anterior basándose en la fecha actual
 */
function getTrimestreAnterior() {
    const hoy = new Date();
    const mes = hoy.getMonth() + 1; // 1-12

    // Abril → Q1, Julio → Q2, Octubre → Q3, Enero → Q4 del año anterior
    if (mes >= 1 && mes <= 3) return { year: hoy.getFullYear() - 1, trimestre: 4 };
    if (mes >= 4 && mes <= 6) return { year: hoy.getFullYear(), trimestre: 1 };
    if (mes >= 7 && mes <= 9) return { year: hoy.getFullYear(), trimestre: 2 };
    return { year: hoy.getFullYear(), trimestre: 3 };
}

export async function generarAlertasPagoModelos() {
    try {
        const { year, trimestre } = getTrimestreAnterior();
        console.log(`[FiscalPayment] Generando alertas de pago para modelos Q${trimestre} ${year}...`);

        // Buscar todas las empresas activas
        const empresas = await sql`
            SELECT DISTINCT e.id
            FROM empresas_180 e
            JOIN empresa_config_180 ec ON ec.empresa_id = e.id
        `;

        for (const empresa of empresas) {
            try {
                await generarAlertasParaEmpresa(empresa.id, year, trimestre);
            } catch (err) {
                console.error(`[FiscalPayment] Error empresa ${empresa.id}:`, err.message);
            }
        }

        console.log("[FiscalPayment] Alertas de pago generadas.");
    } catch (err) {
        console.error("[FiscalPayment] Error:", err);
    }
}

async function generarAlertasParaEmpresa(empresaId, year, trimestre) {
    // Verificar que no exista ya una alerta para este período
    const [existing] = await sql`
        SELECT id FROM notificaciones_180
        WHERE empresa_id = ${empresaId}
        AND tipo = 'PAGO_MODELO_FISCAL'
        AND leida = false
        AND metadata->>'year' = ${String(year)}
        AND metadata->>'trimestre' = ${String(trimestre)}
        LIMIT 1
    `;
    if (existing) return; // Ya hay alerta pendiente

    // Calcular datos de modelos
    let data;
    try {
        data = await calcularDatosModelos(empresaId, year, trimestre);
    } catch {
        return; // Sin datos suficientes
    }

    const modelos = [];

    // Modelo 130 - Pago fraccionado IRPF
    if (data.modelo130.a_ingresar > 0) {
        modelos.push({
            modelo: '130',
            concepto: 'Pago fraccionado IRPF',
            importe: data.modelo130.a_ingresar,
            detalle: {
                ingresos: data.modelo130.ingresos,
                gastos: data.modelo130.gastos,
                rendimiento: data.modelo130.rendimiento,
                pago_fraccionado: data.modelo130.pago_fraccionado,
            }
        });
    }

    // Modelo 303 - IVA
    if (data.modelo303.resultado > 0) {
        modelos.push({
            modelo: '303',
            concepto: 'Liquidación IVA trimestral',
            importe: data.modelo303.resultado,
            detalle: {
                devengado: data.modelo303.devengado.cuota,
                deducible: data.modelo303.deducible.cuota,
            }
        });
    }

    // Modelo 111 - Retenciones IRPF
    if (data.modelo111.total_retenciones > 0) {
        modelos.push({
            modelo: '111',
            concepto: 'Retenciones IRPF practicadas',
            importe: data.modelo111.total_retenciones,
            detalle: {
                trabajo: data.modelo111.trabajo.retenciones,
                actividades: data.modelo111.actividades.retenciones,
            }
        });
    }

    // Modelo 115 - Retenciones alquileres
    if (data.modelo115.a_ingresar > 0) {
        modelos.push({
            modelo: '115',
            concepto: 'Retenciones alquileres',
            importe: data.modelo115.a_ingresar,
        });
    }

    if (modelos.length === 0) return;

    // Crear una notificación consolidada con todos los modelos
    const totalPagar = modelos.reduce((s, m) => s + m.importe, 0);
    const modelosTexto = modelos.map(m => `Mod.${m.modelo}: ${m.importe.toFixed(2)}€`).join(' | ');

    await crearNotificacionSistema({
        empresaId,
        tipo: 'PAGO_MODELO_FISCAL',
        titulo: `Pago modelos fiscales Q${trimestre}/${year}`,
        mensaje: `Plazo de presentación: hasta el 20. Total estimado: ${totalPagar.toFixed(2)}€ (${modelosTexto}). ¿Registrar los pagos y generar asientos contables?`,
        metadata: {
            year: String(year),
            trimestre: String(trimestre),
            modelos,
            total: totalPagar,
        },
    });

    console.log(`[FiscalPayment] Alerta creada empresa ${empresaId}: ${modelos.length} modelos, ${totalPagar.toFixed(2)}€`);
}
