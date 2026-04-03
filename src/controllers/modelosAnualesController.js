// backend/src/controllers/modelosAnualesController.js
// Controller para modelos anuales AEAT: 390, 190, 180, 347

import { sql } from "../db.js";
import logger from "../utils/logger.js";
import {
    calcularModelo390,
    calcularModelo190,
    calcularModelo180,
    calcularModelo347
} from "./adminFiscalController.js";

/**
 * Fechas limite oficiales para modelos anuales
 */
function getFechaLimite(modelo, ejercicio) {
    const year = parseInt(ejercicio) + 1;
    switch (modelo) {
        case '390': return `${year}-01-30`; // Hasta 30 enero
        case '190': return `${year}-01-31`; // Hasta 31 enero
        case '180': return `${year}-01-31`; // Hasta 31 enero
        case '347': return `${year}-02-28`; // Hasta 28 febrero
        case '349_anual': return `${year}-01-30`;
        default: return `${year}-01-31`;
    }
}

/**
 * Descripciones de modelos
 */
const MODELO_DESCRIPTIONS = {
    '390': 'Resumen anual IVA',
    '190': 'Resumen anual retenciones e ingresos a cuenta',
    '180': 'Resumen anual retenciones arrendamiento inmuebles',
    '347': 'Declaracion anual operaciones con terceros >3.005,06 EUR',
    '349_anual': 'Resumen anual operaciones intracomunitarias'
};

/**
 * Helper: obtener empresa_id segun contexto (admin vs asesor)
 */
function getEmpresaId(req) {
    return req.params.empresa_id || req.user.empresa_id;
}

// ============================================================
// LIST & DETAIL
// ============================================================

/**
 * GET - Listar todos los modelos anuales para empresa+ejercicio
 * Devuelve los registros existentes + placeholders para modelos que faltan
 */
export async function getModelosAnuales(req, res) {
    try {
        const empresaId = getEmpresaId(req);
        const ejercicio = parseInt(req.params.ejercicio);

        if (!ejercicio) return res.status(400).json({ error: "Ejercicio requerido" });

        // Registros existentes
        const existentes = await sql`
            SELECT ma.*,
                   u.nombre as presentado_por_nombre
            FROM modelos_anuales_180 ma
            LEFT JOIN users_180 u ON u.id = ma.presentado_por
            WHERE ma.empresa_id = ${empresaId}
            AND ma.ejercicio = ${ejercicio}
            ORDER BY ma.modelo
        `;

        // Crear mapa de existentes
        const existMap = {};
        for (const row of existentes) {
            existMap[row.modelo] = row;
        }

        // Devolver todos los modelos, con placeholder si no existe
        const modelos = ['390', '190', '180', '347'].map(modelo => {
            if (existMap[modelo]) {
                return {
                    ...existMap[modelo],
                    descripcion: MODELO_DESCRIPTIONS[modelo],
                    fecha_limite: existMap[modelo].fecha_limite || getFechaLimite(modelo, ejercicio)
                };
            }
            return {
                id: null,
                empresa_id: empresaId,
                ejercicio,
                modelo,
                estado: 'pendiente',
                datos_calculados: null,
                total_base_imponible: null,
                total_cuota: null,
                total_operaciones: null,
                numero_registros: 0,
                fecha_limite: getFechaLimite(modelo, ejercicio),
                fecha_presentacion: null,
                csv_presentacion: null,
                numero_justificante: null,
                notas: null,
                descripcion: MODELO_DESCRIPTIONS[modelo]
            };
        });

        res.json({ success: true, data: modelos });
    } catch (error) {
        logger.error("Error getModelosAnuales:", { error: error.message });
        res.status(500).json({ success: false, error: "Error obteniendo modelos anuales" });
    }
}

/**
 * GET - Detalle de un modelo anual especifico
 */
export async function getModeloAnualDetalle(req, res) {
    try {
        const empresaId = getEmpresaId(req);
        const ejercicio = parseInt(req.params.ejercicio);
        const modelo = req.params.modelo;

        if (!ejercicio || !modelo) {
            return res.status(400).json({ error: "Ejercicio y modelo requeridos" });
        }

        const [row] = await sql`
            SELECT ma.*,
                   u.nombre as presentado_por_nombre
            FROM modelos_anuales_180 ma
            LEFT JOIN users_180 u ON u.id = ma.presentado_por
            WHERE ma.empresa_id = ${empresaId}
            AND ma.ejercicio = ${ejercicio}
            AND ma.modelo = ${modelo}
        `;

        if (!row) {
            return res.json({
                success: true,
                data: {
                    empresa_id: empresaId,
                    ejercicio,
                    modelo,
                    estado: 'pendiente',
                    datos_calculados: null,
                    descripcion: MODELO_DESCRIPTIONS[modelo],
                    fecha_limite: getFechaLimite(modelo, ejercicio)
                }
            });
        }

        res.json({
            success: true,
            data: {
                ...row,
                descripcion: MODELO_DESCRIPTIONS[modelo]
            }
        });
    } catch (error) {
        logger.error("Error getModeloAnualDetalle:", { error: error.message });
        res.status(500).json({ success: false, error: "Error obteniendo detalle modelo anual" });
    }
}

// ============================================================
// CALCULAR
// ============================================================

/**
 * POST - Calcular un modelo anual desde datos existentes
 * Reutiliza las funciones de calculo de adminFiscalController
 */
export async function calcularModeloAnual(req, res) {
    try {
        const empresaId = getEmpresaId(req);
        const ejercicio = parseInt(req.params.ejercicio);
        const modelo = req.params.modelo;

        if (!ejercicio || !modelo) {
            return res.status(400).json({ error: "Ejercicio y modelo requeridos" });
        }

        let datos;
        let totalBase = 0;
        let totalCuota = 0;
        let totalOperaciones = 0;
        let numRegistros = 0;

        switch (modelo) {
            case '390': {
                datos = await calcularModelo390(empresaId, ejercicio.toString());
                totalBase = datos.devengado.base_total;
                totalCuota = datos.devengado.cuota_total;
                totalOperaciones = datos.volumen_operaciones;
                numRegistros = 1; // Resumen unico
                break;
            }
            case '190': {
                datos = await calcularModelo190(empresaId, ejercicio.toString());
                totalBase = datos.total_rendimientos;
                totalCuota = datos.total_retenciones;
                totalOperaciones = datos.total_rendimientos;
                numRegistros = datos.total_perceptores;
                break;
            }
            case '180': {
                datos = await calcularModelo180(empresaId, ejercicio.toString());
                totalBase = datos.total_alquileres;
                totalCuota = datos.total_retenciones;
                totalOperaciones = datos.total_alquileres;
                numRegistros = datos.total_arrendadores;
                break;
            }
            case '347': {
                datos = await calcularModelo347(empresaId, ejercicio.toString());
                totalBase = datos.importe_total;
                totalCuota = 0; // No aplica cuota en 347
                totalOperaciones = datos.importe_total;
                numRegistros = datos.total_terceros;
                break;
            }
            default:
                return res.status(400).json({ error: `Modelo '${modelo}' no soportado` });
        }

        // Upsert en la tabla de tracking
        const fechaLimite = getFechaLimite(modelo, ejercicio);
        const [result] = await sql`
            INSERT INTO modelos_anuales_180 (
                empresa_id, ejercicio, modelo, estado,
                datos_calculados,
                total_base_imponible, total_cuota, total_operaciones, numero_registros,
                fecha_limite, updated_at
            ) VALUES (
                ${empresaId}, ${ejercicio}, ${modelo}, 'calculado',
                ${JSON.stringify(datos)}::jsonb,
                ${totalBase}, ${totalCuota}, ${totalOperaciones}, ${numRegistros},
                ${fechaLimite}, now()
            )
            ON CONFLICT (empresa_id, ejercicio, modelo) DO UPDATE SET
                estado = CASE
                    WHEN modelos_anuales_180.estado = 'presentado' THEN 'presentado'
                    ELSE 'calculado'
                END,
                datos_calculados = ${JSON.stringify(datos)}::jsonb,
                total_base_imponible = ${totalBase},
                total_cuota = ${totalCuota},
                total_operaciones = ${totalOperaciones},
                numero_registros = ${numRegistros},
                fecha_limite = ${fechaLimite},
                updated_at = now()
            RETURNING *
        `;

        res.json({
            success: true,
            data: {
                ...result,
                datos_calculados: datos,
                descripcion: MODELO_DESCRIPTIONS[modelo]
            }
        });
    } catch (error) {
        logger.error("Error calcularModeloAnual:", { error: error.message, stack: error.stack });
        res.status(500).json({ success: false, error: "Error calculando modelo anual" });
    }
}

// ============================================================
// MARCAR PRESENTADO
// ============================================================

/**
 * PUT - Marcar un modelo anual como presentado con CSV y justificante
 */
export async function marcarPresentado(req, res) {
    try {
        const empresaId = getEmpresaId(req);
        const ejercicio = parseInt(req.params.ejercicio);
        const modelo = req.params.modelo;
        const { csv_presentacion, numero_justificante, notas } = req.body;

        if (!ejercicio || !modelo) {
            return res.status(400).json({ error: "Ejercicio y modelo requeridos" });
        }

        // Verificar que existe y esta calculado
        const [existing] = await sql`
            SELECT id, estado FROM modelos_anuales_180
            WHERE empresa_id = ${empresaId}
            AND ejercicio = ${ejercicio}
            AND modelo = ${modelo}
        `;

        if (!existing) {
            return res.status(404).json({ error: "Modelo no encontrado. Debe calcularlo primero." });
        }

        const [result] = await sql`
            UPDATE modelos_anuales_180 SET
                estado = 'presentado',
                fecha_presentacion = now(),
                csv_presentacion = ${csv_presentacion || null},
                numero_justificante = ${numero_justificante || null},
                presentado_por = ${req.user.id},
                notas = COALESCE(${notas || null}, notas),
                updated_at = now()
            WHERE empresa_id = ${empresaId}
            AND ejercicio = ${ejercicio}
            AND modelo = ${modelo}
            RETURNING *
        `;

        logger.info(`Modelo ${modelo} del ejercicio ${ejercicio} marcado como presentado`, {
            empresa_id: empresaId,
            user_id: req.user.id
        });

        res.json({ success: true, data: result });
    } catch (error) {
        logger.error("Error marcarPresentado:", { error: error.message });
        res.status(500).json({ success: false, error: "Error marcando modelo como presentado" });
    }
}
