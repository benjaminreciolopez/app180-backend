import { Router } from "express";
import { authRequired } from "../middlewares/authRequired.js";
import {
    createQRSession,
    getQRSessionStatus,
    activateQRSession,
    registerVipUser,
    getRecentActivations,
} from "../controllers/fabricanteController.js";

const router = Router();

// =============================================
// Rutas PUBLICAS (sin auth) - montadas en /api/public
// =============================================
router.post("/qr-session", createQRSession);
router.get("/qr-session/:token/status", getQRSessionStatus);
router.post("/qr-vip-register", registerVipUser);

export default router;

// =============================================
// Rutas PROTEGIDAS fabricante - montadas en /api/admin/fabricante
// =============================================
export const fabricanteProtectedRouter = Router();
fabricanteProtectedRouter.use(authRequired);
fabricanteProtectedRouter.post("/activate-qr", activateQRSession);
fabricanteProtectedRouter.get("/activations", getRecentActivations);
