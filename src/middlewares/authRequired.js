import jwt from "jsonwebtoken";
import { config } from "../config.js";

export const authRequired = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Token inválido" });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("JWT ERROR:", err);
    return res.status(401).json({ error: "Token inválido" });
  }
};
