import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { listar, crear, actualizar, eliminar } from "../controllers/knowledgeController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

router.get("/conocimiento", listar);
router.post("/conocimiento", crear);
router.patch("/conocimiento/:id", actualizar);
router.delete("/conocimiento/:id", eliminar);

export default router;
