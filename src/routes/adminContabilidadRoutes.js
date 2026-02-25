// backend/src/routes/adminContabilidadRoutes.js
import { Router } from "express";
import multer from "multer";
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
  validarAsientosMultiple,
  anularAsiento,
  getLibroMayor,
  getBalance,
  getPyG,
  getEjercicios,
  cerrarEjercicio,
  generarAsientosPeriodo,
  exportarAsientos,
  importarAsientos,
} from "../controllers/contabilidadController.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authRequired, roleRequired("admin"));

// PGC - Plan de Cuentas
router.get("/cuentas", getCuentas);
router.post("/cuentas", crearCuenta);
router.put("/cuentas/:id", actualizarCuenta);
router.post("/cuentas/inicializar-pgc", inicializarPGC);

// Asientos
router.get("/asientos", getAsientos);
router.get("/asientos/exportar", exportarAsientos);
router.post("/asientos", crearAsiento);
router.post("/asientos/generar", generarAsientosPeriodo); // Must be before :id
router.post("/asientos/importar", upload.single("file"), importarAsientos);
router.put("/asientos/validar-multiple", validarAsientosMultiple);
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

export default router;
