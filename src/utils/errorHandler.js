
export const handleErr = (res, err, context = "Error") => {
  console.error(`[${context}]`, err);
  const status = err.status || 500;
  const message = err.message || "Error interno del servidor";
  res.status(status).json({ error: message });
};
