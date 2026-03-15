// backend/src/routes/asesorNominasRoutes.js
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  getAsesorNominas,
  getAsesorEmpleados,
  generarNominas,
  getNominaDetalle,
  editarNomina,
  aprobarNomina,
  getAsesorEntregas,
  getIncidencias,
  createIncidencia,
  updateIncidencia,
  deleteIncidencia,
  getClientesParaNominas,
} from "../controllers/asesorNominasController.js";

const router = Router();

router.use(authRequired, roleRequired("asesor"));

// Clientes para selector
router.get("/clientes", getClientesParaNominas);

// Empleados cross-client
router.get("/empleados", getAsesorEmpleados);

// Entregas cross-client (must be before /:id)
router.get("/entregas", getAsesorEntregas);

// Incidencias CRUD (must be before /:id)
router.get("/incidencias", getIncidencias);
router.post("/incidencias", createIncidencia);
router.put("/incidencias/:id", updateIncidencia);
router.delete("/incidencias/:id", deleteIncidencia);

// Generar nóminas
router.post("/generar", generarNominas);

// Listado de nóminas
router.get("/", getAsesorNominas);

// Detalle, edición y aprobación
router.get("/:id", getNominaDetalle);
router.put("/:id", editarNomina);
router.post("/:id/aprobar", aprobarNomina);

export default router;
