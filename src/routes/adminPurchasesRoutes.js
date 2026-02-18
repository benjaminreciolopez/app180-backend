import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
    listarCompras,
    crearCompra,
    actualizarCompra,
    eliminarCompra
} from "../controllers/adminPurchasesController.js";

const router = Router();

// Todas las rutas de compras requieren ser admin
router.use(authRequired, roleRequired("admin"));

/**
 * @route GET /admin/purchases
 * @desc Listar compras con filtros
 */
router.get("/purchases", listarCompras);

/**
 * @route POST /admin/purchases
 * @desc Crear un nuevo gasto
 */
router.post("/purchases", crearCompra);

/**
 * @route PUT /admin/purchases/:id
 * @desc Actualizar un gasto
 */
router.put("/purchases/:id", actualizarCompra);

/**
 * @route DELETE /admin/purchases/:id
 * @desc Eliminar un gasto (desactivación lógica)
 */
router.delete("/purchases/:id", eliminarCompra);

export default router;
