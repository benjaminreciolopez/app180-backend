import express from "express";
import {
  register,
  login,
  activateInstall,
} from "../controllers/authController.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/activate-install", activateInstall); // 👈 nueva ruta

export default router;
