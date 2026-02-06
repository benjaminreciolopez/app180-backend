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
  desasignarPlantillaEmpleado,
  listarAsignacionesEmpleado,
  listarAsignaciones,
  getAsignacion,
  actualizarAsignacion,
  borrarAsignacion,
  getPlanDiaEmpleado,
  getBloquesDia,
  getBloquesExcepcion,
  replicarDiaSemana,
  resetDiaPlantilla,
  renovarAsignacion,
} from "../controllers/plantillasJornadaController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

router.get("/plantillas", listarPlantillas);
router.post("/plantillas", crearPlantilla);
// CRUD Gestion Planings - Mover antes de /plantillas/:id para evitar conflictos
router.get("/plantillas/asignaciones", listarAsignaciones);
router.get("/plantillas/asignaciones/:id", getAsignacion);
router.put("/plantillas/asignaciones/:id", actualizarAsignacion);
router.delete("/plantillas/asignaciones/:id", borrarAsignacion);

router.get("/plantillas/:id", getPlantillaDetalle);
router.patch("/plantillas/:id", actualizarPlantilla);
router.delete("/plantillas/:id", borrarPlantilla);

// semana
router.put("/plantillas/:id/dias/:dia_semana", upsertDiaSemana);
router.put("/plantillas/dias/:plantilla_dia_id/bloques", upsertBloquesDia);
router.post("/plantillas/:id/replicar-dia-base", replicarDiaSemana);
// cerca de los otros /dias
router.put(
  "/plantillas/dias/:id/reset",
  authRequired,
  roleRequired("admin"),
  resetDiaPlantilla,
);

// excepciones por fecha
router.put("/plantillas/:id/excepciones/:fecha", upsertExcepcionFecha); // fecha=YYYY-MM-DD
router.put(
  "/plantillas/excepciones/:excepcion_id/bloques",
  upsertBloquesExcepcion,
);

// asignaciones
router.post("/plantillas/asignar", asignarPlantillaEmpleado);
router.post("/plantillas/desasignar", desasignarPlantillaEmpleado);
router.post("/jornadas/asignar", asignarPlantillaEmpleado);
router.post("/jornadas/asignar/renovar", renovarAsignacion);


router.get("/jornadas/asignar/:empleado_id", listarAsignacionesEmpleado);

// resolver plan de un día (para debug y para UI)
router.get("/plan-dia/:empleado_id", getPlanDiaEmpleado); // ?fecha=YYYY-MM-DD

// leer bloques
router.get("/plantillas/dias/:plantilla_dia_id/bloques", getBloquesDia);
router.get(
  "/plantillas/excepciones/:excepcion_id/bloques",
  getBloquesExcepcion,
);

export default router;
