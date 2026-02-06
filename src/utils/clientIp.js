export function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];

  if (xf && typeof xf === "string") {
    return xf.split(",")[0].trim();
  }

  return req.ip;
}
