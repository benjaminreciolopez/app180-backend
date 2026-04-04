import { sql } from '../db.js';

/**
 * Helper para obtener empresa_id de manera segura
 */
async function getEmpresaId(userIdOrReq) {
    if (typeof userIdOrReq === 'object' && userIdOrReq.user) {
        if (userIdOrReq.user.empresa_id) return userIdOrReq.user.empresa_id;
        userIdOrReq = userIdOrReq.user.id;
    }
    const r = await sql`select id from empresa_180 where user_id=${userIdOrReq} limit 1`;
    if (!r[0]) {
        const e = new Error("Empresa no asociada");
        e.status = 403;
        throw e;
    }
    return r[0].id;
}

/**
 * 📊 INFORME: IVA Trimestral
 * Devuelve desglose de Bases, Cuotas y Totales por tipos de IVA en un trimestre dado.
 */
export async function getIvaTrimestral(req, res) {
    try {
        const empresaId = await getEmpresaId(req);
        const { year, trimestre } = req.query;

        // Si no hay trimestre, devolvemos resumen anual por trimestres
        if (!trimestre) {
            const data = await sql`
                SELECT 
                    EXTRACT(QUARTER FROM fecha) as trimestre,
                    SUM(subtotal) as base_imponible,
                    SUM(iva_total) as cuota_iva,
                    SUM(total) as total_facturado
                FROM factura_180
                WHERE empresa_id = ${empresaId}
                    AND estado IN ('VALIDADA', 'ANULADA')
                    AND EXTRACT(YEAR FROM fecha) = ${year}
                    AND (es_test IS NOT TRUE)
                GROUP BY trimestre
                ORDER BY trimestre ASC
             `;

            // Formatear respuesta: { "1T": {...}, "2T": {...} }
            const result = {};
            ['1', '2', '3', '4'].forEach(t => {
                const row = data.find(d => d.trimestre == t) || { base_imponible: 0, cuota_iva: 0, total_facturado: 0 };
                result[`${t}T`] = {
                    base: parseFloat(row.base_imponible || 0),
                    iva: parseFloat(row.cuota_iva || 0),
                    total: parseFloat(row.total_facturado || 0)
                };
            });

            return res.json({ success: true, data: result });
        }

        const mapTrimestre = {
            1: [1, 3],
            2: [4, 6],
            3: [7, 9],
            4: [10, 12]
        };

        const range = mapTrimestre[parseInt(trimestre)];
        if (!range) {
            return res.status(400).json({ error: "Trimestre inválido (1-4)" });
        }

        const data = await sql`
      SELECT 
        l.iva_percent as tipo_iva,
        COUNT(DISTINCT f.id) as num_facturas,
        SUM(l.cantidad * l.precio_unitario) as base_imponible,
        SUM(l.total - (l.cantidad * l.precio_unitario)) as cuota_iva,
        SUM(l.total) as total_facturado
      FROM factura_180 f
      JOIN lineafactura_180 l ON l.factura_id = f.id
      WHERE f.empresa_id = ${empresaId}
        AND f.estado IN ('VALIDADA', 'ANULADA')
        AND EXTRACT(YEAR FROM f.fecha) = ${year}
        AND EXTRACT(MONTH FROM f.fecha) >= ${range[0]}
        AND EXTRACT(MONTH FROM f.fecha) <= ${range[1]}
        AND (f.es_test IS NOT TRUE)
      GROUP BY l.iva_percent
      ORDER BY l.iva_percent ASC
    `;

        // Totales
        const totales = data.reduce((acc, row) => ({
            base: acc.base + parseFloat(row.base_imponible || 0),
            cuota: acc.cuota + parseFloat(row.cuota_iva || 0),
            total: acc.total + parseFloat(row.total_facturado || 0)
        }), { base: 0, cuota: 0, total: 0 });

        res.json({
            success: true,
            data_desglosada: data,
            totales,
            meta: { year, trimestre }
        });

    } catch (err) {
        console.error("Error getIvaTrimestral:", err);
        res.status(500).json({ success: false, error: "Error generando informe de IVA" });
    }
}

/**
 * 📊 INFORME: Facturación Anual (Mensualizada)
 */
export async function getFacturacionAnual(req, res) {
    try {
        const empresaId = await getEmpresaId(req);
        const { year } = req.query;

        if (!year) return res.status(400).json({ error: "Año requerido" });

        const rows = await sql`
      SELECT 
        EXTRACT(MONTH FROM fecha) as mes,
        SUM(subtotal) as base,
        SUM(iva_total) as cuota,
        SUM(total) as total,
        COUNT(id) as num_facturas
      FROM factura_180
      WHERE empresa_id = ${empresaId}
        AND estado IN ('VALIDADA', 'ANULADA')
        AND EXTRACT(YEAR FROM fecha) = ${year}
        AND (es_test IS NOT TRUE)
      GROUP BY mes
      ORDER BY mes ASC
    `;

        // Rellenar meses vacíos
        const meses = [];
        for (let i = 1; i <= 12; i++) {
            const found = rows.find(r => parseInt(r.mes) === i);
            meses.push(found || {
                mes: i, base: 0, cuota: 0, total: 0, num_facturas: 0
            });
        }

        res.json({
            success: true,
            data: meses,
            year
        });

    } catch (err) {
        console.error("Error getFacturacionAnual:", err);
        res.status(500).json({ success: false, error: "Error generando informe anual" });
    }
}

/**
 * 📊 INFORME: Ranking de Clientes
 */
export async function getRankingClientes(req, res) {
    try {
        const empresaId = await getEmpresaId(req);
        const { year } = req.query;

        let yearFilter = sql``;
        if (year) {
            yearFilter = sql`AND EXTRACT(YEAR FROM f.fecha) = ${year}`;
        }

        const ranking = await sql`
      SELECT 
        c.id,
        c.nombre,
        COALESCE(NULLIF(fd.nif_cif, ''), NULLIF(c.nif_cif, ''), NULLIF(c.nif, '')) as nif_cif,
        COUNT(f.id) as num_facturas,
        SUM(f.total) as total_facturado
      FROM clients_180 c
      LEFT JOIN client_fiscal_data_180 fd ON fd.cliente_id = c.id
      JOIN factura_180 f ON f.cliente_id = c.id
      WHERE f.empresa_id = ${empresaId}
        AND f.estado IN ('VALIDADA', 'ANULADA')
        AND (f.es_test IS NOT TRUE)
        ${yearFilter}
      GROUP BY c.id, c.nombre, fd.nif_cif, c.nif_cif, c.nif
      ORDER BY total_facturado DESC
      LIMIT 50
    `;

        res.json({
            success: true,
            data: ranking.map(r => ({
                ...r,
                num_facturas: parseInt(r.num_facturas),
                total_facturado: parseFloat(r.total_facturado || 0)
            }))
        });

    } catch (err) {
        console.error("Error getRankingClientes:", err);
        res.status(500).json({ success: false, error: "Error generando ranking" });
    }
}
