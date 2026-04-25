
import { sql } from "../db.js";
import * as contabilidadService from "../services/contabilidadService.js";

/**
 * Lista de campos del checklist para iterar
 */
const CHECKLIST_FIELDS = [
    "facturas_revisadas",
    "gastos_conciliados",
    "nominas_cerradas",
    "amortizaciones_calculadas",
    "modelo_303_4t_presentado",
    "modelo_390_presentado",
    "modelo_111_4t_presentado",
    "modelo_115_4t_presentado",
    "modelo_130_4t_presentado",
    "modelo_190_presentado",
    "modelo_180_presentado",
    "modelo_347_presentado",
    "modelo_349_4t_presentado",
    "regularizacion_iva_hecha",
    "asiento_regularizacion",
    "asiento_cierre",
    "asiento_apertura",
];

/**
 * Helper: obtener empresa_id según modo admin o asesor
 */
function getEmpresaId(req) {
    // Asesor mode: empresa_id from URL params
    if (req.params.empresa_id) return req.params.empresa_id;
    // Admin mode: empresa_id from user session
    return req.user.empresa_id;
}

/**
 * Helper: obtener o crear registro de cierre para empresa + ejercicio
 */
async function getOrCreateCierre(empresaId, ejercicio) {
    const existing = await sql`
        SELECT * FROM cierre_ejercicio_180
        WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio}
    `;

    if (existing.length > 0) return existing[0];

    const created = await sql`
        INSERT INTO cierre_ejercicio_180 (empresa_id, ejercicio)
        VALUES (${empresaId}, ${ejercicio})
        ON CONFLICT (empresa_id, ejercicio) DO NOTHING
        RETURNING *
    `;

    // If ON CONFLICT hit, re-fetch the existing row
    if (created.length === 0) {
        const [row] = await sql`
            SELECT * FROM cierre_ejercicio_180
            WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio}
        `;
        return row;
    }

    return created[0];
}

/**
 * Helper: registrar acción en el log
 */
async function logAccion(cierreId, accion, detalle, usuarioId) {
    await sql`
        INSERT INTO cierre_ejercicio_log_180 (cierre_id, accion, detalle, usuario_id)
        VALUES (${cierreId}, ${accion}, ${detalle || null}, ${usuarioId || null})
    `;
}

/**
 * GET /cierre/:ejercicio
 * Obtiene o crea el registro de cierre para una empresa y ejercicio.
 */
export async function getCierreEjercicio(req, res) {
    try {
        const empresaId = getEmpresaId(req);
        const ejercicio = parseInt(req.params.ejercicio);

        if (!ejercicio || ejercicio < 2000 || ejercicio > 2100) {
            return res.status(400).json({ error: "Ejercicio inválido" });
        }

        const cierre = await getOrCreateCierre(empresaId, ejercicio);

        // Calculate checklist progress
        const totalItems = CHECKLIST_FIELDS.length;
        const completedItems = CHECKLIST_FIELDS.filter(f => cierre[f] === true).length;
        const progress = Math.round((completedItems / totalItems) * 100);

        res.json({
            success: true,
            data: {
                ...cierre,
                progress,
                total_items: totalItems,
                completed_items: completedItems,
            }
        });
    } catch (error) {
        console.error("Error getCierreEjercicio:", error);
        res.status(500).json({ error: "Error obteniendo cierre de ejercicio" });
    }
}

/**
 * PUT /cierre/:ejercicio/checklist
 * Actualiza items individuales del checklist.
 * Body: { facturas_revisadas: true, gastos_conciliados: false, ... }
 */
export async function updateCierreChecklist(req, res) {
    try {
        const empresaId = getEmpresaId(req);
        const ejercicio = parseInt(req.params.ejercicio);
        const updates = req.body;

        if (!ejercicio) return res.status(400).json({ error: "Ejercicio requerido" });

        // Validate only checklist fields
        const validUpdates = {};
        for (const [key, value] of Object.entries(updates)) {
            if (CHECKLIST_FIELDS.includes(key) && typeof value === "boolean") {
                validUpdates[key] = value;
            }
        }

        if (Object.keys(validUpdates).length === 0) {
            return res.status(400).json({ error: "No hay campos válidos para actualizar" });
        }

        const cierre = await getOrCreateCierre(empresaId, ejercicio);

        // Check if closed
        if (cierre.estado === "cerrado") {
            return res.status(400).json({ error: "El ejercicio está cerrado. Reabre para modificar." });
        }

        // Build dynamic update
        const setClauses = Object.entries(validUpdates)
            .map(([key, val]) => `${key} = ${val}`)
            .join(", ");

        // Use sql tagged template for update
        const updated = await sql`
            UPDATE cierre_ejercicio_180
            SET ${sql(validUpdates)}, updated_at = now(),
                estado = CASE
                    WHEN estado = 'pendiente' THEN 'en_progreso'
                    ELSE estado
                END
            WHERE id = ${cierre.id}
            RETURNING *
        `;

        // Log changes
        const changedFields = Object.entries(validUpdates)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
        await logAccion(cierre.id, "checklist_update", changedFields, req.user?.id);

        const totalItems = CHECKLIST_FIELDS.length;
        const completedItems = CHECKLIST_FIELDS.filter(f => updated[0][f] === true).length;

        res.json({
            success: true,
            data: {
                ...updated[0],
                progress: Math.round((completedItems / totalItems) * 100),
                total_items: totalItems,
                completed_items: completedItems,
            }
        });
    } catch (error) {
        console.error("Error updateCierreChecklist:", error);
        res.status(500).json({ error: "Error actualizando checklist" });
    }
}

/**
 * POST /cierre/:ejercicio/calcular
 * Recalcula totales desde datos reales de factura_180, purchases_180, nominas_180.
 */
export async function calcularResumen(req, res) {
    try {
        const empresaId = getEmpresaId(req);
        const ejercicio = parseInt(req.params.ejercicio);

        if (!ejercicio) return res.status(400).json({ error: "Ejercicio requerido" });

        const startDate = `${ejercicio}-01-01`;
        const endDate = `${ejercicio}-12-31`;

        // Total ingresos (facturas emitidas válidas)
        const [ingresos] = await sql`
            SELECT COALESCE(SUM(subtotal), 0) as total
            FROM factura_180
            WHERE empresa_id = ${empresaId}
            AND estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND fecha BETWEEN ${startDate} AND ${endDate}
            AND (es_test IS NOT TRUE)
        `;

        // Total gastos (compras activas)
        const [gastos] = await sql`
            SELECT COALESCE(SUM(base_imponible), 0) as total
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND fecha_compra BETWEEN ${startDate} AND ${endDate}
        `;

        // IVA devengado (ventas)
        const [ivaDevengado] = await sql`
            SELECT COALESCE(SUM(lf.cantidad * lf.precio_unitario * lf.iva_percent / 100), 0) as total
            FROM factura_180 f
            JOIN lineafactura_180 lf ON lf.factura_id = f.id
            WHERE f.empresa_id = ${empresaId}
            AND f.estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND f.fecha BETWEEN ${startDate} AND ${endDate}
            AND (f.es_test IS NOT TRUE)
        `;

        // IVA soportado (compras)
        const [ivaSoportado] = await sql`
            SELECT COALESCE(SUM(COALESCE(cuota_iva, iva_importe, 0)), 0) as total
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND fecha_compra BETWEEN ${startDate} AND ${endDate}
        `;

        // Retenciones (compras + nóminas)
        const [retencionesCompras] = await sql`
            SELECT COALESCE(SUM(retencion_importe), 0) as total
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND retencion_importe > 0
            AND fecha_compra BETWEEN ${startDate} AND ${endDate}
        `;

        const [retencionesNominas] = await sql`
            SELECT COALESCE(SUM(irpf_retencion), 0) as total
            FROM nominas_180
            WHERE empresa_id = ${empresaId}
            AND anio = ${ejercicio}
        `;

        // Nóminas
        const [nominas] = await sql`
            SELECT
                COALESCE(SUM(bruto), 0) as total_bruto,
                COALESCE(SUM(seguridad_social_empresa), 0) as total_ss
            FROM nominas_180
            WHERE empresa_id = ${empresaId}
            AND anio = ${ejercicio}
        `;

        const totalIngresos = parseFloat(ingresos.total);
        const totalGastos = parseFloat(gastos.total);
        const totalNominasBruto = parseFloat(nominas.total_bruto);
        const totalSsEmpresa = parseFloat(nominas.total_ss);
        const totalRetenciones = parseFloat(retencionesCompras.total) + parseFloat(retencionesNominas.total);

        const resultadoEjercicio = totalIngresos - totalGastos - totalNominasBruto - totalSsEmpresa;
        const resultadoTipo = resultadoEjercicio >= 0 ? "beneficio" : "perdida";

        // Update cierre record
        const cierre = await getOrCreateCierre(empresaId, ejercicio);

        const updated = await sql`
            UPDATE cierre_ejercicio_180
            SET
                total_ingresos = ${totalIngresos},
                total_gastos = ${totalGastos},
                total_iva_devengado = ${parseFloat(ivaDevengado.total)},
                total_iva_soportado = ${parseFloat(ivaSoportado.total)},
                total_retenciones = ${totalRetenciones},
                total_nominas_bruto = ${totalNominasBruto},
                total_ss_empresa = ${totalSsEmpresa},
                resultado_ejercicio = ${resultadoEjercicio},
                resultado_tipo = ${resultadoTipo},
                updated_at = now()
            WHERE id = ${cierre.id}
            RETURNING *
        `;

        await logAccion(cierre.id, "resumen_calculado", `Resultado: ${resultadoEjercicio.toFixed(2)}€ (${resultadoTipo})`, req.user?.id);

        const totalItems = CHECKLIST_FIELDS.length;
        const completedItems = CHECKLIST_FIELDS.filter(f => updated[0][f] === true).length;

        res.json({
            success: true,
            data: {
                ...updated[0],
                progress: Math.round((completedItems / totalItems) * 100),
                total_items: totalItems,
                completed_items: completedItems,
            }
        });
    } catch (error) {
        console.error("Error calcularResumen:", error);
        res.status(500).json({ error: "Error calculando resumen del ejercicio" });
    }
}

/**
 * POST /cierre/:ejercicio/asiento-regularizacion
 * Genera asiento de regularización de IVA (grupo 47x → 4700).
 */
export async function generarAsientoRegularizacion(req, res) {
    try {
        const empresaId = getEmpresaId(req);
        const ejercicio = parseInt(req.params.ejercicio);
        const cierre = await getOrCreateCierre(empresaId, ejercicio);

        if (cierre.estado === "cerrado") {
            return res.status(400).json({ error: "El ejercicio está cerrado" });
        }

        const startDate = `${ejercicio}-01-01`;
        const endDate = `${ejercicio}-12-31`;

        // IVA repercutido anual (ventas)
        const [ivaRep] = await sql`
            SELECT COALESCE(SUM(lf.cantidad * lf.precio_unitario * lf.iva_percent / 100), 0) as total
            FROM factura_180 f
            JOIN lineafactura_180 lf ON lf.factura_id = f.id
            WHERE f.empresa_id = ${empresaId}
            AND f.estado IN ('VALIDADA', 'ENVIADA', 'COBRADA')
            AND f.fecha BETWEEN ${startDate} AND ${endDate}
            AND (f.es_test IS NOT TRUE)
        `;

        // IVA soportado anual (compras)
        const [ivaSop] = await sql`
            SELECT COALESCE(SUM(COALESCE(cuota_iva, iva_importe, 0)), 0) as total
            FROM purchases_180
            WHERE empresa_id = ${empresaId}
            AND activo = true
            AND fecha_compra BETWEEN ${startDate} AND ${endDate}
        `;

        const ivaRepercutido = parseFloat(ivaRep.total);
        const ivaSoportado = parseFloat(ivaSop.total);
        const diferencia = ivaRepercutido - ivaSoportado;

        if (Math.abs(diferencia) < 0.01) {
            return res.status(400).json({ error: "No hay diferencia de IVA a regularizar" });
        }

        const lineas = [];
        const fechaCierre = `${ejercicio}-12-31`;

        if (diferencia > 0) {
            // IVA a pagar: Debe 4770 (IVA repercutido), Haber 4700 (HP deudora)
            lineas.push(
                { cuenta_codigo: "4770", cuenta_nombre: "IVA repercutido", debe: ivaRepercutido, haber: 0, concepto: "Regularización IVA anual" },
                { cuenta_codigo: "4720", cuenta_nombre: "IVA soportado", debe: 0, haber: ivaSoportado, concepto: "Regularización IVA anual" },
                { cuenta_codigo: "4750", cuenta_nombre: "HP acreedora por IVA", debe: 0, haber: diferencia, concepto: "Regularización IVA anual" }
            );
        } else {
            // IVA a devolver
            lineas.push(
                { cuenta_codigo: "4770", cuenta_nombre: "IVA repercutido", debe: ivaRepercutido, haber: 0, concepto: "Regularización IVA anual" },
                { cuenta_codigo: "4720", cuenta_nombre: "IVA soportado", debe: 0, haber: ivaSoportado, concepto: "Regularización IVA anual" },
                { cuenta_codigo: "4700", cuenta_nombre: "HP deudora por IVA", debe: Math.abs(diferencia), haber: 0, concepto: "Regularización IVA anual" }
            );
        }

        const asiento = await contabilidadService.crearAsiento({
            empresaId,
            fecha: fechaCierre,
            concepto: `Regularización IVA ejercicio ${ejercicio}`,
            tipo: "cierre_iva",
            referencia_tipo: "cierre_ejercicio",
            referencia_id: cierre.id,
            lineas,
        });

        // Mark checklist
        await sql`
            UPDATE cierre_ejercicio_180
            SET regularizacion_iva_hecha = true, asiento_regularizacion = true, updated_at = now()
            WHERE id = ${cierre.id}
        `;

        await logAccion(cierre.id, "asiento_regularizacion_iva", `Asiento #${asiento.numero} - Diferencia IVA: ${diferencia.toFixed(2)}€`, req.user?.id);

        res.json({ success: true, data: { asiento, diferencia_iva: diferencia } });
    } catch (error) {
        console.error("Error generarAsientoRegularizacion:", error);
        res.status(500).json({ error: error.message || "Error generando asiento de regularización" });
    }
}

/**
 * POST /cierre/:ejercicio/asiento-cierre
 * Genera asiento de cierre (cuentas de ingresos/gastos grupo 6/7 → 129).
 */
export async function generarAsientoCierre(req, res) {
    try {
        const empresaId = getEmpresaId(req);
        const ejercicio = parseInt(req.params.ejercicio);
        const cierre = await getOrCreateCierre(empresaId, ejercicio);

        if (cierre.estado === "cerrado") {
            return res.status(400).json({ error: "El ejercicio está cerrado" });
        }

        // Get saldos of income (grupo 7) and expense (grupo 6) accounts
        const saldosGastos = await sql`
            SELECT la.cuenta_codigo, la.cuenta_nombre,
                COALESCE(SUM(la.debe), 0) as total_debe,
                COALESCE(SUM(la.haber), 0) as total_haber
            FROM asiento_lineas_180 la
            JOIN asientos_180 a ON a.id = la.asiento_id
            WHERE a.empresa_id = ${empresaId}
            AND a.ejercicio = ${ejercicio}
            AND la.cuenta_codigo LIKE '6%'
            GROUP BY la.cuenta_codigo, la.cuenta_nombre
            HAVING COALESCE(SUM(la.debe), 0) - COALESCE(SUM(la.haber), 0) != 0
        `;

        const saldosIngresos = await sql`
            SELECT la.cuenta_codigo, la.cuenta_nombre,
                COALESCE(SUM(la.debe), 0) as total_debe,
                COALESCE(SUM(la.haber), 0) as total_haber
            FROM asiento_lineas_180 la
            JOIN asientos_180 a ON a.id = la.asiento_id
            WHERE a.empresa_id = ${empresaId}
            AND a.ejercicio = ${ejercicio}
            AND la.cuenta_codigo LIKE '7%'
            GROUP BY la.cuenta_codigo, la.cuenta_nombre
            HAVING COALESCE(SUM(la.debe), 0) - COALESCE(SUM(la.haber), 0) != 0
        `;

        const lineas = [];
        let totalGastos = 0;
        let totalIngresos = 0;

        // Close expense accounts (grupo 6): normally debit balance → credit to close
        for (const row of saldosGastos) {
            const saldo = parseFloat(row.total_debe) - parseFloat(row.total_haber);
            if (Math.abs(saldo) < 0.01) continue;
            totalGastos += saldo;
            lineas.push({
                cuenta_codigo: row.cuenta_codigo,
                cuenta_nombre: row.cuenta_nombre,
                debe: saldo < 0 ? Math.abs(saldo) : 0,
                haber: saldo > 0 ? saldo : 0,
                concepto: "Asiento de cierre"
            });
        }

        // Close income accounts (grupo 7): normally credit balance → debit to close
        for (const row of saldosIngresos) {
            const saldo = parseFloat(row.total_haber) - parseFloat(row.total_debe);
            if (Math.abs(saldo) < 0.01) continue;
            totalIngresos += saldo;
            lineas.push({
                cuenta_codigo: row.cuenta_codigo,
                cuenta_nombre: row.cuenta_nombre,
                debe: saldo > 0 ? saldo : 0,
                haber: saldo < 0 ? Math.abs(saldo) : 0,
                concepto: "Asiento de cierre"
            });
        }

        const resultado = totalIngresos - totalGastos;

        if (lineas.length === 0) {
            return res.status(400).json({ error: "No hay cuentas de ingresos/gastos con saldo para cerrar" });
        }

        // Account 129: Resultado del ejercicio
        if (resultado >= 0) {
            // Beneficio: debe en 129
            lineas.push({
                cuenta_codigo: "1290",
                cuenta_nombre: "Resultado del ejercicio",
                debe: 0,
                haber: resultado,
                concepto: "Resultado del ejercicio - Beneficio"
            });
        } else {
            // Pérdida: haber en 129
            lineas.push({
                cuenta_codigo: "1290",
                cuenta_nombre: "Resultado del ejercicio",
                debe: Math.abs(resultado),
                haber: 0,
                concepto: "Resultado del ejercicio - Pérdida"
            });
        }

        const asiento = await contabilidadService.crearAsiento({
            empresaId,
            fecha: `${ejercicio}-12-31`,
            concepto: `Asiento de cierre ejercicio ${ejercicio}`,
            tipo: "cierre",
            referencia_tipo: "cierre_ejercicio",
            referencia_id: cierre.id,
            lineas,
        });

        await sql`
            UPDATE cierre_ejercicio_180
            SET asiento_cierre = true, updated_at = now()
            WHERE id = ${cierre.id}
        `;

        await logAccion(cierre.id, "asiento_cierre", `Asiento #${asiento.numero} - Resultado: ${resultado.toFixed(2)}€`, req.user?.id);

        res.json({ success: true, data: { asiento, resultado } });
    } catch (error) {
        console.error("Error generarAsientoCierre:", error);
        res.status(500).json({ error: error.message || "Error generando asiento de cierre" });
    }
}

/**
 * POST /cierre/:ejercicio/asiento-aplicacion-resultado
 *
 * Aplica el resultado del ejercicio (saldo de la cuenta 129) al destino que
 * corresponda según la decisión del titular o de la junta general:
 *
 *   - Beneficio (saldo acreedor en 129) → 113 Reservas voluntarias por defecto.
 *   - Pérdida (saldo deudor en 129)     → 121 Resultados negativos de ejercicios
 *                                         anteriores.
 *
 * Body opcional:
 *   { destino_codigo: '113' | '1140' | '1141' | '121', destino_nombre?: '...' }
 *
 * Sin este asiento, el saldo de 129 viajaría al ejercicio siguiente vía la
 * apertura, lo que es contablemente incorrecto. Por eso se ejecuta entre el
 * asiento de cierre y el de apertura.
 */
export async function generarAsientoAplicacionResultado(req, res) {
    try {
        const empresaId = getEmpresaId(req);
        const ejercicio = parseInt(req.params.ejercicio);
        const cierre = await getOrCreateCierre(empresaId, ejercicio);

        if (cierre.estado === "cerrado") {
            return res.status(400).json({ error: "El ejercicio está cerrado" });
        }

        const [saldoRow] = await sql`
            SELECT
                COALESCE(SUM(la.debe), 0)  AS total_debe,
                COALESCE(SUM(la.haber), 0) AS total_haber
            FROM asiento_lineas_180 la
            JOIN asientos_180 a ON a.id = la.asiento_id
            WHERE a.empresa_id = ${empresaId}
              AND a.ejercicio = ${ejercicio}
              AND la.cuenta_codigo LIKE '129%'
        `;

        const totalDebe = parseFloat(saldoRow?.total_debe || 0);
        const totalHaber = parseFloat(saldoRow?.total_haber || 0);
        const saldoAcreedor = totalHaber - totalDebe; // >0 beneficio, <0 pérdida

        if (Math.abs(saldoAcreedor) < 0.01) {
            return res.status(400).json({
                error: "La cuenta 129 no tiene saldo. Ejecuta primero el asiento de cierre."
            });
        }

        const esBeneficio = saldoAcreedor > 0;
        const importe = Math.abs(saldoAcreedor);

        const destinoCodigoDefault = esBeneficio ? "113" : "121";
        const destinoNombreDefault = esBeneficio
            ? "Reservas voluntarias"
            : "Resultados negativos de ejercicios anteriores";

        const destinoCodigo = req.body?.destino_codigo || destinoCodigoDefault;
        const destinoNombre = req.body?.destino_nombre || destinoNombreDefault;

        const lineas = esBeneficio
            ? [
                  { cuenta_codigo: "129", cuenta_nombre: "Resultado del ejercicio", debe: importe, haber: 0, concepto: "Aplicación del resultado" },
                  { cuenta_codigo: destinoCodigo, cuenta_nombre: destinoNombre,    debe: 0,       haber: importe, concepto: "Aplicación del resultado" }
              ]
            : [
                  { cuenta_codigo: destinoCodigo, cuenta_nombre: destinoNombre,    debe: importe, haber: 0,       concepto: "Aplicación del resultado" },
                  { cuenta_codigo: "129", cuenta_nombre: "Resultado del ejercicio", debe: 0,      haber: importe, concepto: "Aplicación del resultado" }
              ];

        const asiento = await contabilidadService.crearAsiento({
            empresaId,
            fecha: `${ejercicio}-12-31`,
            concepto: `Aplicación del resultado ejercicio ${ejercicio}`,
            tipo: "aplicacion_resultado",
            referencia_tipo: "cierre_ejercicio",
            referencia_id: cierre.id,
            lineas,
        });

        await sql`
            UPDATE cierre_ejercicio_180
            SET asiento_aplicacion_resultado = true,
                aplicacion_resultado_destino = ${destinoCodigo},
                updated_at = now()
            WHERE id = ${cierre.id}
        `;

        await logAccion(
            cierre.id,
            "asiento_aplicacion_resultado",
            `Asiento #${asiento.numero} - ${esBeneficio ? "Beneficio" : "Pérdida"} ${importe.toFixed(2)}€ → ${destinoCodigo}`,
            req.user?.id
        );

        res.json({
            success: true,
            data: {
                asiento,
                saldo_129: saldoAcreedor,
                destino_codigo: destinoCodigo,
                destino_nombre: destinoNombre
            }
        });
    } catch (error) {
        console.error("Error generarAsientoAplicacionResultado:", error);
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message || "Error generando asiento de aplicación del resultado" });
    }
}

/**
 * POST /cierre/:ejercicio/asiento-apertura
 * Genera asiento de apertura para el ejercicio siguiente (inverso del balance).
 */
export async function generarAsientoApertura(req, res) {
    try {
        const empresaId = getEmpresaId(req);
        const ejercicio = parseInt(req.params.ejercicio);
        const cierre = await getOrCreateCierre(empresaId, ejercicio);

        if (cierre.estado === "cerrado") {
            return res.status(400).json({ error: "El ejercicio está cerrado" });
        }

        // Si la cuenta 129 aún tiene saldo, exigir aplicación de resultado antes
        // de la apertura (de lo contrario, el resultado viaja al ejercicio
        // siguiente sin haberse repartido a reservas o pérdidas acumuladas).
        if (!cierre.asiento_aplicacion_resultado) {
            const [saldo129] = await sql`
                SELECT COALESCE(SUM(la.debe), 0) - COALESCE(SUM(la.haber), 0) AS saldo_deudor
                FROM asiento_lineas_180 la
                JOIN asientos_180 a ON a.id = la.asiento_id
                WHERE a.empresa_id = ${empresaId}
                  AND a.ejercicio = ${ejercicio}
                  AND la.cuenta_codigo LIKE '129%'
            `;
            if (saldo129 && Math.abs(parseFloat(saldo129.saldo_deudor || 0)) > 0.01) {
                return res.status(400).json({
                    error: "La cuenta 129 tiene saldo. Ejecuta primero el asiento de aplicación del resultado."
                });
            }
        }

        // Get balance accounts (grupo 1-5) saldos at year end
        const saldos = await sql`
            SELECT la.cuenta_codigo, la.cuenta_nombre,
                COALESCE(SUM(la.debe), 0) as total_debe,
                COALESCE(SUM(la.haber), 0) as total_haber
            FROM asiento_lineas_180 la
            JOIN asientos_180 a ON a.id = la.asiento_id
            WHERE a.empresa_id = ${empresaId}
            AND a.ejercicio = ${ejercicio}
            AND la.cuenta_codigo ~ '^[1-5]'
            GROUP BY la.cuenta_codigo, la.cuenta_nombre
            HAVING ABS(COALESCE(SUM(la.debe), 0) - COALESCE(SUM(la.haber), 0)) > 0.01
        `;

        if (saldos.length === 0) {
            return res.status(400).json({ error: "No hay cuentas de balance con saldo para abrir" });
        }

        const lineas = [];
        for (const row of saldos) {
            const saldo = parseFloat(row.total_debe) - parseFloat(row.total_haber);
            if (Math.abs(saldo) < 0.01) continue;

            lineas.push({
                cuenta_codigo: row.cuenta_codigo,
                cuenta_nombre: row.cuenta_nombre,
                debe: saldo > 0 ? saldo : 0,
                haber: saldo < 0 ? Math.abs(saldo) : 0,
                concepto: "Asiento de apertura"
            });
        }

        if (lineas.length < 2) {
            return res.status(400).json({ error: "No hay suficientes cuentas para generar asiento de apertura" });
        }

        const siguienteEjercicio = ejercicio + 1;
        const asiento = await contabilidadService.crearAsiento({
            empresaId,
            fecha: `${siguienteEjercicio}-01-01`,
            concepto: `Asiento de apertura ejercicio ${siguienteEjercicio}`,
            tipo: "apertura",
            referencia_tipo: "cierre_ejercicio",
            referencia_id: cierre.id,
            lineas,
        });

        await sql`
            UPDATE cierre_ejercicio_180
            SET asiento_apertura = true, updated_at = now()
            WHERE id = ${cierre.id}
        `;

        await logAccion(cierre.id, "asiento_apertura", `Asiento #${asiento.numero} para ejercicio ${siguienteEjercicio}`, req.user?.id);

        res.json({ success: true, data: { asiento, ejercicio_apertura: siguienteEjercicio } });
    } catch (error) {
        console.error("Error generarAsientoApertura:", error);
        res.status(500).json({ error: error.message || "Error generando asiento de apertura" });
    }
}

/**
 * POST /cierre/:ejercicio/cerrar
 * Marca el ejercicio como cerrado. Valida que todo el checklist esté completado.
 */
export async function cerrarEjercicio(req, res) {
    try {
        const empresaId = getEmpresaId(req);
        const ejercicio = parseInt(req.params.ejercicio);
        const cierre = await getOrCreateCierre(empresaId, ejercicio);

        if (cierre.estado === "cerrado") {
            return res.status(400).json({ error: "El ejercicio ya está cerrado" });
        }

        // Validate all checklist items
        const pendientes = CHECKLIST_FIELDS.filter(f => cierre[f] !== true);
        if (pendientes.length > 0) {
            return res.status(400).json({
                error: "No se puede cerrar: hay items pendientes en el checklist",
                pendientes,
            });
        }

        const updated = await sql`
            UPDATE cierre_ejercicio_180
            SET estado = 'cerrado',
                cerrado_por = ${req.user?.id || null},
                cerrado_at = now(),
                updated_at = now()
            WHERE id = ${cierre.id}
            RETURNING *
        `;

        // Sincronizar con ejercicios_contables_180 para que el motor contable
        // (crearAsiento + assertEjercicioAbierto) también bloquee mutaciones.
        await sql`
            UPDATE ejercicios_contables_180
            SET estado = 'cerrado', updated_at = now()
            WHERE empresa_id = ${empresaId} AND anio = ${ejercicio}
        `;

        await logAccion(cierre.id, "ejercicio_cerrado", `Cerrado por ${req.user?.nombre || req.user?.email || "usuario"}`, req.user?.id);

        res.json({ success: true, data: updated[0] });
    } catch (error) {
        console.error("Error cerrarEjercicio:", error);
        res.status(500).json({ error: "Error cerrando ejercicio" });
    }
}

/**
 * POST /cierre/:ejercicio/reabrir
 * Reabre un ejercicio cerrado. Requiere motivo.
 */
export async function reabrirEjercicio(req, res) {
    try {
        const empresaId = getEmpresaId(req);
        const ejercicio = parseInt(req.params.ejercicio);
        const { motivo } = req.body;

        if (!motivo) {
            return res.status(400).json({ error: "Se requiere un motivo para reabrir el ejercicio" });
        }

        const cierre = await getOrCreateCierre(empresaId, ejercicio);

        if (cierre.estado !== "cerrado") {
            return res.status(400).json({ error: "El ejercicio no está cerrado" });
        }

        const updated = await sql`
            UPDATE cierre_ejercicio_180
            SET estado = 'reabierto',
                reabierto_por = ${req.user?.id || null},
                reabierto_at = now(),
                updated_at = now()
            WHERE id = ${cierre.id}
            RETURNING *
        `;

        // Reabrir también el ejercicio contable.
        await sql`
            UPDATE ejercicios_contables_180
            SET estado = 'abierto', updated_at = now()
            WHERE empresa_id = ${empresaId} AND anio = ${ejercicio}
        `;

        await logAccion(cierre.id, "ejercicio_reabierto", `Motivo: ${motivo}`, req.user?.id);

        res.json({ success: true, data: updated[0] });
    } catch (error) {
        console.error("Error reabrirEjercicio:", error);
        res.status(500).json({ error: "Error reabriendo ejercicio" });
    }
}

/**
 * GET /cierre/:ejercicio/log
 * Devuelve el historial de acciones del cierre.
 */
export async function getCierreLog(req, res) {
    try {
        const empresaId = getEmpresaId(req);
        const ejercicio = parseInt(req.params.ejercicio);

        const cierre = await getOrCreateCierre(empresaId, ejercicio);

        const log = await sql`
            SELECT l.*, u.nombre as usuario_nombre, u.email as usuario_email
            FROM cierre_ejercicio_log_180 l
            LEFT JOIN users_180 u ON u.id = l.usuario_id
            WHERE l.cierre_id = ${cierre.id}
            ORDER BY l.created_at DESC
            LIMIT 100
        `;

        res.json({ success: true, data: log });
    } catch (error) {
        console.error("Error getCierreLog:", error);
        res.status(500).json({ error: "Error obteniendo log del cierre" });
    }
}
