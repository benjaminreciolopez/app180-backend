/**
 * Auth Helper - Real registration and login flows for ALL user types
 * Executes actual API calls, no fake JWTs
 */
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app.js';

const api = supertest(app);

/**
 * Register first admin (only works if no empresas exist in DB)
 * For test env, we seed directly via SQL instead
 */
export async function registerFirstAdmin(email, password, nombre, empresaNombre) {
  const res = await api
    .post('/auth/register-first-admin')
    .send({ email, password, nombre, empresa_nombre: empresaNombre });
  return res;
}

/**
 * Login as any role (admin, empleado, asesor)
 */
export async function login(email, password, deviceHash = null) {
  const body = { email, password };
  if (deviceHash) body.device_hash = deviceHash;

  const res = await api
    .post('/auth/login')
    .send(body);
  return res;
}

/**
 * Register a new asesor (public endpoint)
 */
export async function registerAsesor({ nombre, cif, emailContacto, telefono, userNombre, userEmail, userPassword }) {
  const res = await api
    .post('/asesor/registro')
    .send({
      nombre,
      cif,
      email_contacto: emailContacto,
      telefono,
      user_nombre: userNombre,
      user_email: userEmail,
      user_password: userPassword,
    });
  return res;
}

/**
 * Create employee (as admin)
 */
export async function createEmployee(adminToken, employeeData) {
  const res = await api
    .post('/admin/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(employeeData);
  return res;
}

/**
 * Invite employee (as admin) - generates install token
 */
export async function inviteEmployee(adminToken, employeeId) {
  const res = await api
    .post(`/admin/employees/${employeeId}/invite`)
    .set('Authorization', `Bearer ${adminToken}`);
  return res;
}

/**
 * Activate employee device with invite token
 */
export async function activateInstall(token, deviceHash) {
  const res = await api
    .post('/auth/activate-install')
    .send({ token, device_hash: deviceHash, user_agent: 'TestAgent/1.0' });
  return res;
}

/**
 * Change password (for password_forced flow)
 */
export async function changePassword(authToken, currentPassword, newPassword) {
  const res = await api
    .post('/auth/change-password')
    .set('Authorization', `Bearer ${authToken}`)
    .send({ current_password: currentPassword, new_password: newPassword });
  return res;
}

/**
 * Invite asesor to client empresa (as asesor)
 */
export async function invitarCliente(asesorToken, empresaEmail) {
  const res = await api
    .post('/asesor/clientes/invitar')
    .set('Authorization', `Bearer ${asesorToken}`)
    .send({ empresa_email: empresaEmail });
  return res;
}

/**
 * Accept asesor invitation (as admin)
 */
export async function aceptarAsesoria(adminToken, vinculoId) {
  const res = await api
    .put(`/admin/asesoria/aceptar/${vinculoId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  return res;
}

/**
 * Get /auth/me
 */
export async function getMe(token) {
  const res = await api
    .get('/auth/me')
    .set('Authorization', `Bearer ${token}`);
  return res;
}

// ─── INVALID TOKEN GENERATORS ──────────────────────────────

/**
 * Generate an expired JWT (expired 1 hour ago)
 */
export function getExpiredToken() {
  return jwt.sign(
    { id: 'test-expired', email: 'expired@test-hacker.app180', role: 'admin', empresa_id: 'fake' },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '-1h' }
  );
}

/**
 * Generate a JWT with tampered signature
 */
export function getTamperedToken() {
  const token = jwt.sign(
    { id: 'test-tampered', email: 'tampered@test-hacker.app180', role: 'admin', empresa_id: 'fake' },
    'wrong-secret-key',
    { expiresIn: '1h' }
  );
  return token;
}

/**
 * Generate a JWT with an invalid/invented role
 */
export function getWrongRoleToken() {
  return jwt.sign(
    { id: 'test-wrong', email: 'wrong@test-hacker.app180', role: 'superadmin', empresa_id: 'fake' },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
}
