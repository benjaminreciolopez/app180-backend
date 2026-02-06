// backend/src/routes/fichajeRoutes.js

import express from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";

import {
  createFichaje,
  getTodayFichajes,
  getFichajesSospechosos,
  validarFichaje,
  validarFichajesMasivo,
  registrarFichajeManual,
  getFichajeDetalle,
  getFichajes,
} from "../controllers/fichajeController.js";

import { getEstadoFichaje } from "../controllers/fichajeEstadoController.js";
import { requireModule } from "../middlewares/requireModule.js";

const router = express.Router();

// ======================================
// TODAS LAS RUTAS → requieren login
// ======================================
router.use(authRequired, requireModule("fichajes"));

// ======================================
// RUTAS USUARIO / EMPLEADO
// ======================================

// Estado del fichaje actual
router.get("/estado", roleRequired("empleado"), getEstadoFichaje);

// Registrar fichaje normal (entrada o salida según estado)
router.post("/", roleRequired("empleado"), createFichaje);

// ======================================
// ADMIN
// ======================================

// Listar fichajes
router.get("/", roleRequired("admin"), getFichajes);

// Fichajes del día (panel admin)
router.get("/hoy", roleRequired("admin"), getTodayFichajes);

// SOSPECHOSOS
router.get("/sospechosos", roleRequired("admin"), getFichajesSospechosos);
router.get("/sospechosos/:id", roleRequired("admin"), getFichajeDetalle);
router.patch("/sospechosos/:id", roleRequired("admin"), validarFichaje);
router.post("/sospechosos/bulk", roleRequired("admin"), validarFichajesMasivo);

// Fichaje manual admin
router.post("/manual", roleRequired("admin"), registrarFichajeManual);

export default router;
