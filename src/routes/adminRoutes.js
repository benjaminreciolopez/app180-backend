import express from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { getAdminDashboard } from "../controllers/adminDashboardController.js";

const router = express.Router();

router.use(roleRequired("admin"));

// 👉 ESTE es el endpoint real que debe existir
router.get("/dashboard", getAdminDashboard);

export default router;
