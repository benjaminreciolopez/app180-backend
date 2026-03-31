import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
    listar,
    crear,
    actualizar,
    eliminar,
    ejecutar,
} from "../controllers/gastosRecurrentesController.js";

const router = Router();
router.use(authRequired, roleRequired("admin"));

router.get("/", listar);
router.post("/", crear);
router.put("/:id", actualizar);
router.delete("/:id", eliminar);
router.post("/:id/ejecutar", ejecutar);

export default router;
