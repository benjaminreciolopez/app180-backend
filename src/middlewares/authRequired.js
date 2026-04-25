// backend\src\middlewares\authRequired.js
//
// Re-exports `authRequired` as a middleware chain that runs the JWT/auth
// resolver first, then `tenantContext` (which reserves a connection and sets
// app.empresa_id GUC when RLS_TENANT_CONTEXT_ENABLED=true).
//
// Express accepts arrays of middlewares in app.use/route handlers, so all
// existing `app.use(path, authRequired, routes)` mounts pick up the tenant
// context automatically without per-route edits.

import { authRequired as authMiddleware } from "./authMiddleware.js";
import { tenantContext } from "./tenantContext.js";

export const authRequired = [authMiddleware, tenantContext];
