import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { getEmpleadoPlanDia } from "../controllers/empleadoPlanDiaController.js";

const router = Router();
router.use(authRequired, roleRequired("empleado"));

router.get("/plan-dia", getEmpleadoPlanDia);

export default router;
// backend/src/routes/empleadoPlanDiaRoutes.js
