import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
    listar,
    crear,
    actualizar,
    eliminar,
    generarUno,
    generarLote,
} from "../controllers/facturaRecurrenteController.js";

const router = Router();
router.use(authRequired, roleRequired("admin"));

router.get("/", listar);
router.post("/", crear);
router.post("/generar-lote", generarLote);
router.put("/:id", actualizar);
router.delete("/:id", eliminar);
router.post("/:id/generar", generarUno);

export default router;
