import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  getAdminJornadaDetalle,
  listAdminJornadas,
} from "../controllers/adminJornadasController.js";

const router = Router();
router.use(authRequired, roleRequired("admin"));

router.get("/jornadas", listAdminJornadas);
router.get("/jornadas/:id", getAdminJornadaDetalle);

export default router;
