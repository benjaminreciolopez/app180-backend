import { sql } from '../db.js';

/**
 * Genera el siguiente número de factura según la plantilla configurada
 * @param {number} empresaId - ID de la empresa
 * @param {Date|string} fecha - Fecha de la factura
 * @returns {Promise<string>} Número de factura generado
 */
export const generarNumeroFactura = async (empresaId, fecha) => {
  const fechaObj = typeof fecha === 'string' ? new Date(fecha) : fecha;
  const year = fechaObj.getFullYear();
  const month = fechaObj.getMonth() + 1;

  // Obtener emisor
  const [emisor] = await sql`
    SELECT
      siguiente_numero,
      ultimo_anio_numerado,
      numeracion_plantilla,
      serie_facturacion
    FROM emisor_180
    WHERE empresa_id = ${empresaId}
    LIMIT 1
  `;

  if (!emisor) {
    throw new Error('No hay emisor configurado para esta empresa');
  }

  // Reiniciar correlativo si cambia de año
  let correlativo = emisor.siguiente_numero || 1;
  if (emisor.ultimo_anio_numerado !== year) {
    correlativo = 1;
    await sql`
      UPDATE emisor_180
      SET siguiente_numero = 1, ultimo_anio_numerado = ${year}
      WHERE empresa_id = ${empresaId}
    `;
  }

  const plantilla = (emisor.numeracion_plantilla || '{YEAR}-{NUM:04d}').trim();

  // Procesar plantilla con formato {NUM:0Nd}
  let numero = plantilla.replace(/\{NUM:0(\d+)d\}/g, (match, width) => {
    return String(correlativo).padStart(parseInt(width), '0');
  });

  // Otros placeholders
  numero = numero.replace('{NUM}', String(correlativo));
  numero = numero.replace('{SERIE}', (emisor.serie_facturacion || '').trim());
  numero = numero.replace('{YEAR}', String(year));
  numero = numero.replace('{MONTH}', String(month).padStart(2, '0'));

  // Limpiar placeholders no resueltos
  numero = numero.replace(/\{.*?\}/g, '').trim();

  // Incrementar correlativo
  await sql`
     UPDATE emisor_180
    SET siguiente_numero = ${correlativo + 1}
    WHERE empresa_id = ${empresaId}
  `;

  return numero;
};

/**
 * Calcula subtotal, IVA y total a partir de las líneas
 * @param {Array} lineas - Array de líneas de factura
 * @param {number} ivaGlobal - Porcentaje de IVA global
 * @returns {object} Objeto con subtotal, iva_total, total
 */
export const calcularTotales = (lineas, ivaGlobal = 0) => {
  let subtotal = 0.0;

  for (const linea of lineas) {
    const base = linea.cantidad * linea.precio_unitario;
    subtotal += base;
    linea.total = base;
  }

  subtotal = Math.round(subtotal * 100) / 100;
  const ivaTotal = Math.round(subtotal * (ivaGlobal / 100) * 100) / 100;
  const total = Math.round((subtotal + ivaTotal) * 100) / 100;

  return {
    subtotal,
    iva_total: ivaTotal,
    total,
  };
};

/**
 * Valida que la fecha de la factura sea coherente con la última factura emitida
 * @param {number} empresaId - ID de la empresa
 * @param {Date|string} fecha - Fecha a validar
 * @returns {Promise<boolean>} True si la fecha es válida
 * @throws {Error} Si la fecha es anterior a la última factura validada
 */
export const validarFecha = async (empresaId, fecha) => {
  const fechaObj = typeof fecha === 'string' ? new Date(fecha) : fecha;

  const [ultima] = await sql`
    SELECT fecha, numero
    FROM factura_180
    WHERE empresa_id = ${empresaId}
      AND estado = 'VALIDADA'
    ORDER BY fecha DESC, created_at DESC
    LIMIT 1
  `;

  if (!ultima) {
    return true; // Primera factura, siempre válida
  }

  const fechaUltima = new Date(ultima.fecha);
  if (fechaObj < fechaUltima) {
    throw new Error(
      `La fecha de factura no puede ser anterior a la última factura validada (${ultima.numero} del ${fechaUltima.toLocaleDateString('es-ES')})`
    );
  }

  return true;
};

/**
 * Bloquea la numeración de un año específico (primera factura validada del año)
 * @param {number} empresaId - ID de la empresa
 * @param {number} anio - Año a bloquear
 * @returns {Promise<void>}
 */
export const bloquearNumeracion = async (empresaId, anio) => {
  const [emisor] = await sql`
    SELECT numeracion_bloqueada, anio_numeracion_bloqueada
    FROM emisor_180
    WHERE empresa_id = ${empresaId}
    LIMIT 1
  `;

  if (!emisor) {
    throw new Error('No hay emisor configurado para esta empresa');
  }

  // Si ya está bloqueado para este año, no hacer nada
  if (emisor.numeracion_bloqueada && emisor.anio_numeracion_bloqueada === anio) {
    return;
  }

  await sql`
    UPDATE emisor_180
    SET
      numeracion_bloqueada = true,
      anio_numeracion_bloqueada = ${anio}
    WHERE empresa_id = ${empresaId}
  `;
};

/**
 * Obtiene la última factura emitida de una empresa
 * @param {number} empresaId - ID de la empresa
 * @returns {Promise<object|null>} Objeto con datos de la última factura o null
 */
export const obtenerUltimaFactura = async (empresaId) => {
  const [factura] = await sql`
    SELECT
      id,
      numero,
      fecha,
      estado,
      total,
      created_at
    FROM factura_180
    WHERE empresa_id = ${empresaId}
    ORDER BY fecha DESC, created_at DESC
    LIMIT 1
  `;

  return factura || null;
};

/**
 * Genera mensaje legal para factura rectificativa
 * @param {object} factura - Datos de la factura
 * @param {object} emisor - Datos del emisor
 * @returns {string} Mensaje legal completo
 */
export const generarMensajeRectificativa = (factura, emisor) => {
  let base = (emisor.texto_rectificativa || '').trim();

  if (!base) {
    base = 'Factura rectificativa emitida conforme al Art. 89 de la Ley 37/1992 del IVA.';
  }

  const fechaFormateada = new Date(factura.fecha).toLocaleDateString('es-ES');
  const detalle = ` Esta rectificación afecta a la factura original Nº ${factura.numero} de fecha ${fechaFormateada}, dejando sin efecto sus importes.`;

  return base + detalle;
};

/**
 * Valida los datos mínimos de una factura antes de guardarla
 * @param {object} factura - Datos de la factura
 * @param {Array} lineas - Líneas de la factura
 * @throws {Error} Si faltan datos obligatorios
 */
export const validarDatosFactura = (factura, lineas = []) => {
  if (!factura.empresa_id) {
    throw new Error('La factura debe tener una empresa asociada');
  }

  if (!factura.cliente_id) {
    throw new Error('La factura debe tener un cliente asociado');
  }

  if (!factura.fecha) {
    throw new Error('La factura debe tener una fecha');
  }

  if (!lineas || lineas.length === 0) {
    throw new Error('La factura debe tener al menos una línea');
  }

  for (const linea of lineas) {
    if (!linea.descripcion || linea.descripcion.trim() === '') {
      throw new Error('Todas las líneas deben tener descripción');
    }
    if (linea.cantidad <= 0) {
      throw new Error('La cantidad debe ser mayor que 0');
    }
    if (linea.precio_unitario < 0) {
      throw new Error('El precio unitario no puede ser negativo');
    }
  }
};
