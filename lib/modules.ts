export function hasModule(name: string): boolean {
  if (typeof window === "undefined") return true;

  // Configuración siempre accesible
  if (window.location.pathname.startsWith("/admin/configuracion")) {
    return true;
  }

  const raw = localStorage.getItem("user");
  if (!raw) return true;

  try {
    const u = JSON.parse(raw);

    if (!u.modulos) return true;

    return u.modulos[name] !== false;
  } catch {
    return true;
  }
}
