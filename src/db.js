import postgres from "postgres";
import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "./config.js";

if (!config.supabase.url) {
  console.error("❌ NO hay cadena de conexión a Supabase");
}

const isTest = process.env.NODE_ENV === 'test';

// Pool subyacente. Cualquier consumidor que necesite la conexión bruta del
// pool (jobs cron, scripts de migración, healthchecks) debe importar `poolSql`
// para evitar que el proxy del request-scope intente leer del ALS.
// Supavisor session-mode pooler limita pool_size a 15 por instancia.
// Mantenemos margen para el backup (que reserva ~6 conexiones simultáneas)
// y el resto del tráfico. Si en el futuro se migra a transaction mode (port
// 6543) se puede subir.
export const poolSql = postgres(config.supabase.url, {
  ssl: "require",
  max: isTest ? 5 : 12,
  idle_timeout: isTest ? 10 : 15,
  max_lifetime: 60 * 30,
  connect_timeout: 10,
});

// Almacén async-local que el middleware tenantContext rellena con la
// conexión reservada del request actual. Si está vacío, las queries se
// resuelven contra el pool — comportamiento idéntico al anterior.
export const tenantStorage = new AsyncLocalStorage();

function activeSql() {
  return tenantStorage.getStore() || poolSql;
}

// Proxy callable: redirige llamadas como tagged template (`sql\`...\``)
// y accesos a propiedades (`sql.begin`, `sql.unsafe`, `sql.reserve`, ...)
// hacia la conexión activa (reservada del request o pool).
//
// Importante: los controllers existentes siguen importando `{ sql }` y no
// necesitan cambios. La separación tenant-aware vs pool ocurre en runtime.
export const sql = new Proxy(function () {}, {
  apply(_target, _thisArg, args) {
    return activeSql()(...args);
  },
  get(_target, prop) {
    const target = activeSql();

    // postgres.js v3 NO añade `.begin` a las conexiones reservadas devueltas por
    // `pool.reserve()`. Cuando `tenantContext` deja una reserved en el ALS, los
    // controladores que hacen `sql.begin(async tx => ...)` rompen con
    // "sql.begin is not a function". Polyfill: si el target no expone `.begin`,
    // emulamos la transacción con BEGIN/COMMIT/ROLLBACK sobre la misma conexión
    // (preserva el contexto RLS y el `app.empresa_id` ya fijado).
    if (prop === "begin" && typeof target.begin !== "function") {
      return async function emulatedBegin(optionsOrFn, maybeFn) {
        const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
        const opts = typeof optionsOrFn === "string" ? optionsOrFn : "";
        if (typeof fn !== "function") {
          throw new TypeError("sql.begin requires a callback function");
        }
        const safeOpts = String(opts || "").replace(/[^a-z ]/gi, "");
        await target.unsafe("begin " + safeOpts);
        try {
          const result = await fn(target);
          await target.unsafe("commit");
          return result;
        } catch (e) {
          try { await target.unsafe("rollback"); } catch { /* swallow */ }
          throw e;
        }
      };
    }

    const value = target[prop];
    return typeof value === "function" ? value.bind(target) : value;
  },
});

// ─────────────────────────────────────────────────────────────────────
// withServiceRole: ejecutar bloque como service_role (bypass RLS).
//
// Usar SOLO en código de jobs/cron que necesite ver/escribir todas las
// empresas. Reserva una conexión del pool, hace `SET ROLE service_role`
// a nivel de sesión y la deja en el AsyncLocalStorage para que el `sql`
// proxy de los controllers reutilice esa misma conexión durante el
// callback. A diferencia de envolver en `begin()`, esto permite que el
// código interno haga sus propias transacciones (sql.begin) sin colisionar
// con un BEGIN externo.
//
// Requisito: el rol DB conectado (contendo_app) tiene que ser miembro de
// service_role → `GRANT service_role TO contendo_app` en producción.
// ─────────────────────────────────────────────────────────────────────
export async function withServiceRole(fn) {
  const reserved = await poolSql.reserve();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try { reserved.release?.(); } catch { /* swallow */ }
  };
  try {
    await reserved`SET ROLE service_role`;
    return await new Promise((resolve, reject) => {
      tenantStorage.run(reserved, () => {
        Promise.resolve(fn(reserved)).then(resolve, reject);
      });
    });
  } finally {
    try { await reserved`RESET ROLE`; } catch { /* swallow */ }
    release();
  }
}
