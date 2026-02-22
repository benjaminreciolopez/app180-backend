import { Router } from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { securityAlert } from "../middlewares/securityAlert.js";
import {
  getSubscription,
  getPlans,
  checkout,
  cancel,
} from "../controllers/subscriptionController.js";

const router = Router();

// Rutas protegidas (requieren auth + admin)
router.get("/subscription", authRequired, roleRequired("admin"), getSubscription);
router.get("/subscription/plans", authRequired, getPlans);
router.post("/subscription/checkout", authRequired, roleRequired("admin"), securityAlert("subscription"), checkout);
router.post("/subscription/cancel", authRequired, roleRequired("admin"), securityAlert("subscription"), cancel);

export default router;
