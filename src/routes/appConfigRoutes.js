// backend/src/routes/appConfigRoutes.js
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { listarConfig, actualizarConfig } from "../controllers/appConfigController.js";

const router = Router();
router.use(authRequired);
router.get("/", listarConfig);
router.put("/:clave", actualizarConfig);

export default router;
