import { sql } from '../db.js';

/**
 * Helper para obtener empresa_id de manera segura
 */
async function getEmpresaId(userId) {
    const r = await sql`select id from empresa_180 where user_id=${userId} limit 1`;
    if (!r[0]) {
        const e = new Error("Empresa no asociada");
        e.status = 403;
        throw e;
    }
    return r[0].id;
}

/**
 * Obtener métricas y KPIs para el Dashboard de Facturación
 */
export async function getDashboardData(req, res) {
    try {
        const empresaId = await getEmpresaId(req.user.id);
        const { year, cliente_id, estado } = req.query;

        const currentYear = year ? parseInt(year) : new Date().getFullYear();
        const prevYear = currentYear - 1;

        // --- FILTROS BASE ---
        // Construimos condiciones dinámicas para reutilizar
        let baseConditions = sql`empresa_id = ${empresaId} AND rectificativa = false`;
        // Nota: Por defecto excluimos rectificativas de los KPIs generales para no distorsionar brutos, 
        // aunque contablemente se deben restar. 
        // En la versión Python: or_(estado == "VALIDADA", estado == "ANULADA"), Factura.rectificativa == False

        // Filtro estado KPI (Validada o Anulada, excluye borrador)
        let kpiStatus = sql`AND estado IN ('VALIDADA', 'ANULADA')`;

        let clienteFilter = sql``;
        if (cliente_id) {
            clienteFilter = sql`AND cliente_id = ${cliente_id}`;
        }

        // ==========================================
        // 1. TOTALES ANUALES (Facturado este año)
        // ==========================================
        const [totalAnual] = await sql`
      SELECT 
        COALESCE(SUM(total), 0) as total,
        COUNT(id) as num_facturas
      FROM factura_180
      WHERE ${baseConditions}
        ${kpiStatus}
        ${clienteFilter}
        AND EXTRACT(YEAR FROM fecha) = ${currentYear}
    `;

        // ==========================================
        // 2. COMPARATIVA AÑO ANTERIOR
        // ==========================================
        const [totalAnterior] = await sql`
      SELECT COALESCE(SUM(total), 0) as total
      FROM factura_180
      WHERE ${baseConditions}
        ${kpiStatus}
        ${clienteFilter}
        AND EXTRACT(YEAR FROM fecha) = ${prevYear}
    `;

        // ==========================================
        // 2b. TOTAL MES ANTERIOR (Real)
        // ==========================================
        const [totalMesAnterior] = await sql`
      SELECT COALESCE(SUM(total), 0) as total
      FROM factura_180
      WHERE ${baseConditions}
        ${kpiStatus}
        ${clienteFilter}
        AND fecha >= date_trunc('month', current_date - interval '1 month')
        AND fecha < date_trunc('month', current_date)
    `;

        // ==========================================
        // 3. EVOLUCIÓN MENSUAL (Gráfico)
        // ==========================================
        const mensualRows = await sql`
      SELECT 
        EXTRACT(MONTH FROM fecha) as mes,
        SUM(total) as total
      FROM factura_180
      WHERE ${baseConditions}
        ${kpiStatus}
        ${clienteFilter}
        AND EXTRACT(YEAR FROM fecha) = ${currentYear}
      GROUP BY mes
      ORDER BY mes
    `;

        // Normalizar a array de 12 meses
        const meses = [];
        const totalesGrafico = [];
        const mapMeses = {};
        mensualRows.forEach(row => {
            mapMeses[parseInt(row.mes)] = parseFloat(row.total);
        });

        for (let i = 1; i <= 12; i++) {
            meses.push(i);
            totalesGrafico.push(mapMeses[i] || 0);
        }

        // ==========================================
        // 4. GENERACIÓN DE ALERTAS (Lógica de negocio)
        // ==========================================
        const alertas = [];

        // Alerta: Caída de facturación
        const facturacionActual = parseFloat(totalAnual.total);
        const facturacionAnterior = parseFloat(totalAnterior.total);

        if (facturacionAnterior > 0) {
            const variacion = ((facturacionActual - facturacionAnterior) / facturacionAnterior) * 100;
            if (variacion <= -20) {
                alertas.push({
                    tipo: variacion <= -40 ? 'error' : 'warning',
                    mensaje: `La facturación ha caído un ${Math.abs(variacion).toFixed(1)}% respecto al año anterior.`
                });
            }
        }

        // Alerta: Borradores antiguos (>30 días)
        const [borradores] = await sql`
      SELECT COUNT(*) as count 
      FROM factura_180 
      WHERE empresa_id = ${empresaId} 
        AND estado = 'BORRADOR' 
        AND fecha < NOW() - INTERVAL '30 days'
    `;

        if (parseInt(borradores.count) > 0) {
            alertas.push({
                tipo: 'info',
                mensaje: `Hay ${borradores.count} borrador(es) antigüos (>30 días).`,
                accion: { texto: 'Revisar', url: '/admin/facturacion?estado=BORRADOR' }
            });
        }

        // Alerta: Pendientes de validar (Cualquier borrador)
        const [pendientes] = await sql`
      SELECT COUNT(*) as count 
      FROM factura_180 
      WHERE empresa_id = ${empresaId} 
        AND estado = 'BORRADOR'
    `;

        if (parseInt(pendientes.count) > 0) {
            alertas.push({
                tipo: 'info',
                mensaje: `Tienes ${pendientes.count} factura(s) pendiente(s) de validar.`
            });
        }

        // Alerta: IVA no configurado
        const [ivaCheck] = await sql`
      SELECT COUNT(*) as count 
      FROM iva_180 
      WHERE empresa_id = ${empresaId} AND activo = true
    `;

        if (parseInt(ivaCheck.count) === 0) {
            alertas.push({
                tipo: 'warning',
                mensaje: 'No hay tipos de IVA configurados.',
                accion: { texto: 'Configurar', url: '/admin/facturacion/configuracion' }
            });
        }

        // Alerta: Certificado Digital (Caducidad)
        // Obtenemos path del certificado para verificar (placeholder lógico)
        const [emisor] = await sql`
      SELECT certificado_path, certificado_password 
      FROM emisor_180 
      WHERE empresa_id = ${empresaId}
    `;

        if (!emisor || !emisor.certificado_path) {
            alertas.push({
                tipo: 'warning',
                mensaje: 'Certificado digital no configurado. No podrás firmar facturas para Veri*Factu.'
            });
        } else {
            // TODO: En producción, leeríamos el PFX aquí con 'node-forge' o similar para ver fecha exp.
            // Por ahora omitimos la lógica compleja de lectura de binarios PFX en este paso inicial.
        }

        res.json({
            success: true,
            data: {
                kpis: {
                    total_anual: facturacionActual,
                    total_anterior: facturacionAnterior,
                    total_mes_anterior: parseFloat(totalMesAnterior.total),
                    num_facturas: parseInt(totalAnual.num_facturas),
                    variacion_percent: facturacionAnterior > 0
                        ? ((facturacionActual - facturacionAnterior) / facturacionAnterior) * 100
                        : null
                },
                grafico: {
                    meses,
                    totales: totalesGrafico
                },
                alertas
            }
        });

    } catch (err) {
        console.error("❌ getDashboardData:", err);
        res.status(500).json({ success: false, error: "Error obteniendo datos del dashboard" });
    }
}
