// backend/src/utils/errorHandler.js
import logger from "./logger.js";

export const handleErr = (res, err, context = "Error") => {
  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : "Error interno del servidor";

  if (status >= 500) {
    logger.error(`[${context}] ${err.message || err}`, {
      stack: err.stack,
      status,
    });
  } else {
    logger.warn(`[${context}] ${err.message}`, { status });
  }

  res.status(status).json({ error: message });
};
