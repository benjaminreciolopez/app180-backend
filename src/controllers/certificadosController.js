/**
 * Controller: Certificados Digitales
 * Gestión de certificados .p12/.pfx para presentación telemática (AEAT, Seg. Social, etc.)
 */

import { sql } from "../db.js";
import logger from "../utils/logger.js";

// ============================================================
// GET /asesor/clientes/:empresa_id/certificados
// Lista certificados de una empresa
// ============================================================
export async function getCertificados(req, res) {
  try {
    const { empresa_id } = req.params;

    const certificados = await sql`
      SELECT c.*,
        CASE
          WHEN c.estado = 'revocado' THEN 'revocado'
          WHEN c.fecha_caducidad < NOW() THEN 'caducado'
          WHEN c.fecha_caducidad < NOW() + INTERVAL '60 days' THEN 'proximo_caducar'
          ELSE 'activo'
        END as estado_calculado,
        EXTRACT(DAY FROM c.fecha_caducidad - NOW())::int as dias_hasta_caducidad
      FROM certificados_digitales_180 c
      WHERE c.empresa_id = ${empresa_id}
        AND c.estado != 'revocado'
      ORDER BY c.fecha_caducidad ASC
    `;

    res.json(certificados);
  } catch (err) {
    logger.error("Error obteniendo certificados", { error: err.message });
    res.status(500).json({ error: "Error obteniendo certificados" });
  }
}

// ============================================================
// POST /asesor/clientes/:empresa_id/certificados
// Crear registro de certificado
// ============================================================
export async function createCertificado(req, res) {
  try {
    const { empresa_id } = req.params;
    const asesoriaId = req.user.asesoria_id;
    const {
      nombre, tipo, titular_nombre, titular_nif,
      emisor, numero_serie, fecha_emision, fecha_caducidad,
      archivo_nombre, password_hint, instalado_en, notas,
    } = req.body;

    if (!nombre || !titular_nombre || !titular_nif || !fecha_caducidad) {
      return res.status(400).json({
        error: "Campos obligatorios: nombre, titular_nombre, titular_nif, fecha_caducidad",
      });
    }

    // Calcular estado inicial
    const caducidad = new Date(fecha_caducidad);
    const now = new Date();
    const diasHasta = Math.ceil((caducidad - now) / (1000 * 60 * 60 * 24));
    let estado = "activo";
    if (diasHasta < 0) estado = "caducado";
    else if (diasHasta <= 60) estado = "proximo_caducar";

    const [certificado] = await sql`
      INSERT INTO certificados_digitales_180 (
        empresa_id, asesoria_id, nombre, tipo, titular_nombre, titular_nif,
        emisor, numero_serie, fecha_emision, fecha_caducidad,
        archivo_nombre, password_hint, instalado_en, estado, notas
      ) VALUES (
        ${empresa_id}, ${asesoriaId}, ${nombre}, ${tipo || "persona_fisica"},
        ${titular_nombre}, ${titular_nif},
        ${emisor || null}, ${numero_serie || null},
        ${fecha_emision || null}, ${fecha_caducidad},
        ${archivo_nombre || null}, ${password_hint || null},
        ${instalado_en || null}, ${estado}, ${notas || null}
      )
      RETURNING *
    `;

    // Log de instalacion
    await sql`
      INSERT INTO certificados_uso_log_180 (certificado_id, accion, detalle, usuario_id)
      VALUES (${certificado.id}, 'instalacion', 'Certificado registrado en el sistema', ${req.user.id})
    `;

    logger.info("Certificado creado", { certificadoId: certificado.id, empresaId: empresa_id });
    res.status(201).json(certificado);
  } catch (err) {
    logger.error("Error creando certificado", { error: err.message });
    res.status(500).json({ error: "Error creando certificado" });
  }
}

// ============================================================
// PUT /asesor/clientes/:empresa_id/certificados/:id
// Actualizar certificado
// ============================================================
export async function updateCertificado(req, res) {
  try {
    const { empresa_id, id } = req.params;
    const {
      nombre, tipo, titular_nombre, titular_nif,
      emisor, numero_serie, fecha_emision, fecha_caducidad,
      archivo_nombre, password_hint, instalado_en, estado, notas,
    } = req.body;

    // Verificar que existe y pertenece a la empresa
    const [existing] = await sql`
      SELECT id FROM certificados_digitales_180
      WHERE id = ${id} AND empresa_id = ${empresa_id}
    `;
    if (!existing) {
      return res.status(404).json({ error: "Certificado no encontrado" });
    }

    // Recalcular estado si se cambia fecha_caducidad
    let estadoFinal = estado;
    if (fecha_caducidad && !estado) {
      const caducidad = new Date(fecha_caducidad);
      const now = new Date();
      const diasHasta = Math.ceil((caducidad - now) / (1000 * 60 * 60 * 24));
      if (diasHasta < 0) estadoFinal = "caducado";
      else if (diasHasta <= 60) estadoFinal = "proximo_caducar";
      else estadoFinal = "activo";
    }

    const [updated] = await sql`
      UPDATE certificados_digitales_180 SET
        nombre = COALESCE(${nombre || null}, nombre),
        tipo = COALESCE(${tipo || null}, tipo),
        titular_nombre = COALESCE(${titular_nombre || null}, titular_nombre),
        titular_nif = COALESCE(${titular_nif || null}, titular_nif),
        emisor = COALESCE(${emisor !== undefined ? emisor : null}, emisor),
        numero_serie = COALESCE(${numero_serie !== undefined ? numero_serie : null}, numero_serie),
        fecha_emision = COALESCE(${fecha_emision || null}, fecha_emision),
        fecha_caducidad = COALESCE(${fecha_caducidad || null}, fecha_caducidad),
        archivo_nombre = COALESCE(${archivo_nombre !== undefined ? archivo_nombre : null}, archivo_nombre),
        password_hint = COALESCE(${password_hint !== undefined ? password_hint : null}, password_hint),
        instalado_en = COALESCE(${instalado_en || null}, instalado_en),
        estado = COALESCE(${estadoFinal || null}, estado),
        notas = COALESCE(${notas !== undefined ? notas : null}, notas),
        updated_at = now()
      WHERE id = ${id} AND empresa_id = ${empresa_id}
      RETURNING *
    `;

    res.json(updated);
  } catch (err) {
    logger.error("Error actualizando certificado", { error: err.message });
    res.status(500).json({ error: "Error actualizando certificado" });
  }
}

// ============================================================
// DELETE /asesor/clientes/:empresa_id/certificados/:id
// Soft delete: marcar como revocado
// ============================================================
export async function deleteCertificado(req, res) {
  try {
    const { empresa_id, id } = req.params;

    const [cert] = await sql`
      UPDATE certificados_digitales_180
      SET estado = 'revocado', updated_at = now()
      WHERE id = ${id} AND empresa_id = ${empresa_id}
      RETURNING id
    `;

    if (!cert) {
      return res.status(404).json({ error: "Certificado no encontrado" });
    }

    // Log de revocacion
    await sql`
      INSERT INTO certificados_uso_log_180 (certificado_id, accion, detalle, usuario_id)
      VALUES (${id}, 'revocacion', 'Certificado marcado como revocado', ${req.user.id})
    `;

    res.json({ ok: true, message: "Certificado revocado" });
  } catch (err) {
    logger.error("Error revocando certificado", { error: err.message });
    res.status(500).json({ error: "Error revocando certificado" });
  }
}

// ============================================================
// GET /asesor/certificados/proximos-caducar
// Certificados que caducan en los próximos 60 días (cross-client)
// ============================================================
export async function getCertificadosProximosCaducar(req, res) {
  try {
    const asesoriaId = req.user.asesoria_id;
    if (!asesoriaId) {
      return res.status(403).json({ error: "Asesor sin asesoría asignada" });
    }

    const dias = parseInt(req.query.dias) || 60;

    // 1. Certs from certificados_digitales_180
    const certsDigitales = await sql`
      SELECT c.id, c.empresa_id, c.nombre_alias, c.tipo, c.titular_nombre, c.titular_nif,
        c.emisor, c.numero_serie, c.fecha_emision, c.fecha_caducidad, c.estado, c.notas,
        c.created_at, c.activo, c.verificado,
        e.nombre as empresa_nombre,
        em.nif as empresa_nif,
        EXTRACT(DAY FROM c.fecha_caducidad - NOW())::int as dias_hasta_caducidad,
        CASE
          WHEN c.estado = 'revocado' THEN 'revocado'
          WHEN c.fecha_caducidad < NOW() THEN 'caducado'
          WHEN c.fecha_caducidad < NOW() + INTERVAL '60 days' THEN 'proximo_caducar'
          ELSE 'activo'
        END as estado_calculado,
        'certificados_digitales' as origen
      FROM certificados_digitales_180 c
      JOIN empresa_180 e ON e.id = c.empresa_id
      LEFT JOIN emisor_180 em ON em.empresa_id = c.empresa_id
      JOIN asesoria_clientes_180 v ON v.empresa_id = c.empresa_id
        AND v.asesoria_id = ${asesoriaId} AND v.estado = 'activo'
      WHERE (c.estado IS NULL OR c.estado != 'revocado')
        AND (c.activo IS NULL OR c.activo = true)
      ORDER BY c.fecha_caducidad ASC
    `;

    // 2. Certs from emisor_180 (uploaded in empresa mode)
    // NOTE: certificado_info is jsonb but stored as a JSON string (double-stringified),
    // so we use #>> '{}' to unwrap the string first, then cast to jsonb to access keys.
    const certsEmisor = await sql`
      SELECT
        'emisor-' || em.id::text as id,
        em.empresa_id,
        em.certificado_path as nombre_alias,
        'persona_fisica' as tipo,
        em.nombre as titular_nombre,
        em.nif as titular_nif,
        ((em.certificado_info #>> '{}')::jsonb->>'issuer') as emisor,
        ((em.certificado_info #>> '{}')::jsonb->>'serial') as numero_serie,
        ((em.certificado_info #>> '{}')::jsonb->>'validFrom')::date as fecha_emision,
        ((em.certificado_info #>> '{}')::jsonb->>'validTo')::date as fecha_caducidad,
        'activo' as estado,
        'Subido desde modo empresa' as notas,
        em.certificado_upload_date as created_at,
        true as activo,
        true as verificado,
        e.nombre as empresa_nombre,
        em.nif as empresa_nif,
        EXTRACT(DAY FROM ((em.certificado_info #>> '{}')::jsonb->>'validTo')::date - NOW())::int as dias_hasta_caducidad,
        CASE
          WHEN ((em.certificado_info #>> '{}')::jsonb->>'validTo')::date < NOW() THEN 'caducado'
          WHEN ((em.certificado_info #>> '{}')::jsonb->>'validTo')::date < NOW() + INTERVAL '60 days' THEN 'proximo_caducar'
          ELSE 'activo'
        END as estado_calculado,
        'emisor' as origen
      FROM emisor_180 em
      JOIN empresa_180 e ON e.id = em.empresa_id
      JOIN asesoria_clientes_180 v ON v.empresa_id = em.empresa_id
        AND v.asesoria_id = ${asesoriaId} AND v.estado = 'activo'
      WHERE em.certificado_data IS NOT NULL
        AND em.certificado_data != ''
        AND em.certificado_info IS NOT NULL
    `;

    // Also include asesoría's own empresa (not in asesoria_clientes_180)
    const certsEmisorPropio = await sql`
      SELECT
        'emisor-' || em.id::text as id,
        em.empresa_id,
        em.certificado_path as nombre_alias,
        'persona_fisica' as tipo,
        em.nombre as titular_nombre,
        em.nif as titular_nif,
        ((em.certificado_info #>> '{}')::jsonb->>'issuer') as emisor,
        ((em.certificado_info #>> '{}')::jsonb->>'serial') as numero_serie,
        ((em.certificado_info #>> '{}')::jsonb->>'validFrom')::date as fecha_emision,
        ((em.certificado_info #>> '{}')::jsonb->>'validTo')::date as fecha_caducidad,
        'activo' as estado,
        'Certificado propio asesoria' as notas,
        em.certificado_upload_date as created_at,
        true as activo,
        true as verificado,
        e.nombre as empresa_nombre,
        em.nif as empresa_nif,
        EXTRACT(DAY FROM ((em.certificado_info #>> '{}')::jsonb->>'validTo')::date - NOW())::int as dias_hasta_caducidad,
        CASE
          WHEN ((em.certificado_info #>> '{}')::jsonb->>'validTo')::date < NOW() THEN 'caducado'
          WHEN ((em.certificado_info #>> '{}')::jsonb->>'validTo')::date < NOW() + INTERVAL '60 days' THEN 'proximo_caducar'
          ELSE 'activo'
        END as estado_calculado,
        'emisor' as origen
      FROM emisor_180 em
      JOIN asesorias_180 a ON a.empresa_id = em.empresa_id AND a.id = ${asesoriaId}
      JOIN empresa_180 e ON e.id = em.empresa_id
      WHERE em.certificado_data IS NOT NULL
        AND em.certificado_data != ''
        AND em.certificado_info IS NOT NULL
    `;

    // Merge and deduplicate (by serial number)
    const allCerts = [...certsDigitales];
    const serials = new Set(certsDigitales.filter(c => c.numero_serie).map(c => c.numero_serie));

    for (const ec of [...certsEmisor, ...certsEmisorPropio]) {
      if (!ec.numero_serie || !serials.has(ec.numero_serie)) {
        allCerts.push(ec);
        if (ec.numero_serie) serials.add(ec.numero_serie);
      }
    }

    // Sort by fecha_caducidad
    allCerts.sort((a, b) => {
      if (!a.fecha_caducidad) return 1;
      if (!b.fecha_caducidad) return -1;
      return new Date(a.fecha_caducidad) - new Date(b.fecha_caducidad);
    });

    const proximosCaducar = allCerts.filter(c =>
      c.fecha_caducidad && c.dias_hasta_caducidad != null && c.dias_hasta_caducidad <= dias
    );

    const resumen = {
      total: allCerts.length,
      activos: allCerts.filter(c => c.estado_calculado === "activo").length,
      proximosCaducar: allCerts.filter(c => c.estado_calculado === "proximo_caducar").length,
      caducados: allCerts.filter(c => c.estado_calculado === "caducado").length,
    };

    res.json({ proximosCaducar: proximosCaducar, todos: allCerts, resumen });
  } catch (err) {
    logger.error("Error obteniendo certificados proximos a caducar", { error: err.message });
    res.status(500).json({ error: "Error obteniendo certificados" });
  }
}

// ============================================================
// POST /asesor/clientes/:empresa_id/certificados/:id/log
// Registrar uso de certificado
// ============================================================
export async function logUsoCertificado(req, res) {
  try {
    const { empresa_id, id } = req.params;
    const { accion, detalle, modelo_aeat } = req.body;

    if (!accion) {
      return res.status(400).json({ error: "Campo obligatorio: accion" });
    }

    // Verificar que el certificado pertenece a la empresa
    const [cert] = await sql`
      SELECT id FROM certificados_digitales_180
      WHERE id = ${id} AND empresa_id = ${empresa_id}
    `;
    if (!cert) {
      return res.status(404).json({ error: "Certificado no encontrado" });
    }

    const [log] = await sql`
      INSERT INTO certificados_uso_log_180 (certificado_id, accion, detalle, modelo_aeat, usuario_id)
      VALUES (${id}, ${accion}, ${detalle || null}, ${modelo_aeat || null}, ${req.user.id})
      RETURNING *
    `;

    res.status(201).json(log);
  } catch (err) {
    logger.error("Error registrando uso de certificado", { error: err.message });
    res.status(500).json({ error: "Error registrando uso" });
  }
}

// ============================================================
// GET /asesor/clientes/:empresa_id/certificados/:id/log
// Obtener log de uso de certificado
// ============================================================
export async function getUsoCertificado(req, res) {
  try {
    const { empresa_id, id } = req.params;

    // Verificar que el certificado pertenece a la empresa
    const [cert] = await sql`
      SELECT id FROM certificados_digitales_180
      WHERE id = ${id} AND empresa_id = ${empresa_id}
    `;
    if (!cert) {
      return res.status(404).json({ error: "Certificado no encontrado" });
    }

    const logs = await sql`
      SELECT l.*, u.nombre as usuario_nombre
      FROM certificados_uso_log_180 l
      LEFT JOIN users_180 u ON u.id = l.usuario_id
      WHERE l.certificado_id = ${id}
      ORDER BY l.created_at DESC
      LIMIT 100
    `;

    res.json(logs);
  } catch (err) {
    logger.error("Error obteniendo log de certificado", { error: err.message });
    res.status(500).json({ error: "Error obteniendo log" });
  }
}
