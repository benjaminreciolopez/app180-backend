import { authRequired } from "./authMiddleware.js";

export const authRequired = (req, res, next) => {
  return authMiddleware(req, res, next);
};
