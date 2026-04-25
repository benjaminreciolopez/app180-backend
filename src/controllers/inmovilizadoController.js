/**
 * Inmovilizado: bienes afectos a la actividad sometidos a amortización.
 * Se reutilizan estos endpoints desde el panel admin (empresa autoservicio)
 * y desde el portal asesor (vía empresa_id en path).
 */
import { sql } from "../db.js";
import { COEFS_DEFECTO, calcularAmortizacionAcumulada } from "../services/amortizacionService.js";
import logger from "../utils/logger.js";

function resolveEmpresaId(req) {
    return req.params.empresa_id || req.user?.empresa_id;
}

const GRUPOS_VALIDOS = Object.keys(COEFS_DEFECTO);

export async function listarInmovilizado(req, res) {
    try {
        const empresaId = resolveEmpresaId(req);
        if (!empresaId) return res.status(400).json({ success: false, error: "empresa_id requerido" });

        const rows = await sql`
            SELECT id, descripcion, fecha_alta, fecha_baja,
                   valor_adquisicion, valor_residual, grupo,
                   coef_amortizacion_pct, metodo,
                   cuenta_inmovilizado, cuenta_amortizacion_acumulada, cuenta_dotacion,
                   purchase_id, notas, created_at, updated_at
            FROM inmovilizado_180
            WHERE empresa_id = ${empresaId} AND deleted_at IS NULL
            ORDER BY fecha_alta DESC, descripcion
        `;
        return res.json({ success: true, items: rows });
    } catch (err) {
        logger.error("listarInmovilizado failed", { message: err.message });
        return res.status(500).json({ success: false, error: err.message });
    }
}

export async function getInmovilizadoConAmortizacion(req, res) {
    try {
        const empresaId = resolveEmpresaId(req);
        const { ejercicio } = req.params;
        if (!empresaId) return res.status(400).json({ success: false, error: "empresa_id requerido" });
        const yearInt = parseInt(ejercicio);
        if (!yearInt) return res.status(400).json({ success: false, error: "ejercicio inválido" });

        const desde = `${yearInt}-01-01`;
        const hasta = `${yearInt}-12-31`;
        const acum = await calcularAmortizacionAcumulada(empresaId, desde, hasta);
        return res.json({ success: true, ejercicio: yearInt, ...acum });
    } catch (err) {
        logger.error("getInmovilizadoConAmortizacion failed", { message: err.message });
        return res.status(500).json({ success: false, error: err.message });
    }
}

export async function crearInmovilizado(req, res) {
    try {
        const empresaId = resolveEmpresaId(req);
        if (!empresaId) return res.status(400).json({ success: false, error: "empresa_id requerido" });

        const {
            descripcion, fecha_alta, valor_adquisicion, valor_residual = 0,
            grupo, coef_amortizacion_pct, metodo = 'lineal',
            cuenta_inmovilizado, cuenta_amortizacion_acumulada, cuenta_dotacion,
            purchase_id, notas
        } = req.body || {};

        if (!descripcion || !fecha_alta || !valor_adquisicion || !grupo) {
            return res.status(400).json({
                success: false,
                error: "Campos requeridos: descripcion, fecha_alta, valor_adquisicion, grupo"
            });
        }
        if (!GRUPOS_VALIDOS.includes(grupo)) {
            return res.status(400).json({
                success: false,
                error: `grupo inválido. Valores: ${GRUPOS_VALIDOS.join(', ')}`
            });
        }
        const coef = parseFloat(coef_amortizacion_pct) || COEFS_DEFECTO[grupo];

        const [row] = await sql`
            INSERT INTO inmovilizado_180 (
                empresa_id, descripcion, fecha_alta, valor_adquisicion, valor_residual,
                grupo, coef_amortizacion_pct, metodo,
                cuenta_inmovilizado, cuenta_amortizacion_acumulada, cuenta_dotacion,
                purchase_id, notas
            ) VALUES (
                ${empresaId}, ${descripcion}, ${fecha_alta}, ${valor_adquisicion}, ${valor_residual},
                ${grupo}, ${coef}, ${metodo},
                ${cuenta_inmovilizado || null}, ${cuenta_amortizacion_acumulada || null}, ${cuenta_dotacion || null},
                ${purchase_id || null}, ${notas || null}
            )
            RETURNING *
        `;
        return res.status(201).json({ success: true, item: row });
    } catch (err) {
        logger.error("crearInmovilizado failed", { message: err.message });
        return res.status(500).json({ success: false, error: err.message });
    }
}

export async function actualizarInmovilizado(req, res) {
    try {
        const empresaId = resolveEmpresaId(req);
        const { id } = req.params;
        if (!empresaId) return res.status(400).json({ success: false, error: "empresa_id requerido" });

        const allowed = [
            'descripcion', 'fecha_alta', 'fecha_baja',
            'valor_adquisicion', 'valor_residual',
            'grupo', 'coef_amortizacion_pct', 'metodo',
            'cuenta_inmovilizado', 'cuenta_amortizacion_acumulada', 'cuenta_dotacion',
            'purchase_id', 'notas'
        ];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, error: "No hay campos a actualizar" });
        }
        if (updates.grupo && !GRUPOS_VALIDOS.includes(updates.grupo)) {
            return res.status(400).json({ success: false, error: "grupo inválido" });
        }

        const [row] = await sql`
            UPDATE inmovilizado_180
            SET ${sql(updates)},
                updated_at = NOW()
            WHERE id = ${id} AND empresa_id = ${empresaId} AND deleted_at IS NULL
            RETURNING *
        `;
        if (!row) return res.status(404).json({ success: false, error: "Inmovilizado no encontrado" });
        return res.json({ success: true, item: row });
    } catch (err) {
        logger.error("actualizarInmovilizado failed", { message: err.message });
        return res.status(500).json({ success: false, error: err.message });
    }
}

export async function eliminarInmovilizado(req, res) {
    try {
        const empresaId = resolveEmpresaId(req);
        const { id } = req.params;
        if (!empresaId) return res.status(400).json({ success: false, error: "empresa_id requerido" });

        const [row] = await sql`
            UPDATE inmovilizado_180
            SET deleted_at = NOW(), updated_at = NOW()
            WHERE id = ${id} AND empresa_id = ${empresaId} AND deleted_at IS NULL
            RETURNING id
        `;
        if (!row) return res.status(404).json({ success: false, error: "Inmovilizado no encontrado" });
        return res.json({ success: true });
    } catch (err) {
        logger.error("eliminarInmovilizado failed", { message: err.message });
        return res.status(500).json({ success: false, error: err.message });
    }
}
