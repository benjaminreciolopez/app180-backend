import {
  solicitarVacaciones,
  aprobarVacaciones,
  rechazarVacaciones,
  crearBajaMedica,
  listarAusenciasEmpresa,
} from "../controllers/ausenciasController.js";
import { authRequired } from "../middlewares/authMiddleware.js";

router.post("/vacaciones/solicitar", authMiddleware, solicitarVacaciones);
router.patch("/vacaciones/aprobar/:id", authMiddleware, aprobarVacaciones);
router.patch("/vacaciones/rechazar/:id", authMiddleware, rechazarVacaciones);

router.post("/baja", authRequired, crearBajaMedica);

router.get("/empresa", authRequired, listarAusenciasEmpresa);
