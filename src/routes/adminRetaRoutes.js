/**
 * Rutas RETA para admin (autonomo que gestiona su propia empresa)
 */
import { Router } from "express";
import multer from "multer";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { RetaEngine } from "../services/retaEstimationEngine.js";
import { sql } from "../db.js";
import { saveToStorage } from "../controllers/storageController.js";

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

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

// =============================================================================
// Comunicar cambio de base confirmado en la TGSS
// El autónomo cambió su base en Importass y sube el justificante de la SS.
// Crea un registro en estado 'comunicado_pdte_asesor' y notifica al asesor.
// =============================================================================
router.post("/cambios-base/comunicar", upload.single("justificante"), async (req, res) => {
    try {
        const empresaId = req.user.empresa_id;
        const ejercicio = parseInt(req.body.ejercicio) || new Date().getFullYear();
        const baseNueva = parseFloat(req.body.base_nueva);
        const fechaEfectiva = req.body.fecha_efectiva;
        const titularId = req.body.titular_id || null;
        const motivo = req.body.motivo || "Cambio confirmado por el autónomo en la TGSS";

        if (!baseNueva || baseNueva <= 0) {
            return res.status(400).json({ error: "base_nueva inválida" });
        }
        if (!fechaEfectiva) {
            return res.status(400).json({ error: "fecha_efectiva es obligatoria" });
        }

        const perfil = await RetaEngine.getPerfil(empresaId, ejercicio, titularId);
        const tramos = await RetaEngine.getTramosForYear(ejercicio);
        let tramoNuevo = 1;
        for (const t of tramos) {
            if (baseNueva >= t.baseMin && baseNueva <= t.baseMax) {
                tramoNuevo = t.tramo;
                break;
            }
        }

        // 1) Subir el justificante PDF (si llega)
        let justificantePdfUrl = null;
        if (req.file) {
            try {
                const ext = (req.file.originalname || "").split(".").pop()?.toLowerCase() || "pdf";
                const nombre = `reta_justificante_${empresaId}.${ext}`;
                justificantePdfUrl = await saveToStorage({
                    empresaId,
                    folder: "reta",
                    nombre,
                    buffer: req.file.buffer,
                    mimeType: req.file.mimetype,
                });
            } catch (err) {
                console.error("Error subiendo justificante:", err);
                // No bloqueamos: registramos el cambio sin justificante adjunto.
            }
        }

        // 2) Insertar registro
        const ventana = RetaEngine.getNextChangeWindow(ejercicio);
        const [cambio] = await sql`
            INSERT INTO reta_cambios_base_180 (
                empresa_id, ejercicio, titular_id,
                base_anterior, base_nueva,
                tramo_anterior, tramo_nuevo,
                fecha_efectiva, fecha_solicitud, fecha_limite_solicitud,
                motivo, solicitado_por,
                estado, justificante_pdf_url, justificante_uploaded_at
            ) VALUES (
                ${empresaId}, ${ejercicio}, ${titularId},
                ${perfil?.base_cotizacion_actual || 0}, ${baseNueva},
                ${perfil?.tramo_actual || null}, ${tramoNuevo},
                ${fechaEfectiva}, ${new Date().toISOString().slice(0, 10)}, ${ventana.fechaLimite},
                ${motivo}, ${req.user.id},
                'comunicado_pdte_asesor', ${justificantePdfUrl}, ${justificantePdfUrl ? new Date() : null}
            )
            RETURNING *
        `;

        // 3) Notificar a las asesorías que gestionan esta empresa
        try {
            const [empresa] = await sql`SELECT nombre FROM empresa_180 WHERE id = ${empresaId}`;
            const asesores = await sql`
                SELECT DISTINCT asesoria_id
                FROM asesoria_clientes_180
                WHERE empresa_id = ${empresaId} AND estado = 'activo'
            `;
            for (const { asesoria_id } of asesores) {
                await sql`
                    INSERT INTO notificaciones_asesor_180 (
                        asesoria_id, tipo, titulo, mensaje,
                        accion_url, accion_label, metadata, empresa_id
                    ) VALUES (
                        ${asesoria_id},
                        'reta_cambio_comunicado',
                        ${"Cambio de base RETA comunicado · " + (empresa?.nombre || "")},
                        ${`El autónomo ha confirmado un cambio de base a ${baseNueva.toFixed(2)} € con efectos ${fechaEfectiva}. Revisa el justificante y confirma para aplicar al perfil.`},
                        ${`/asesor/reta/clientes/${empresaId}?cambio=${cambio.id}`},
                        'Revisar cambio',
                        ${JSON.stringify({
                            cambio_base_id: cambio.id,
                            base_nueva: baseNueva,
                            fecha_efectiva: fechaEfectiva,
                            tiene_justificante: !!justificantePdfUrl,
                        })},
                        ${empresaId}
                    )
                `;
            }
        } catch (err) {
            console.error("Error notificando al asesor:", err);
        }

        res.json({ cambio });
    } catch (err) {
        console.error("comunicar cambio RETA error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Lista de cambios propios (último estado del autónomo)
router.get("/cambios-base", async (req, res) => {
    try {
        const empresaId = req.user.empresa_id;
        const ejercicio = parseInt(req.query.ejercicio) || new Date().getFullYear();
        const cambios = await sql`
            SELECT * FROM reta_cambios_base_180
            WHERE empresa_id = ${empresaId} AND ejercicio = ${ejercicio}
            ORDER BY created_at DESC
        `;
        res.json({ cambios });
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
