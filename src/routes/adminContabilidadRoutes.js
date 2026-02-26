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
  revisarAsientos,
  exportarBalance,
  exportarPyG,
  exportarMayor,
  exportarCuentas,
  exportarPaquete,
} from "../controllers/contabilidadController.js";
import {
  importarExtracto,
  matchearExtracto,
  confirmarExtracto,
} from "../controllers/extractoBancarioController.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authRequired, roleRequired("admin"));

// PGC - Plan de Cuentas
router.get("/cuentas", getCuentas);
router.get("/cuentas/exportar", exportarCuentas);
router.post("/cuentas", crearCuenta);
router.put("/cuentas/:id", actualizarCuenta);
router.post("/cuentas/inicializar-pgc", inicializarPGC);

// Asientos
router.get("/asientos", getAsientos);
router.get("/asientos/exportar", exportarAsientos);
router.post("/asientos", crearAsiento);
router.post("/asientos/generar", generarAsientosPeriodo); // Must be before :id
router.post("/asientos/importar", upload.single("file"), importarAsientos);
router.post("/asientos/revisar", revisarAsientos);
router.put("/asientos/validar-multiple", validarAsientosMultiple);
router.get("/asientos/:id", getAsientoById);
router.put("/asientos/:id", editarAsiento);
router.put("/asientos/:id/validar", validarAsiento);
router.delete("/asientos/:id", anularAsiento);

// Libro Mayor
router.get("/mayor/exportar", exportarMayor);
router.get("/mayor/:cuenta_codigo", getLibroMayor);

// Balance y PyG
router.get("/balance", getBalance);
router.get("/balance/exportar", exportarBalance);
router.get("/pyg", getPyG);
router.get("/pyg/exportar", exportarPyG);

// Exportación paquete completo
router.get("/exportar-paquete", exportarPaquete);

// Extracto Bancario
router.post("/importar-extracto", upload.single("file"), importarExtracto);
router.post("/extracto/matchear", matchearExtracto);
router.post("/extracto/confirmar", confirmarExtracto);

// Ejercicios
router.get("/ejercicios", getEjercicios);
router.post("/ejercicios/:anio/cerrar", cerrarEjercicio);

export default router;
