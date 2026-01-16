// backend/src/routes/adminJornadasRoutes.js

import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { getAdminJornadas } from "../controllers/adminJornadasController.js";

const router = Router();

// GET /admin/jornadas?empleado_id=...&fecha=YYYY-MM-DD
router.get("/jornadas", authRequired, roleRequired("admin"), getAdminJornadas);

export default router;
