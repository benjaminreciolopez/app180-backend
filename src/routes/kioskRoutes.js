// backend/src/routes/kioskRoutes.js

import express from "express";
import rateLimit from "express-rate-limit";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { kioskAuthRequired } from "../middlewares/kioskAuth.js";
import {
  registerKioskDevice,
  listKioskDevices,
  updateKioskDevice,
  deleteKioskDevice,
  generateActivationToken,
  activateKioskDevice,
  getKioskConfig,
  identifyEmployee,
  getKioskEstado,
  createKioskFichaje,
  requestOTP,
  verifyOfflinePin,
  voidKioskFichaje,
} from "../controllers/kioskController.js";
import {
  getKioskEmployees,
  assignEmployeesToKiosk,
  removeEmployeeFromKiosk,
} from "../controllers/kioskEmployeeController.js";
import { syncOfflineFichajes } from "../controllers/offlineSyncController.js";

const router = express.Router();

// Rate limiter para endpoints del kiosko
const kioskLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas peticiones desde este dispositivo. Espera unos minutos." },
});

// Rate limiter para activación pública (más restrictivo)
const kioskActivationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de activación. Espera unos minutos." },
});

// ═══════════════════════════════════════
// ADMIN: Gestión de dispositivos kiosko
// ═══════════════════════════════════════

router.post("/register", authRequired, roleRequired("admin"), registerKioskDevice);
router.get("/devices", authRequired, roleRequired("admin"), listKioskDevices);
router.patch("/devices/:id", authRequired, roleRequired("admin"), updateKioskDevice);
router.delete("/devices/:id", authRequired, roleRequired("admin"), deleteKioskDevice);

// Activación QR
router.post("/devices/:id/activation-token", authRequired, roleRequired("admin"), generateActivationToken);

// Asignación de empleados a kioscos
router.get("/devices/:id/employees", authRequired, roleRequired("admin"), getKioskEmployees);
router.post("/devices/:id/employees", authRequired, roleRequired("admin"), assignEmployeesToKiosk);
router.delete("/devices/:id/employees/:empleado_id", authRequired, roleRequired("admin"), removeEmployeeFromKiosk);

// ═══════════════════════════════════════
// PÚBLICO: Activación de dispositivo
// ═══════════════════════════════════════

router.post("/activate", kioskActivationLimiter, activateKioskDevice);

// ═══════════════════════════════════════
// KIOSK: Endpoints para dispositivos
// ═══════════════════════════════════════

router.get("/config", kioskLimiter, kioskAuthRequired, getKioskConfig);
router.post("/identify", kioskLimiter, kioskAuthRequired, identifyEmployee);
router.post("/estado", kioskLimiter, kioskAuthRequired, getKioskEstado);
router.post("/fichaje", kioskLimiter, kioskAuthRequired, createKioskFichaje);
router.post("/otp/request", kioskLimiter, kioskAuthRequired, requestOTP);
router.post("/verify-offline-pin", kioskLimiter, kioskAuthRequired, verifyOfflinePin);
router.post("/void", kioskLimiter, kioskAuthRequired, voidKioskFichaje);
router.post("/sync-offline", kioskLimiter, kioskAuthRequired, syncOfflineFichajes);

export default router;
