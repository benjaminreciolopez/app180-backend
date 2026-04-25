/**
 * CRUD de inmovilizado y consulta de amortización acumulada (admin).
 * Mount: /admin/inmovilizado
 */
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
    listarInmovilizado,
    getInmovilizadoConAmortizacion,
    crearInmovilizado,
    actualizarInmovilizado,
    eliminarInmovilizado
} from "../controllers/inmovilizadoController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

router.get("/", listarInmovilizado);
router.get("/amortizacion/:ejercicio", getInmovilizadoConAmortizacion);
router.post("/", crearInmovilizado);
router.put("/:id", actualizarInmovilizado);
router.delete("/:id", eliminarInmovilizado);

export default router;
