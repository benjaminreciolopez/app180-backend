import { Router } from "express";
import { authRequired } from "../middlewares/authRequired.js";
import {
    crearSugerencia,
    getSugerencias,
    getAllSugerencias,
    responderSugerencia,
} from "../controllers/sugerenciasController.js";

// Rutas admin normales (montadas en /admin/sugerencias con authRequired desde app.js)
const router = Router();
router.get("/", getSugerencias);
router.post("/", crearSugerencia);

export default router;

// Rutas fabricante (montadas en /api/admin/fabricante/sugerencias)
export const sugerenciasFabricanteRouter = Router();
sugerenciasFabricanteRouter.use(authRequired);
sugerenciasFabricanteRouter.get("/", getAllSugerencias);
sugerenciasFabricanteRouter.put("/:id/responder", responderSugerencia);
