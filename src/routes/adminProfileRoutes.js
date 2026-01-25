import { Router } from "express";
import { authRequired } from "../middlewares/authRequired.js";
import { roleRequired } from "../middlewares/roleRequired.js";
import { getProfile, updateProfile } from "../controllers/adminProfileController.js";

const router = Router();

router.use(authRequired, roleRequired("admin"));

router.get("/", getProfile);
router.post("/", updateProfile);

export default router;
