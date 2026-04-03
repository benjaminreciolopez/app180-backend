/**
 * Rutas RETA para admin (autonomo que gestiona su propia empresa)
 */
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { RetaEngine } from "../services/retaEstimationEngine.js";
import { sql } from "../db.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

// Obtener propia estimacion RETA
router.get("/estimacion", async (req, res) => {
    try {
        const empresaId = req.user.empresa_id;
        const ejercicio = parseInt(req.query.ejercicio) || new Date().getFullYear();

        // Verificar que es autonomo
        const [empresa] = await sql`
            SELECT tipo_contribuyente FROM empresa_180 WHERE id = ${empresaId}
        `;
        if (!empresa || empresa.tipo_contribuyente !== 'autonomo') {
            return res.status(400).json({ error: "Esta empresa no es de tipo autonomo" });
        }

        const [estimacion] = await sql`
            SELECT * FROM reta_estimaciones_180
            WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio}
            ORDER BY fecha_calculo DESC LIMIT 1
        `;

        if (!estimacion) {
            return res.json({ estimacion: null });
        }

        const perfil = await RetaEngine.getPerfil(empresaId, ejercicio);
        const tramos = await RetaEngine.getTramosForYear(ejercicio);
        const proximaVentana = RetaEngine.getNextChangeWindow(ejercicio);

        res.json({ estimacion, perfil, tramos, proximaVentana });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Generar propia estimacion
router.post("/estimacion", async (req, res) => {
    try {
        const empresaId = req.user.empresa_id;
        const ejercicio = parseInt(req.body.ejercicio) || new Date().getFullYear();

        const [empresa] = await sql`
            SELECT tipo_contribuyente FROM empresa_180 WHERE id = ${empresaId}
        `;
        if (!empresa || empresa.tipo_contribuyente !== 'autonomo') {
            return res.status(400).json({ error: "Esta empresa no es de tipo autonomo" });
        }

        const resultado = await RetaEngine.generateFullEstimation(empresaId, ejercicio, {
            metodo: req.body.metodo || 'auto',
            creadoPor: req.user.id,
            tipoCreador: 'cliente',
        });

        res.json(resultado);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Obtener propio perfil RETA
router.get("/perfil", async (req, res) => {
    try {
        const empresaId = req.user.empresa_id;
        const ejercicio = parseInt(req.query.ejercicio) || new Date().getFullYear();
        const perfil = await RetaEngine.getPerfil(empresaId, ejercicio);
        res.json({ perfil });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Simulacion propia
router.get("/simulacion", async (req, res) => {
    try {
        const empresaId = req.user.empresa_id;
        const ejercicio = parseInt(req.query.ejercicio) || new Date().getFullYear();
        const resultado = await RetaEngine.simulate(empresaId, ejercicio, {
            variacionIngresosPct: parseFloat(req.query.variacion_ingresos || 0),
            variacionGastosPct: parseFloat(req.query.variacion_gastos || 0),
        });
        if (!resultado) return res.status(404).json({ error: "No hay estimaciones previas" });
        res.json(resultado);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
