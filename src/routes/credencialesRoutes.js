// backend/src/routes/credencialesRoutes.js
// Endpoints para credenciales externas (DEHú, SS RED, SILTRA…) por empresa.
// Mount: /admin/credenciales (admin sobre su propia empresa)
//        /asesor/clientes/:empresa_id/credenciales (asesor sobre cliente)

import { Router } from "express";
import { authRequired } from "../middlewares/authMiddleware.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import {
  listarCredenciales,
  guardarCredencialEndpoint,
  eliminarCredencialEndpoint,
  testCredencial,
} from "../controllers/credencialesController.js";

// ─── Rutas admin (su propia empresa) ───
const adminRouter = Router();
adminRouter.use(authRequired, roleRequired("admin"));
adminRouter.get("/", listarCredenciales);
adminRouter.put("/:servicio", guardarCredencialEndpoint);
adminRouter.delete("/:servicio", eliminarCredencialEndpoint);
adminRouter.post("/:servicio/test", testCredencial);

export const adminCredencialesRouter = adminRouter;

// ─── Rutas asesor (sobre cliente) ───
// Estas se montan dentro de asesorRoutes con asesorClienteRequired previo
export {
  listarCredenciales,
  guardarCredencialEndpoint,
  eliminarCredencialEndpoint,
  testCredencial,
};
