import { Router } from "express";
import multer from "multer";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
    listarCompras,
    crearCompra,
    actualizarCompra,
    eliminarCompra,
    ocrGasto,
    getUniqueValues
} from "../controllers/adminPurchasesController.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Todas las rutas de compras requieren ser admin
router.use(authRequired, roleRequired("admin"));

/**
 * @route GET /admin/purchases/values
 * @desc Listar valores únicos (categorias, métodos de pago, etc)
 * @query field (categoria, metodo_pago, proveedor)
 */
router.get("/purchases/values", getUniqueValues);

/**
 * @route GET /admin/purchases
 * @desc Listar compras con filtros
 */
router.get("/purchases", listarCompras);

/**
 * @route POST /admin/purchases/ocr
 * @desc Procesar OCR para un gasto
 */
router.post("/purchases/ocr", upload.single("file"), ocrGasto);

/**
 * @route POST /admin/purchases
 * @desc Crear un nuevo gasto
 */
router.post("/purchases", upload.single("file"), crearCompra);

/**
 * @route PUT /admin/purchases/:id
 * @desc Actualizar un gasto
 */
router.put("/purchases/:id", upload.single("file"), actualizarCompra);

/**
 * @route DELETE /admin/purchases/:id
 * @desc Eliminar un gasto (desactivación lógica)
 */
router.delete("/purchases/:id", eliminarCompra);

export default router;
