// backend/src/routes/adminPlantillasRoutes.js

import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  listarPlantillas,
  crearPlantilla,
  actualizarPlantilla,
  borrarPlantilla,
  getPlantillaDetalle,
  upsertDiaSemana,
  upsertBloquesDia,
  upsertExcepcionFecha,
  upsertBloquesExcepcion,
  asignarPlantillaEmpleado,
  listarAsignacionesEmpleado,
  getPlanDiaEmpleado,
  getBloquesDia,
  getBloquesExcepcion,
  replicarDiaSemana,
} from "../controllers/plantillasJornadaController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

router.get("/plantillas", listarPlantillas);
router.post("/plantillas", crearPlantilla);
router.get("/plantillas/:id", getPlantillaDetalle);
router.patch("/plantillas/:id", actualizarPlantilla);
router.delete("/plantillas/:id", borrarPlantilla);

// semana
router.put("/plantillas/:id/dias/:dia_semana", upsertDiaSemana);
router.put("/plantillas/dias/:plantilla_dia_id/bloques", upsertBloquesDia);
router.post("/plantillas/:id/replicar-dia-base", replicarDiaSemana);
// excepciones por fecha
router.put("/plantillas/:id/excepciones/:fecha", upsertExcepcionFecha); // fecha=YYYY-MM-DD
router.put(
  "/plantillas/excepciones/:excepcion_id/bloques",
  upsertBloquesExcepcion,
);

// asignaciones
router.post("/plantillas/asignar", asignarPlantillaEmpleado);
router.get("/plantillas/asignaciones/:empleado_id", listarAsignacionesEmpleado);

// resolver plan de un día (para debug y para UI)
router.get("/plan-dia/:empleado_id", getPlanDiaEmpleado); // ?fecha=YYYY-MM-DD

// leer bloques
router.get("/plantillas/dias/:plantilla_dia_id/bloques", getBloquesDia);
router.get(
  "/plantillas/excepciones/:excepcion_id/bloques",
  getBloquesExcepcion,
);

export default router;
