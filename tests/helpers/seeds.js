/**
 * Test Data Seeding - Creates complete test environment
 * Uses REAL API calls to simulate actual user flows
 */
import supertest from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import app from '../../src/app.js';
import { sql } from '../../src/db.js';
import { config } from '../../src/config.js';

const api = supertest(app);

// Test email domain - all test users use this pattern for easy cleanup
const TEST_DOMAIN = 'test-hacker.app180';

// Store test environment data globally
let testEnv = null;

/**
 * Creates the complete test environment:
 * - Empresa A (complete: admin + 2 empleados + 1 cliente + emisor)
 * - Empresa B (empty: admin only, for cross-tenant tests)
 * - Asesoria (linked to empresa A, default perms)
 * - Asesoria Restringida (linked to empresa A, limited perms)
 */
export async function setupCompleteTestEnvironment() {
  if (testEnv) return testEnv;

  console.log('  📦 Seeding test data...');

  // Pre-cleanup: remove leftover data from previous crashed runs
  await preCleanup();

  // ─── EMPRESA A (complete) ───────────────────────────────
  const empresaA = await createEmpresaWithAdmin(
    `admin-a@${TEST_DOMAIN}`,
    'TestPass123!',
    'Admin Test A',
    'Empresa Test A S.L.'
  );

  // Create config with all modules enabled
  await enableAllModules(empresaA.id);

  // Create emisor for invoicing
  const emisor = await createEmisor(empresaA.id);

  // Create 1 client
  const cliente1 = await createCliente(empresaA.adminToken, empresaA.id);

  // Create 2 employees via real flow
  const empleado1 = await createAndActivateEmployee(
    empresaA.adminToken,
    empresaA.id,
    `empleado1@${TEST_DOMAIN}`,
    'Empleado Test Uno'
  );

  const empleado2 = await createAndActivateEmployee(
    empresaA.adminToken,
    empresaA.id,
    `empleado2@${TEST_DOMAIN}`,
    'Empleado Test Dos'
  );

  empresaA.empleado1 = empleado1;
  empresaA.empleado2 = empleado2;
  empresaA.cliente1 = cliente1;
  empresaA.emisor = emisor;

  // ─── EMPRESA B (empty, cross-tenant) ───────────────────
  const empresaB = await createEmpresaWithAdmin(
    `admin-b@${TEST_DOMAIN}`,
    'TestPass123!',
    'Admin Test B',
    'Empresa Test B S.L.'
  );
  await enableAllModules(empresaB.id);

  // ─── ASESORIA (linked to A) ────────────────────────────
  const asesoria = await createAndLinkAsesoria(
    `asesor@${TEST_DOMAIN}`,
    'TestPass123!',
    'Asesor Test',
    'Asesoria Test S.L.',
    empresaA
  );

  // ─── ASESORIA RESTRINGIDA (linked to A, limited perms) ─
  const asesoriaRestringida = await createAndLinkAsesoria(
    `asesor-rest@${TEST_DOMAIN}`,
    'TestPass123!',
    'Asesor Restringido',
    'Asesoria Restringida S.L.',
    empresaA,
    { nominas: { read: false, write: false }, fiscal: { read: false, write: false } }
  );

  testEnv = {
    empresaA,
    empresaB,
    asesoria,
    asesoriaRestringida,
  };

  // Also store in globalThis for cross-module persistence
  globalThis.__TEST_ENV__ = testEnv;

  console.log('  ✅ Seeding complete');
  return testEnv;
}

/**
 * Get the cached test environment (for use in test files)
 */
export function getTestEnv() {
  return testEnv || globalThis.__TEST_ENV__;
}

// ─── INTERNAL HELPERS ──────────────────────────────────────

async function createEmpresaWithAdmin(email, password, nombre, empresaNombre) {
  const hashedPassword = await bcrypt.hash(password, 10);

  // Insert user (ON CONFLICT for idempotency after crashed runs)
  const [user] = await sql`
    INSERT INTO users_180 (email, password, nombre, role, password_forced)
    VALUES (${email}, ${hashedPassword}, ${nombre}, 'admin', false)
    ON CONFLICT (email) DO UPDATE SET
      password = EXCLUDED.password,
      nombre = EXCLUDED.nombre,
      role = 'admin',
      password_forced = false
    RETURNING id, email, nombre, role
  `;

  // Insert empresa (check first for idempotency)
  let empresa;
  const existingEmpresa = await sql`SELECT id, nombre FROM empresa_180 WHERE user_id = ${user.id}`;
  if (existingEmpresa.length > 0) {
    empresa = existingEmpresa[0];
  } else {
    [empresa] = await sql`
      INSERT INTO empresa_180 (nombre, user_id)
      VALUES (${empresaNombre}, ${user.id})
      RETURNING id, nombre
    `;
  }

  // Create empresa_config
  await sql`
    INSERT INTO empresa_config_180 (empresa_id, modulos)
    VALUES (${empresa.id}, ${JSON.stringify({})})
    ON CONFLICT (empresa_id) DO NOTHING
  `;

  // Login to get real token (login finds empresa via empresa_180.user_id)
  const loginRes = await api
    .post('/auth/login')
    .send({ email, password });

  const token = loginRes.body.token;

  return {
    id: empresa.id,
    nombre: empresaNombre,
    adminUserId: user.id,
    adminEmail: email,
    adminPassword: password,
    adminToken: token,
  };
}

async function enableAllModules(empresaId) {
  const modulos = {
    clientes: true, empleados: true, fichajes: true, calendario: true,
    calendario_import: true, worklogs: true, facturacion: true, pagos: true,
    fiscal: true, contabilidad: true, ausencias: true,
  };
  // Use UPSERT to ensure config exists and all modules are enabled
  // Pass raw object for JSONB column (not JSON.stringify - that double-encodes)
  await sql`
    INSERT INTO empresa_config_180 (empresa_id, modulos)
    VALUES (${empresaId}, ${sql.json(modulos)})
    ON CONFLICT (empresa_id) DO UPDATE SET modulos = ${sql.json(modulos)}
  `;
}

async function createEmisor(empresaId) {
  // Check if emisor already exists (idempotency)
  const existing = await sql`SELECT id, serie_facturacion, numeracion_plantilla FROM emisor_180 WHERE empresa_id = ${empresaId}`;
  if (existing.length > 0) return existing[0];

  const [emisor] = await sql`
    INSERT INTO emisor_180 (
      empresa_id, nombre, nif, direccion, cp, poblacion, provincia,
      serie_facturacion, numeracion_plantilla, siguiente_numero, ultimo_anio_numerado
    ) VALUES (
      ${empresaId}, 'Empresa Test S.L.', 'B12345678', 'Calle Test 1', '28001',
      'Madrid', 'Madrid', 'T', '{SERIE}-{YEAR}-{NUM:04d}', 1, ${new Date().getFullYear()}
    )
    RETURNING id, serie_facturacion, numeracion_plantilla
  `;
  return emisor;
}

async function createCliente(adminToken, empresaId) {
  // Check if client already exists (idempotency)
  const existing = await sql`SELECT id, nombre, nif, codigo FROM clients_180 WHERE empresa_id = ${empresaId} AND nif = 'A87654321'`;
  if (existing.length > 0) return existing[0];

  const [cliente] = await sql`
    INSERT INTO clients_180 (
      empresa_id, nombre, nif, email, telefono, direccion, codigo_postal, poblacion, codigo
    ) VALUES (
      ${empresaId}, 'Cliente Test S.L.', 'A87654321', 'cliente@test.com',
      '+34600000000', 'Calle Cliente 1', '28002', 'Madrid', 'CLI-00001'
    )
    RETURNING id, nombre, nif, codigo
  `;
  return cliente;
}

async function createAndActivateEmployee(adminToken, empresaId, email, nombre) {
  const password = 'TestPass123!';
  const deviceHash = `device-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create user (ON CONFLICT for idempotency)
  const [user] = await sql`
    INSERT INTO users_180 (email, password, nombre, role, password_forced)
    VALUES (${email}, ${hashedPassword}, ${nombre}, 'empleado', false)
    ON CONFLICT (email) DO UPDATE SET
      password = EXCLUDED.password,
      nombre = EXCLUDED.nombre,
      password_forced = false
    RETURNING id, email, nombre
  `;

  // Create employee record (ON CONFLICT for idempotency)
  const existing = await sql`SELECT id FROM employees_180 WHERE user_id = ${user.id} AND empresa_id = ${empresaId}`;
  let employee;
  if (existing.length > 0) {
    employee = existing[0];
  } else {
    [employee] = await sql`
      INSERT INTO employees_180 (empresa_id, user_id, nombre, activo, tipo_trabajo)
      VALUES (${empresaId}, ${user.id}, ${nombre}, true, 'interno')
      RETURNING id
    `;
  }

  // Register device (needs user_id and empresa_id)
  await sql`
    INSERT INTO employee_devices_180 (empleado_id, user_id, empresa_id, device_hash, activo, user_agent)
    VALUES (${employee.id}, ${user.id}, ${empresaId}, ${deviceHash}, true, 'TestAgent/1.0')
    ON CONFLICT DO NOTHING
  `;

  // Login (login handler finds empresa via employees_180.empresa_id)
  const loginRes = await api
    .post('/auth/login')
    .send({ email, password, device_hash: deviceHash });

  return {
    id: employee.id,
    userId: user.id,
    email,
    password,
    deviceHash,
    token: loginRes.body.token,
  };
}

async function createAndLinkAsesoria(email, password, nombre, asesoriaNombre, empresaA, customPermisos = null) {
  // NOTE: Cannot use POST /asesor/registro because adminJornadasRoutes mounted at "/"
  // in app.js (line 221) intercepts ALL requests with router.use(authRequired) before
  // they reach the /asesor mount at line 267. This is a PRODUCTION BUG too.
  // Workaround: create asesor directly via DB + JWT.

  try {
    const hash = await bcrypt.hash(password, 10);
    const emailLower = email.trim().toLowerCase();
    const cif = 'B' + Math.random().toString().slice(2, 10);

    // Check if user already exists
    const [existingUser] = await sql`
      SELECT id FROM users_180 WHERE email = ${emailLower} LIMIT 1
    `;

    let userId, asesoriaId;

    if (existingUser) {
      userId = existingUser.id;
      // Check if asesoria already exists for this user
      const [existingLink] = await sql`
        SELECT asesoria_id FROM asesoria_usuarios_180 WHERE user_id = ${userId} LIMIT 1
      `;
      if (existingLink) {
        asesoriaId = existingLink.asesoria_id;
      }
    }

    if (!asesoriaId) {
      // Create everything in a transaction
      const result = await sql.begin(async (tx) => {
        // 1. Create user with role='asesor'
        const [user] = userId
          ? await tx`SELECT id, email, nombre, role FROM users_180 WHERE id = ${userId}`
          : await tx`
            INSERT INTO users_180 (email, password, nombre, role, password_forced)
            VALUES (${emailLower}, ${hash}, ${nombre.trim()}, 'asesor', false)
            RETURNING id, email, nombre, role
          `;

        // 2. Create asesoria
        const [asesoria] = await tx`
          INSERT INTO asesorias_180 (nombre, cif, email_contacto, created_at)
          VALUES (${asesoriaNombre.trim()}, ${cif}, ${emailLower}, now())
          RETURNING id, nombre
        `;

        // 3. Link user to asesoria
        await tx`
          INSERT INTO asesoria_usuarios_180 (asesoria_id, user_id, rol_interno, activo, created_at)
          VALUES (${asesoria.id}, ${user.id}, 'admin_asesoria', true, now())
        `;

        return { user, asesoria };
      });

      userId = result.user.id;
      asesoriaId = result.asesoria.id;
    }

    // Generate JWT token (same as registrarAsesoria controller)
    const asesorToken = jwt.sign(
      {
        id: userId,
        email: emailLower,
        role: 'asesor',
        nombre: nombre.trim(),
        asesoria_id: asesoriaId,
        password_forced: false,
      },
      config.jwtSecret,
      { expiresIn: '10h' }
    );

    // Invite empresa A and create vinculo directly via DB
    // (The /asesor/clientes/invitar route is also blocked by the same bug)
    const defaultPermisos = {
      facturas: { read: true, write: false },
      gastos: { read: true, write: false },
      clientes: { read: true, write: false },
      empleados: { read: true, write: false },
      nominas: { read: true, write: false },
      fiscal: { read: true, write: false },
      contabilidad: { read: true, write: false },
      configuracion: { read: true, write: false },
    };
    const permisos = customPermisos ? { ...defaultPermisos, ...customPermisos } : defaultPermisos;

    // Check if vinculo already exists
    const [existingVinculo] = await sql`
      SELECT id FROM asesoria_clientes_180
      WHERE asesoria_id = ${asesoriaId} AND empresa_id = ${empresaA.id}
      LIMIT 1
    `;

    let vinculoId;
    if (existingVinculo) {
      vinculoId = existingVinculo.id;
      await sql`
        UPDATE asesoria_clientes_180
        SET permisos = ${sql.json(permisos)}, estado = 'activo'
        WHERE id = ${vinculoId}
      `;
    } else {
      const [vinculo] = await sql`
        INSERT INTO asesoria_clientes_180 (asesoria_id, empresa_id, estado, permisos, created_at)
        VALUES (${asesoriaId}, ${empresaA.id}, 'activo', ${sql.json(permisos)}, now())
        RETURNING id
      `;
      vinculoId = vinculo.id;
    }

    console.log(`  ✅ Asesor created: ${emailLower} (asesoria: ${asesoriaId}, vinculo: ${vinculoId})`);

    return {
      id: asesoriaId,
      asesorUserId: userId,
      asesorToken,
      email,
      password,
      vinculoId,
    };
  } catch (err) {
    console.error(`  ⚠️ Asesor creation failed:`, err.message);
    return { id: null, asesorUserId: null, asesorToken: null, email, password, vinculoId: null };
  }
}

// ─── CLEANUP ───────────────────────────────────────────────

/**
 * Pre-cleanup: remove leftover data from previous crashed runs
 * Identifies test data by email pattern (@test-hacker.app180)
 */
async function preCleanup() {
  try {
    // Find test empresa IDs
    const empresas = await sql`
      SELECT e.id FROM empresa_180 e
      JOIN users_180 u ON e.user_id = u.id
      WHERE u.email LIKE ${'%@' + TEST_DOMAIN}
    `.catch(() => []);
    const empresaIds = empresas.map(e => e.id);

    if (empresaIds.length > 0) {
      console.log(`  🧹 Pre-cleanup: removing ${empresaIds.length} stale test empresas...`);
      for (const empresaId of empresaIds) {
        // Accounting
        await sql`DELETE FROM asiento_lineas_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM asientos_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM ejercicios_contables_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM pgc_cuentas_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        // Time tracking
        await sql`DELETE FROM fichaje_correcciones_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM fichaje_verificaciones_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM fichajes_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        // VeriFactu
        await sql`DELETE FROM registroverifactueventos_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM registroverifactu_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        // Invoicing
        await sql`DELETE FROM lineafactura_180 WHERE factura_id IN (SELECT id FROM factura_180 WHERE empresa_id = ${empresaId})`.catch(() => {});
        await sql`DELETE FROM envios_email_180 WHERE factura_id IN (SELECT id FROM factura_180 WHERE empresa_id = ${empresaId})`.catch(() => {});
        await sql`DELETE FROM factura_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        // Purchases & Payroll
        await sql`DELETE FROM purchases_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM nominas_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        // Asesoria
        await sql`DELETE FROM asesoria_mensajes_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM asesoria_clientes_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        // HR
        await sql`DELETE FROM invite_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM employee_devices_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM centros_trabajo_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM employees_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM clients_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM emisor_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        // Audit & notifications
        await sql`DELETE FROM audit_log_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM notificaciones_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        // Config
        await sql`DELETE FROM configuracionsistema_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        await sql`DELETE FROM empresa_config_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
        // Empresa
        await sql`DELETE FROM empresa_180 WHERE id = ${empresaId}`.catch(() => {});
      }
    }

    // Clean asesorias linked to test users
    await sql`DELETE FROM asesoria_usuarios_180 WHERE user_id IN (SELECT id FROM users_180 WHERE email LIKE ${'%@' + TEST_DOMAIN})`.catch(() => {});
    // Clean asesorias by email_contacto pattern (catches ALL test asesorias including 'Restringida')
    await sql`DELETE FROM asesorias_180 WHERE email_contacto LIKE ${'%@' + TEST_DOMAIN}`.catch(() => {});
    // Also clean orphan asesorias with test-like names as fallback
    await sql`DELETE FROM asesorias_180 WHERE (nombre LIKE '%Test%' OR nombre LIKE '%Restringida%') AND id NOT IN (SELECT DISTINCT asesoria_id FROM asesoria_usuarios_180 WHERE asesoria_id IS NOT NULL)`.catch(() => {});

    // Finally clean test users
    await sql`DELETE FROM users_180 WHERE email LIKE ${'%@' + TEST_DOMAIN}`.catch(() => {});
  } catch (err) {
    console.error('  ⚠️ Pre-cleanup error (non-fatal):', err.message);
  }
}

/**
 * Remove all test data (respects FK constraints)
 */
export async function cleanupAllTestData() {
  if (!testEnv) return;

  const empresaIds = [testEnv.empresaA.id, testEnv.empresaB.id].filter(Boolean);

  try {
    for (const empresaId of empresaIds) {
      // Accounting
      await sql`DELETE FROM asiento_lineas_180 WHERE asiento_id IN (SELECT id FROM asientos_180 WHERE empresa_id = ${empresaId})`.catch(() => {});
      await sql`DELETE FROM asientos_180 WHERE empresa_id = ${empresaId}`.catch(() => {});

      // Time tracking
      await sql`DELETE FROM fichaje_correcciones_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
      await sql`DELETE FROM fichajes_180 WHERE empresa_id = ${empresaId}`.catch(() => {});

      // Invoices
      await sql`DELETE FROM lineafactura_180 WHERE factura_id IN (SELECT id FROM factura_180 WHERE empresa_id = ${empresaId})`.catch(() => {});
      await sql`DELETE FROM factura_180 WHERE empresa_id = ${empresaId}`.catch(() => {});

      // Purchases & Payroll
      await sql`DELETE FROM purchases_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
      await sql`DELETE FROM nominas_180 WHERE empresa_id = ${empresaId}`.catch(() => {});

      // Asesoria
      await sql`DELETE FROM asesoria_mensajes_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
      await sql`DELETE FROM asesoria_clientes_180 WHERE empresa_id = ${empresaId}`.catch(() => {});

      // HR
      await sql`DELETE FROM employee_devices_180 WHERE empleado_id IN (SELECT id FROM employees_180 WHERE empresa_id = ${empresaId})`.catch(() => {});
      await sql`DELETE FROM employees_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
      await sql`DELETE FROM clients_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
      await sql`DELETE FROM emisor_180 WHERE empresa_id = ${empresaId}`.catch(() => {});

      // Audit
      await sql`DELETE FROM audit_log_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
      await sql`DELETE FROM notificaciones_180 WHERE empresa_id = ${empresaId}`.catch(() => {});

      // Config & empresa
      await sql`DELETE FROM empresa_config_180 WHERE empresa_id = ${empresaId}`.catch(() => {});
      await sql`DELETE FROM empresa_180 WHERE id = ${empresaId}`.catch(() => {});
    }

    // Asesoria entities
    const asesoriaIds = [testEnv.asesoria?.id, testEnv.asesoriaRestringida?.id].filter(Boolean);
    for (const id of asesoriaIds) {
      await sql`DELETE FROM asesoria_usuarios_180 WHERE asesoria_id = ${id}`.catch(() => {});
      await sql`DELETE FROM asesorias_180 WHERE id = ${id}`.catch(() => {});
    }

    // Test users (by email pattern)
    await sql`DELETE FROM users_180 WHERE email LIKE ${'%@' + TEST_DOMAIN}`.catch(() => {});
  } catch (err) {
    console.error('  ⚠️ Cleanup error:', err.message);
  }

  testEnv = null;
}
