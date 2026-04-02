// backend/src/routes/adminContabilidadRoutes.js
import { Router } from "express";
import multer from "multer";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { requireModule } from "../middlewares/requireModule.js";
import {
  getCuentas,
  crearCuenta,
  actualizarCuenta,
  fusionarCuentas,
  inicializarPGC,
  getAsientos,
  getAsientoById,
  crearAsiento,
  editarAsiento,
  validarAsiento,
  validarAsientosMultiple,
  anularAsiento,
  eliminarAsiento,
  eliminarAsientosMultiple,
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
  listarTransaccionesBancarias,
} from "../controllers/extractoBancarioController.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authRequired, roleRequired("admin"), requireModule("contable"));

// PGC - Plan de Cuentas
router.get("/cuentas", getCuentas);
router.get("/cuentas/exportar", exportarCuentas);
router.post("/cuentas", crearCuenta);
router.put("/cuentas/:id", actualizarCuenta);
router.post("/cuentas/fusionar", fusionarCuentas);
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
router.delete("/asientos/eliminar-multiple", eliminarAsientosMultiple);
router.delete("/asientos/:id", eliminarAsiento);

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
router.get("/extracto/transacciones", listarTransaccionesBancarias);

// Ejercicios
router.get("/ejercicios", getEjercicios);
router.post("/ejercicios/:anio/cerrar", cerrarEjercicio);

export default router;
