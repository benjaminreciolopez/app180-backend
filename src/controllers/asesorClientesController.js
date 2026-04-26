// backend/src/controllers/asesorClientesController.js
// CRUD de clientes propios de la asesoría + helper para auto-crear desde vínculo

import { sql } from "../db.js";
import { crearNotificacionSistema } from "./notificacionesController.js";

function n(v) {
  return v === undefined ? null : v;
}

// Permisos por defecto cuando se crea un vínculo pendiente desde el asesor (cliente con app)
const ASESOR_DEFAULT_PERMISOS = {
  facturas: { read: true, write: false },
  gastos: { read: true, write: false },
  clientes: { read: true, write: false },
  empleados: { read: true, write: false },
  nominas: { read: true, write: false },
  fiscal: { read: true, write: false },
  contabilidad: { read: true, write: false },
  configuracion: { read: true, write: false },
};

// Permisos completos cuando la empresa es gestionada (cliente sin app)
const ASESOR_FULL_PERMISOS = {
  facturas: { read: true, write: true },
  gastos: { read: true, write: true },
  clientes: { read: true, write: true },
  empleados: { read: true, write: true },
  nominas: { read: true, write: true },
  fiscal: { read: true, write: true },
  contabilidad: { read: true, write: true },
  configuracion: { read: true, write: true },
  documentos: { read: true, write: true },
};

/**
 * Busca o crea la empresa "destino" para un cliente del asesor:
 *  - Si encuentra una empresa por NIF con user_id → la empresa USA la app: crea vínculo pendiente.
 *  - Si encuentra una empresa por NIF sin user_id, gestionada por la misma asesoría → reusa.
 *  - Si encuentra una empresa por NIF sin user_id, gestionada por OTRA asesoría → error.
 *  - Si no encuentra → crea empresa gestionada con vínculo activo.
 *
 * Devuelve { empresa_id, vinculo_id, action, modo } o null si no se aplicó (sin NIF).
 */
async function ensureEmpresaForClienteAsesoria(tx, { asesoriaId, nif, nombre, tipoContribuyente, regimenIva, email }) {
  if (!nif) return null;
  const nifNorm = String(nif).trim().toUpperCase();

  // La identidad fiscal (NIF, nombre fiscal, regimen_iva, tipo_contribuyente) vive en
  // emisor_180, NO en empresa_180. Buscamos por emisor_180.nif.
  const [existing] = await tx`
    SELECT e.id, e.user_id, e.gestionada_por_asesoria_id, e.nombre
    FROM emisor_180 em
    JOIN empresa_180 e ON e.id = em.empresa_id
    WHERE UPPER(em.nif) = ${nifNorm}
    LIMIT 1
  `;

  if (existing) {
    if (existing.user_id) {
      // Empresa con app instalada: crear vínculo pendiente si no existe
      const [vinExist] = await tx`
        SELECT id, estado FROM asesoria_clientes_180
        WHERE asesoria_id = ${asesoriaId} AND empresa_id = ${existing.id}
        LIMIT 1
      `;
      if (vinExist) {
        return { empresa_id: existing.id, vinculo_id: vinExist.id, action: 'existed', modo: 'con_app', estado: vinExist.estado };
      }
      const [vin] = await tx`
        INSERT INTO asesoria_clientes_180 (asesoria_id, empresa_id, estado, invitado_por, permisos, created_at)
        VALUES (${asesoriaId}, ${existing.id}, 'pendiente', 'asesoria', ${tx.json(ASESOR_DEFAULT_PERMISOS)}, now())
        RETURNING id, estado
      `;
      return { empresa_id: existing.id, vinculo_id: vin.id, action: 'invited', modo: 'con_app', estado: 'pendiente' };
    }

    if (existing.gestionada_por_asesoria_id && existing.gestionada_por_asesoria_id !== asesoriaId) {
      // Otra asesoría ya la gestiona
      throw Object.assign(new Error(`Empresa con NIF ${nifNorm} ya gestionada por otra asesoría`), { status: 409 });
    }

    // Misma asesoría o sin gestionar — asegurar vínculo activo
    const [vinExist] = await tx`
      SELECT id, estado FROM asesoria_clientes_180
      WHERE asesoria_id = ${asesoriaId} AND empresa_id = ${existing.id}
      LIMIT 1
    `;
    if (vinExist) {
      if (vinExist.estado !== 'activo') {
        await tx`UPDATE asesoria_clientes_180 SET estado = 'activo', connected_at = now() WHERE id = ${vinExist.id}`;
      }
      return { empresa_id: existing.id, vinculo_id: vinExist.id, action: 'reused', modo: 'sin_app', estado: 'activo' };
    }
    const [vin] = await tx`
      INSERT INTO asesoria_clientes_180 (asesoria_id, empresa_id, estado, invitado_por, permisos, connected_at, created_at)
      VALUES (${asesoriaId}, ${existing.id}, 'activo', 'asesoria', ${tx.json(ASESOR_FULL_PERMISOS)}, now(), now())
      RETURNING id, estado
    `;
    return { empresa_id: existing.id, vinculo_id: vin.id, action: 'reused', modo: 'sin_app', estado: 'activo' };
  }

  // No existe: crear empresa gestionada. tipo_contribuyente vive en empresa_180;
  // NIF y regimen_iva viven en emisor_180.
  let emp;
  try {
    const r = await tx`
      INSERT INTO empresa_180 (user_id, nombre, tipo_contribuyente, activo, gestionada_por_asesoria_id, created_at)
      VALUES (NULL, ${nombre || nifNorm}, ${tipoContribuyente || null}, true, ${asesoriaId}, now())
      RETURNING id, nombre
    `;
    emp = r[0];
  } catch (e) {
    // Fallback por si tipo_contribuyente no existe en esta instancia
    const r = await tx`
      INSERT INTO empresa_180 (user_id, nombre, activo, gestionada_por_asesoria_id, created_at)
      VALUES (NULL, ${nombre || nifNorm}, true, ${asesoriaId}, now())
      RETURNING id, nombre
    `;
    emp = r[0];
  }

  try {
    await tx`
      INSERT INTO emisor_180 (empresa_id, nombre, nif, regimen_iva)
      VALUES (${emp.id}, ${nombre || nifNorm}, ${nifNorm}, ${regimenIva || 'general'})
    `;
  } catch (e) {
    await tx`
      INSERT INTO emisor_180 (empresa_id, nombre, nif)
      VALUES (${emp.id}, ${nombre || nifNorm}, ${nifNorm})
    `;
  }

  const [vin] = await tx`
    INSERT INTO asesoria_clientes_180 (asesoria_id, empresa_id, estado, invitado_por, permisos, connected_at, created_at)
    VALUES (${asesoriaId}, ${emp.id}, 'activo', 'asesoria', ${tx.json(ASESOR_FULL_PERMISOS)}, now(), now())
    RETURNING id, estado
  `;
  return { empresa_id: emp.id, vinculo_id: vin.id, action: 'created', modo: 'sin_app', estado: 'activo' };
}

// ─── Helpers ────────────────────────────────────────────────

async function getAsesorEmpresaId(req) {
  const empresaId = req.user.empresa_id;
  if (!empresaId) {
    const e = new Error("Empresa de asesoría no asociada");
    e.status = 403;
    throw e;
  }
  return empresaId;
}

async function obtenerSiguienteCodigo(empresaId) {
  const r = await sql`
    SELECT last_num FROM cliente_seq_180
    WHERE empresa_id = ${empresaId}
  `;
  const nextNum = r[0] ? r[0].last_num + 1 : 1;
  return `CLI-${String(nextNum).padStart(5, "0")}`;
}

// ─── LISTAR ─────────────────────────────────────────────────

export async function listarMisClientes(req, res) {
  try {
    const empresaId = await getAsesorEmpresaId(req);

    const rows = await sql`
      SELECT c.*,
             f.razon_social, f.nif_cif, f.tipo_fiscal,
             f.municipio, f.codigo_postal, f.direccion_fiscal,
             f.email_factura, f.telefono_factura, f.persona_contacto,
             f.iva_defecto, f.exento_iva, f.forma_pago, f.iban
      FROM clients_180 c
      LEFT JOIN client_fiscal_data_180 f ON f.cliente_id = c.id
      WHERE c.empresa_id = ${empresaId}
      ORDER BY c.activo DESC, c.nombre
    `;

    res.json(rows);
  } catch (err) {
    console.error("Error listarMisClientes:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

// ─── DETALLE ────────────────────────────────────────────────

export async function getClienteDetalle(req, res) {
  try {
    const empresaId = await getAsesorEmpresaId(req);
    const { id } = req.params;

    const [cliente] = await sql`
      SELECT c.*,
             f.razon_social, f.nif_cif, f.tipo_fiscal,
             f.pais, f.provincia, f.municipio, f.codigo_postal, f.direccion_fiscal,
             f.email_factura, f.telefono_factura, f.persona_contacto,
             f.iva_defecto, f.exento_iva, f.forma_pago, f.iban
      FROM clients_180 c
      LEFT JOIN client_fiscal_data_180 f ON f.cliente_id = c.id
      WHERE c.id = ${id}
        AND c.empresa_id = ${empresaId}
      LIMIT 1
    `;

    if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });

    res.json(cliente);
  } catch (err) {
    console.error("Error getClienteDetalle:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

// ─── SIGUIENTE CÓDIGO ───────────────────────────────────────

export async function getSiguienteCodigo(req, res) {
  try {
    const empresaId = await getAsesorEmpresaId(req);
    const codigo = await obtenerSiguienteCodigo(empresaId);
    res.json({ codigo });
  } catch (err) {
    console.error("Error getSiguienteCodigo:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

// ─── CREAR ──────────────────────────────────────────────────

export async function crearCliente(req, res) {
  try {
    const empresaId = await getAsesorEmpresaId(req);

    const {
      nombre,
      codigo,
      tipo = "cliente",
      direccion,
      telefono,
      contacto_nombre,
      contacto_email,
      nif,
      poblacion,
      municipio,
      provincia,
      cp,
      codigo_postal,
      pais = "ES",
      email,
      notas,
      razon_social,
      nif_cif,
      tipo_fiscal,
      direccion_fiscal,
      email_factura,
      telefono_factura,
      persona_contacto,
      iva_defecto,
      exento_iva,
      forma_pago,
      iban,
    } = req.body;

    if (!nombre) return res.status(400).json({ error: "Nombre requerido" });
    if (!codigo) return res.status(400).json({ error: "Código requerido" });

    let finalPais = (pais || "ES").trim().toUpperCase();
    if (finalPais === "ESPAÑA" || finalPais === "SPAIN" || finalPais === "ESP") finalPais = "ES";
    if (finalPais.length > 2) finalPais = finalPais.substring(0, 2);

    // Sanitizar iva_defecto: la columna es text, pero el constraint clients_iva_check
    // sólo acepta NULL o un valor numérico válido (sin string vacío).
    let finalIvaDefecto = null;
    if (iva_defecto !== undefined && iva_defecto !== null && String(iva_defecto).trim() !== "") {
      const parsed = Number(String(iva_defecto).replace(",", ".").replace("%", "").trim());
      if (!Number.isNaN(parsed)) {
        finalIvaDefecto = String(parsed);
      }
    }
    const finalExentoIva = exento_iva === true || exento_iva === "true";

    const newClient = await sql.begin(async (tx) => {
      // Verificar duplicado
      const [existe] = await tx`
        SELECT 1 FROM clients_180
        WHERE empresa_id = ${empresaId} AND codigo = ${codigo}
        LIMIT 1
      `;
      if (existe) throw new Error("Código duplicado");

      // Insertar cliente
      const [cli] = await tx`
        INSERT INTO clients_180 (
          empresa_id, nombre, codigo, tipo,
          direccion, telefono, contacto_nombre, contacto_email,
          nif, nif_cif, poblacion, municipio, provincia, cp, codigo_postal, pais, email,
          modo_defecto, razon_social, iban, iva_defecto, exento_iva, activo
        ) VALUES (
          ${empresaId}, ${nombre}, ${codigo}, ${tipo},
          ${n(direccion)}, ${n(telefono)}, ${n(contacto_nombre)}, ${n(contacto_email)},
          ${n(nif || nif_cif)}, ${n(nif_cif || nif)},
          ${n(poblacion || municipio)}, ${n(municipio || poblacion)},
          ${n(provincia)},
          ${n(cp || codigo_postal)}, ${n(codigo_postal || cp)},
          ${finalPais}, ${n(email)},
          'mixto',
          ${n(razon_social)}, ${n(iban)}, ${finalIvaDefecto}, ${finalExentoIva}, true
        )
        RETURNING *
      `;

      // Insertar datos fiscales
      await tx`
        INSERT INTO client_fiscal_data_180 (
          empresa_id, cliente_id, razon_social, nif_cif, tipo_fiscal,
          pais, provincia, municipio, codigo_postal, direccion_fiscal,
          email_factura, telefono_factura, persona_contacto,
          iva_defecto, exento_iva, forma_pago, iban
        ) VALUES (
          ${empresaId}, ${cli.id},
          ${n(razon_social)}, ${n(nif_cif || nif)}, ${n(tipo_fiscal)},
          ${finalPais}, ${n(provincia)}, ${n(municipio || poblacion)},
          ${n(codigo_postal || cp)}, ${n(direccion_fiscal || direccion)},
          ${n(email_factura || email)}, ${n(telefono_factura || telefono)},
          ${n(persona_contacto || contacto_nombre)},
          ${iva_defecto ? Number(iva_defecto) : null},
          ${exento_iva === true}, ${n(forma_pago)}, ${n(iban)}
        )
      `;

      // Actualizar secuencia
      if (codigo.startsWith("CLI-")) {
        const numPart = parseInt(codigo.split("-")[1], 10);
        if (!isNaN(numPart)) {
          await tx`
            INSERT INTO cliente_seq_180 (empresa_id, last_num)
            VALUES (${empresaId}, ${numPart})
            ON CONFLICT (empresa_id) DO UPDATE
            SET last_num = GREATEST(cliente_seq_180.last_num, ${numPart})
          `;
        }
      }

      // Si la asesoría está creando este cliente, intentar vincularlo o crear empresa gestionada
      let vinculoInfo = null;
      const asesoriaId = req.user?.asesoria_id || null;
      if (asesoriaId) {
        try {
          vinculoInfo = await ensureEmpresaForClienteAsesoria(tx, {
            asesoriaId,
            nif: nif || nif_cif,
            nombre: nombre || razon_social,
            tipoContribuyente: tipo_fiscal || null,
            regimenIva: null,
            email: email || email_factura,
          });
          if (vinculoInfo?.empresa_id) {
            await tx`
              UPDATE clients_180 SET vinculado_empresa_id = ${vinculoInfo.empresa_id}
              WHERE id = ${cli.id}
            `;
          }
        } catch (e) {
          // Si el NIF colisiona con otra asesoría, no abortamos la creación del contacto:
          // el cliente queda como contacto suelto (sin empresa gestionada).
          console.warn(`[crearCliente] No se pudo crear/vincular empresa: ${e.message}`);
          vinculoInfo = { error: e.message };
        }
      }

      return { cli, vinculoInfo };
    });

    const { cli, vinculoInfo } = newClient;

    // Si se creó vínculo "con app" en estado pendiente → notificar al admin de la empresa
    if (vinculoInfo?.action === 'invited' && vinculoInfo.empresa_id) {
      try {
        const asesoriaNombre = req.user?.asesoria_nombre || "Una asesoría";
        await crearNotificacionSistema({
          empresaId: vinculoInfo.empresa_id,
          tipo: "invitacion_asesoria",
          titulo: "Nueva solicitud de asesoría",
          mensaje: `${asesoriaNombre} quiere vincularse con tu empresa`,
          accionUrl: "/admin/mi-asesoria",
          accionLabel: "Ver solicitud",
          metadata: { vinculo_id: vinculoInfo.vinculo_id },
        });
      } catch (e) {
        console.warn("Error notificando invitación:", e.message);
      }
    }

    res.status(201).json({
      ...cli,
      razon_social,
      nif_cif,
      vinculo: vinculoInfo
        ? {
            empresa_id: vinculoInfo.empresa_id,
            vinculo_id: vinculoInfo.vinculo_id,
            modo: vinculoInfo.modo,    // 'con_app' | 'sin_app'
            estado: vinculoInfo.estado,
            action: vinculoInfo.action, // 'invited' | 'reused' | 'created' | 'existed'
            error: vinculoInfo.error || null,
          }
        : null,
    });
  } catch (err) {
    console.error("Error crearCliente:", err);
    const status = err.message === "Código duplicado" ? 400 : (err.status || 500);
    res.status(status).json({ error: err.message });
  }
}

// ─── ACTUALIZAR ─────────────────────────────────────────────

export async function actualizarCliente(req, res) {
  try {
    const empresaId = await getAsesorEmpresaId(req);
    const { id } = req.params;
    const body = req.body;

    const allowedGeneral = [
      "nombre", "tipo", "direccion", "telefono", "contacto_nombre", "contacto_email",
      "notas", "activo",
      "nif", "nif_cif", "poblacion", "municipio", "provincia", "cp", "codigo_postal", "pais", "email",
      "razon_social", "iban", "iva_defecto", "exento_iva", "forma_pago",
    ];

    const allowedFiscal = [
      "razon_social", "nif_cif", "tipo_fiscal", "pais", "provincia",
      "codigo_postal", "direccion_fiscal", "municipio",
      "email_factura", "telefono_factura", "persona_contacto",
      "iva_defecto", "exento_iva", "forma_pago", "iban",
    ];

    const fieldsGeneral = {};
    const fieldsFiscal = {};

    for (const k of Object.keys(body)) {
      let val = body[k] === undefined ? null : body[k];

      if (k === "pais" && typeof val === "string") {
        val = val.trim().toUpperCase();
        if (val === "ESPAÑA" || val === "SPAIN" || val === "ESP") val = "ES";
        if (val.length > 2) val = val.substring(0, 2);
      }
      if (k === "iva_defecto" && val !== null && val !== undefined) val = Number(val);

      if (allowedGeneral.includes(k)) fieldsGeneral[k] = val;
      if (allowedFiscal.includes(k)) fieldsFiscal[k] = val;
    }

    // Sync nombre <-> razon_social
    if ("nombre" in body && body.nombre && !("razon_social" in body)) {
      fieldsFiscal.razon_social = body.nombre;
    }
    if ("razon_social" in body && body.razon_social && !("nombre" in body)) {
      fieldsGeneral.nombre = body.razon_social;
    }

    if ("nombre" in fieldsGeneral && !fieldsGeneral.nombre) {
      return res.status(400).json({ error: "El nombre del cliente es obligatorio" });
    }

    // Sanitizar iva_defecto: NULL o numérico (constraint clients_iva_check).
    // String vacío o NaN → NULL.
    if ("iva_defecto" in fieldsGeneral) {
      const iva = fieldsGeneral.iva_defecto;
      if (iva === null || iva === undefined || String(iva).trim() === "") {
        fieldsGeneral.iva_defecto = null;
      } else {
        const parsed = Number(String(iva).replace(",", ".").replace("%", "").trim());
        fieldsGeneral.iva_defecto = Number.isNaN(parsed) ? null : parsed;
      }
    }
    if ("exento_iva" in fieldsGeneral) {
      fieldsGeneral.exento_iva = fieldsGeneral.exento_iva === true || fieldsGeneral.exento_iva === "true";
    }

    let clientUpdated = null;
    if (Object.keys(fieldsGeneral).length > 0) {
      const [r] = await sql`
        UPDATE clients_180
        SET ${sql(fieldsGeneral)}
        WHERE id = ${id} AND empresa_id = ${empresaId}
        RETURNING *
      `;
      clientUpdated = r;
    }

    if (Object.keys(fieldsFiscal).length > 0) {
      const [exists] = await sql`SELECT id FROM client_fiscal_data_180 WHERE cliente_id = ${id}`;

      for (const key in fieldsFiscal) {
        if (fieldsFiscal[key] === undefined) fieldsFiscal[key] = null;
      }

      if (exists) {
        await sql`
          UPDATE client_fiscal_data_180
          SET ${sql(fieldsFiscal)}
          WHERE cliente_id = ${id}
        `;
      } else {
        await sql`
          INSERT INTO client_fiscal_data_180 (
            empresa_id, cliente_id, razon_social, nif_cif, tipo_fiscal,
            pais, provincia, municipio, codigo_postal, direccion_fiscal,
            email_factura, telefono_factura, persona_contacto,
            iva_defecto, exento_iva, forma_pago, iban
          ) VALUES (
            ${empresaId}, ${id},
            ${fieldsFiscal.razon_social ?? null}, ${fieldsFiscal.nif_cif ?? null},
            ${fieldsFiscal.tipo_fiscal ?? null}, ${fieldsFiscal.pais ?? 'ES'},
            ${fieldsFiscal.provincia ?? null}, ${fieldsFiscal.municipio ?? null},
            ${fieldsFiscal.codigo_postal ?? null}, ${fieldsFiscal.direccion_fiscal ?? null},
            ${fieldsFiscal.email_factura ?? null}, ${fieldsFiscal.telefono_factura ?? null},
            ${fieldsFiscal.persona_contacto ?? null}, ${fieldsFiscal.iva_defecto ?? null},
            ${fieldsFiscal.exento_iva ?? false}, ${fieldsFiscal.forma_pago ?? null},
            ${fieldsFiscal.iban ?? null}
          )
        `;
      }
    }

    const cliente = clientUpdated || (await sql`
      SELECT c.*, f.razon_social, f.nif_cif, f.tipo_fiscal,
             f.pais, f.provincia, f.municipio, f.codigo_postal, f.direccion_fiscal,
             f.email_factura, f.telefono_factura, f.persona_contacto,
             f.iva_defecto, f.exento_iva, f.forma_pago, f.iban
      FROM clients_180 c
      LEFT JOIN client_fiscal_data_180 f ON f.cliente_id = c.id
      WHERE c.id = ${id} AND c.empresa_id = ${empresaId}
      LIMIT 1
    `)[0];

    res.json(cliente);
  } catch (err) {
    console.error("Error actualizarCliente:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

// ─── DESACTIVAR ─────────────────────────────────────────────

export async function desactivarCliente(req, res) {
  try {
    const empresaId = await getAsesorEmpresaId(req);
    const { id } = req.params;

    await sql`
      UPDATE clients_180 SET activo = false
      WHERE id = ${id} AND empresa_id = ${empresaId}
    `;

    res.json({ ok: true });
  } catch (err) {
    console.error("Error desactivarCliente:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
}

// ─── AUTO-CREAR CLIENTE DESDE VÍNCULO ───────────────────────
// Llamado cuando un vínculo asesoría↔empresa pasa a "activo"

export async function createClientFromVinculo(asesoriaEmpresaId, vinculadaEmpresaId) {
  try {
    // 1. Verificar que no existe ya
    const [existing] = await sql`
      SELECT id FROM clients_180
      WHERE empresa_id = ${asesoriaEmpresaId}
        AND vinculado_empresa_id = ${vinculadaEmpresaId}
      LIMIT 1
    `;
    if (existing) {
      // Reactivar si estaba desactivado
      await sql`
        UPDATE clients_180 SET activo = true
        WHERE id = ${existing.id} AND activo = false
      `;
      return existing.id;
    }

    // 2. Obtener datos de la empresa vinculada
    // empresa_180 tiene: nombre, user_id
    // perfil_180 tiene los datos fiscales completos: cif, direccion, poblacion, provincia, cp, telefono, email
    const [empresa] = await sql`
      SELECT e.nombre, u.email AS admin_email,
             p.nombre_fiscal, p.cif, p.direccion, p.poblacion, p.provincia,
             p.cp, p.pais, p.telefono, p.email AS perfil_email, p.web
      FROM empresa_180 e
      LEFT JOIN users_180 u ON u.id = e.user_id
      LEFT JOIN perfil_180 p ON p.empresa_id = e.id
      WHERE e.id = ${vinculadaEmpresaId}
      LIMIT 1
    `;
    if (!empresa) return null;

    const clienteNombre = empresa.nombre_fiscal || empresa.nombre || "Cliente vinculado";
    const clienteEmail = empresa.perfil_email || empresa.admin_email || null;

    // 3. Generar código
    const codigo = await obtenerSiguienteCodigo(asesoriaEmpresaId);

    // 4. Crear cliente con datos completos del perfil
    const [cli] = await sql.begin(async (tx) => {
      const [newCli] = await tx`
        INSERT INTO clients_180 (
          empresa_id, vinculado_empresa_id, nombre, codigo, tipo,
          nif, nif_cif, email, telefono, direccion,
          poblacion, municipio, provincia, cp, codigo_postal, pais,
          contacto_email, razon_social, activo
        ) VALUES (
          ${asesoriaEmpresaId}, ${vinculadaEmpresaId},
          ${clienteNombre},
          ${codigo}, 'cliente',
          ${empresa.cif || null}, ${empresa.cif || null},
          ${clienteEmail},
          ${empresa.telefono || null},
          ${empresa.direccion || null},
          ${empresa.poblacion || null}, ${empresa.poblacion || null},
          ${empresa.provincia || null},
          ${empresa.cp || null}, ${empresa.cp || null},
          ${empresa.pais || 'ES'},
          ${empresa.admin_email || clienteEmail},
          ${empresa.nombre_fiscal || empresa.nombre || null},
          true
        )
        RETURNING *
      `;

      // Datos fiscales completos
      await tx`
        INSERT INTO client_fiscal_data_180 (
          empresa_id, cliente_id, razon_social, nif_cif,
          pais, provincia, municipio, codigo_postal, direccion_fiscal,
          email_factura, telefono_factura
        ) VALUES (
          ${asesoriaEmpresaId}, ${newCli.id},
          ${empresa.nombre_fiscal || empresa.nombre || null},
          ${empresa.cif || null},
          ${empresa.pais || 'ES'},
          ${empresa.provincia || null},
          ${empresa.poblacion || null},
          ${empresa.cp || null},
          ${empresa.direccion || null},
          ${clienteEmail},
          ${empresa.telefono || null}
        )
      `;

      // Actualizar secuencia
      if (codigo.startsWith("CLI-")) {
        const numPart = parseInt(codigo.split("-")[1], 10);
        if (!isNaN(numPart)) {
          await tx`
            INSERT INTO cliente_seq_180 (empresa_id, last_num)
            VALUES (${asesoriaEmpresaId}, ${numPart})
            ON CONFLICT (empresa_id) DO UPDATE
            SET last_num = GREATEST(cliente_seq_180.last_num, ${numPart})
          `;
        }
      }

      return [newCli];
    });

    return cli.id;
  } catch (err) {
    console.error("Error createClientFromVinculo:", err);
    return null;
  }
}
