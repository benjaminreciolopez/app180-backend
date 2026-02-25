/**
 * Supertest wrappers with auto-injected auth headers per role
 */
import supertest from 'supertest';
import app from '../../src/app.js';

/**
 * Create a supertest agent with admin auth headers
 */
export function adminApi(token) {
  return supertest(app)
    .set ? undefined : undefined; // supertest doesn't chain this way
}

// Helper: creates a request builder that auto-sets headers
function createApi(token, extraHeaders = {}) {
  const agent = supertest(app);

  // Return a proxy that auto-applies headers on each request
  return new Proxy(agent, {
    get(target, prop) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(prop)) {
        return (...args) => {
          let req = target[prop](...args);
          if (token) {
            req = req.set('Authorization', `Bearer ${token}`);
          }
          for (const [key, value] of Object.entries(extraHeaders)) {
            req = req.set(key, value);
          }
          return req;
        };
      }
      return target[prop];
    }
  });
}

/** Admin API - sets Authorization header */
export function admin(token) {
  return createApi(token);
}

/** Empleado API - sets Authorization header */
export function empleado(token) {
  return createApi(token);
}

/** Asesor API - sets Authorization + X-Empresa-Id headers */
export function asesor(token, empresaId) {
  return createApi(token, { 'X-Empresa-Id': empresaId });
}

/** Public API - no auth headers */
export function publicApi() {
  return createApi(null);
}

/** Raw supertest instance for custom tests */
export function raw() {
  return supertest(app);
}
