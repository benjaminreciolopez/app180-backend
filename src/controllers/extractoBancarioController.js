// backend/src/controllers/extractoBancarioController.js
import { sql } from "../db.js";
import {
  parsearExtracto,
  matchearMovimientos,
} from "../services/extractoBancarioService.js";
import {
  generarAsientoCobro,
  generarAsientoPagoGasto,
} from "../services/contabilidadService.js";

/**
 * POST /contabilidad/importar-extracto
 * Sube un fichero de extracto bancario (CSV/Excel/OFX), lo parsea y devuelve movimientos.
 */
export async function importarExtracto(req, res) {
  try {
    const empresaId = req.user.empresa_id;

    if (!req.file) {
      return res.status(400).json({ error: "No se ha subido ningún archivo" });
    }

    const movimientos = await parsearExtracto(
      req.file.buffer,
      req.file.originalname
    );

    if (!movimientos || movimientos.length === 0) {
      return res.status(400).json({
        error: "No se pudieron extraer movimientos del archivo. Verifica el formato.",
      });
    }

    res.json({
      movimientos,
      total: movimientos.length,
      ingresos: movimientos.filter((m) => m.importe > 0).length,
      gastos: movimientos.filter((m) => m.importe < 0).length,
      filename: req.file.originalname,
    });
  } catch (err) {
    console.error("Error importarExtracto:", err);
    res.status(500).json({ error: err.message || "Error procesando extracto bancario" });
  }
}

/**
 * POST /contabilidad/extracto/matchear
 * Recibe movimientos parseados y usa IA para matchearlos con facturas/gastos/nóminas.
 */
export async function matchearExtracto(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const { movimientos } = req.body;

    if (!Array.isArray(movimientos) || movimientos.length === 0) {
      return res.status(400).json({ error: "No hay movimientos para matchear" });
    }

    const resultado = await matchearMovimientos(movimientos, empresaId);

    // Stats
    const stats = {
      total: resultado.length,
      alto: resultado.filter((m) => m.confianza === "alto").length,
      medio: resultado.filter((m) => m.confianza === "medio").length,
      bajo: resultado.filter((m) => m.confianza === "bajo").length,
      sin_match: resultado.filter((m) => m.confianza === "sin_match").length,
    };

    res.json({ movimientos: resultado, stats });
  } catch (err) {
    console.error("Error matchearExtracto:", err);
    res.status(500).json({ error: "Error matcheando movimientos con IA" });
  }
}

/**
 * POST /contabilidad/extracto/confirmar
 * Genera asientos contables para los matches confirmados por el usuario.
 *
 * Body: { confirmados: [{ fecha, concepto, importe, match_tipo, match_id }] }
 */
export async function confirmarExtracto(req, res) {
  try {
    const empresaId = req.user.empresa_id;
    const creadoPor = req.user.id;
    const { confirmados } = req.body;

    if (!Array.isArray(confirmados) || confirmados.length === 0) {
      return res.status(400).json({ error: "No hay movimientos confirmados" });
    }

    const resultados = { generados: 0, errores: [], omitidos: 0 };

    for (const mov of confirmados) {
      try {
        if (!mov.match_tipo || !mov.match_id) {
          resultados.omitidos++;
          continue;
        }

        if (mov.match_tipo === "factura") {
          // Cobro de factura → generar asiento de cobro
          const [factura] = await sql`
            SELECT f.id, f.numero, f.cliente_id, f.total,
                   c.nombre AS cliente_nombre
            FROM factura_180 f
            LEFT JOIN clients_180 c ON c.id = f.cliente_id
            WHERE f.id = ${mov.match_id}::int AND f.empresa_id = ${empresaId}
          `;

          if (factura) {
            const importe = Math.abs(mov.importe);
            await generarAsientoCobro(empresaId, {
              paymentId: `extracto_${Date.now()}_${mov.match_id}`,
              metodo: "transferencia",
              importe,
              fecha: mov.fecha,
              facturaId: factura.id,
              facturaNumero: factura.numero,
              clienteId: factura.cliente_id,
              clienteNombre: factura.cliente_nombre,
              creadoPor,
            });

            // Update factura pagado
            await sql`
              UPDATE factura_180
              SET pagado = LEAST(total, COALESCE(pagado, 0) + ${importe}),
                  estado_pago = CASE
                    WHEN COALESCE(pagado, 0) + ${importe} >= total - 0.01 THEN 'pagado'
                    ELSE 'parcial'
                  END
              WHERE id = ${factura.id} AND empresa_id = ${empresaId}
            `;

            resultados.generados++;
          }
        } else if (mov.match_tipo === "gasto") {
          // Pago de gasto → generar asiento de pago
          const [gasto] = await sql`
            SELECT * FROM purchases_180
            WHERE id = ${mov.match_id}::uuid AND empresa_id = ${empresaId}
          `;

          if (gasto) {
            // Use the gasto with metodo_pago = transferencia (from bank)
            await generarAsientoPagoGasto(
              empresaId,
              { ...gasto, metodo_pago: gasto.metodo_pago || "transferencia" },
              creadoPor
            );
            resultados.generados++;
          }
        } else if (mov.match_tipo === "nomina") {
          // For nóminas, we'd generate a payment entry (465→572)
          // Simplified: mark as informational
          resultados.omitidos++;
        }
      } catch (err) {
        resultados.errores.push(`${mov.concepto}: ${err.message}`);
      }
    }

    res.json(resultados);
  } catch (err) {
    console.error("Error confirmarExtracto:", err);
    res.status(500).json({ error: "Error generando asientos desde extracto" });
  }
}
