
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import upload from "../middlewares/uploadMiddleware.js";
import {
    uploadRentaPdf,
    getDatosPersonales,
    saveDatosPersonales,
    getHistorialRentas,
    getRentaDetalle,
    deleteRenta,
    generarDossier
} from "../controllers/adminRentaController.js";

const router = Router();

// Todas las rutas requieren admin
router.use(authRequired, roleRequired("admin"));

/**
 * @route POST /admin/fiscal/renta/upload-pdf
 * @desc Subir PDF de renta anterior y extraer casillas con IA
 * @body ejercicio (año), file (PDF)
 */
router.post("/upload-pdf", upload.single("file"), uploadRentaPdf);

/**
 * @route GET /admin/fiscal/renta/datos-personales
 * @desc Obtener datos personales/familiares para la renta
 */
router.get("/datos-personales", getDatosPersonales);

/**
 * @route POST /admin/fiscal/renta/datos-personales
 * @desc Crear o actualizar datos personales/familiares
 */
router.post("/datos-personales", saveDatosPersonales);

/**
 * @route GET /admin/fiscal/renta/historial
 * @desc Listar todas las rentas importadas
 */
router.get("/historial", getHistorialRentas);

/**
 * @route GET /admin/fiscal/renta/historial/:ejercicio
 * @desc Detalle completo de una renta por ejercicio
 */
router.get("/historial/:ejercicio", getRentaDetalle);

/**
 * @route DELETE /admin/fiscal/renta/historial/:ejercicio
 * @desc Eliminar renta de un ejercicio
 */
router.delete("/historial/:ejercicio", deleteRenta);

/**
 * @route GET /admin/fiscal/renta/dossier/:ejercicio
 * @desc Generar dossier pre-renta completo para un ejercicio
 */
router.get("/dossier/:ejercicio", generarDossier);

export default router;
