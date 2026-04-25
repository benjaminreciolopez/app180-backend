/**
 * CRUD de inmovilizado y consulta de amortización (asesor sobre cliente).
 * Mount: /asesor/clientes/:empresa_id/inmovilizado
 */
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { asesorClienteRequired } from "../middlewares/asesorRequired.js";
import {
    listarInmovilizado,
    getInmovilizadoConAmortizacion,
    crearInmovilizado,
    actualizarInmovilizado,
    eliminarInmovilizado
} from "../controllers/inmovilizadoController.js";

const router = Router({ mergeParams: true });

router.use(authRequired, roleRequired("asesor"));

router.get("/", asesorClienteRequired("fiscal", "read"), listarInmovilizado);
router.get("/amortizacion/:ejercicio", asesorClienteRequired("fiscal", "read"), getInmovilizadoConAmortizacion);
router.post("/", asesorClienteRequired("fiscal", "write"), crearInmovilizado);
router.put("/:id", asesorClienteRequired("fiscal", "write"), actualizarInmovilizado);
router.delete("/:id", asesorClienteRequired("fiscal", "write"), eliminarInmovilizado);

export default router;
