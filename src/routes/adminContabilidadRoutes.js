// backend/src/routes/adminContabilidadRoutes.js
import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  getCuentas,
  crearCuenta,
  actualizarCuenta,
  inicializarPGC,
  getAsientos,
  getAsientoById,
  crearAsiento,
  editarAsiento,
  validarAsiento,
  anularAsiento,
  getLibroMayor,
  getBalance,
  getPyG,
  getEjercicios,
  cerrarEjercicio,
  generarAsientosPeriodo,
} from "../controllers/contabilidadController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

// PGC - Plan de Cuentas
router.get("/cuentas", getCuentas);
router.post("/cuentas", crearCuenta);
router.put("/cuentas/:id", actualizarCuenta);
router.post("/cuentas/inicializar-pgc", inicializarPGC);

// Asientos
router.get("/asientos", getAsientos);
router.post("/asientos", crearAsiento);
router.get("/asientos/:id", getAsientoById);
router.put("/asientos/:id", editarAsiento);
router.put("/asientos/:id/validar", validarAsiento);
router.delete("/asientos/:id", anularAsiento);

// Libro Mayor
router.get("/mayor/:cuenta_codigo", getLibroMayor);

// Balance y PyG
router.get("/balance", getBalance);
router.get("/pyg", getPyG);

// Ejercicios
router.get("/ejercicios", getEjercicios);
router.post("/ejercicios/:anio/cerrar", cerrarEjercicio);

// Auto-generación
router.post("/generar-asientos", generarAsientosPeriodo);

export default router;
