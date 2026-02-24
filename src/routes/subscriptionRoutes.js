import { Router } from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { securityAlert } from "../middlewares/securityAlert.js";
import {
  getSubscription,
  getPlans,
  checkout,
  cancel,
  buyCredits,
  getCreditPacks,
} from "../controllers/subscriptionController.js";

const router = Router();

// Rutas protegidas (requieren auth + admin)
router.get("/subscription", authRequired, roleRequired("admin"), getSubscription);
router.get("/subscription/plans", authRequired, getPlans);
router.post("/subscription/checkout", authRequired, roleRequired("admin"), securityAlert("subscription"), checkout);
router.post("/subscription/cancel", authRequired, roleRequired("admin"), securityAlert("subscription"), cancel);
router.get("/subscription/credit-packs", authRequired, getCreditPacks);
router.post("/subscription/buy-credits", authRequired, roleRequired("admin"), buyCredits);

export default router;
