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
    getUniqueValues,
    bankImportPreview,
    bankImportConfirm
} from "../controllers/adminPurchasesController.js";
import { storageController } from "../controllers/storageController.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Todas las rutas de compras requieren ser admin
router.use(authRequired, roleRequired("admin"));

/**
 * @route GET /admin/purchases/proxy
 * @desc Abrir archivo (proxy a Supabase signed URL)
 * @query path
 */
router.get("/proxy", storageController.proxyFile);

/**
 * @route GET /admin/purchases/values
 * @desc Listar valores únicos (categorias, métodos de pago, etc)
 * @query field (categoria, metodo_pago, proveedor)
 */
router.get("/values", getUniqueValues);

/**
 * @route GET /admin/purchases
 * @desc Listar compras con filtros
 */
router.get("/", listarCompras);

/**
 * @route POST /admin/purchases/ocr
 * @desc Procesar OCR para un gasto
 */
router.post("/ocr", upload.single("file"), ocrGasto);

/**
 * @route POST /admin/purchases/bank-import
 * @desc Preview de extracto bancario (CSV o PDF)
 */
router.post("/bank-import", upload.single("file"), bankImportPreview);

/**
 * @route POST /admin/purchases/bank-import/confirm
 * @desc Confirmar importación de transacciones seleccionadas
 */
router.post("/bank-import/confirm", bankImportConfirm);

/**
 * @route POST /admin/purchases
 * @desc Crear un nuevo gasto
 */
router.post("/", upload.single("file"), crearCompra);

/**
 * @route PUT /admin/purchases/:id
 * @desc Actualizar un gasto
 */
router.put("/:id", upload.single("file"), actualizarCompra);

/**
 * @route DELETE /admin/purchases/:id
 * @desc Eliminar un gasto (desactivación lógica)
 */
router.delete("/:id", eliminarCompra);

export default router;
