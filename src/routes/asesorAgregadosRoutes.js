// backend/src/routes/asesorAgregadosRoutes.js
//
// Endpoints de agregados cross-cliente del asesor (Nivel 3).
// Mount: /asesor/agregados

import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { getDashboardAgregados } from "../controllers/asesorAgregadosController.js";

const router = Router();

router.use(authRequired, roleRequired("asesor"));

router.get("/dashboard", getDashboardAgregados);

export default router;
