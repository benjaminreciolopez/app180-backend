-- ============================================================================
-- SCRIPT DE MIGRACIÓN: MÓDULO DE FACTURACIÓN PARA APP180
-- ============================================================================
-- Este script crea las tablas necesarias para el módulo de facturación
-- Adaptado de facturacion_app con sufijo _180
-- Reutiliza tablas existentes: empresa_180, clients_180, users_180
-- ============================================================================

-- Tabla: AUDITORIA_180
-- Registro de todas las operaciones del sistema
CREATE TABLE IF NOT EXISTS auditoria_180 (
    id SERIAL PRIMARY KEY,
    entidad VARCHAR(100) NOT NULL,                  -- Nombre de la entidad (factura, cliente, etc.)
    entidad_id INTEGER,                             -- ID de la entidad afectada
    accion VARCHAR(100) NOT NULL,                   -- CREAR, VALIDAR, ANULAR, etc.
    resultado VARCHAR(50) NOT NULL,                 -- OK, ERROR, BLOQUEADO
    motivo TEXT,                                    -- Descripción del motivo
    error_codigo VARCHAR(50),                       -- Código de error si aplica
    user_id UUID REFERENCES users_180(id),          -- Usuario que realizó la acción
    empresa_id UUID REFERENCES empresa_180(id),     -- Empresa (multi-tenant)
    origen VARCHAR(50),                             -- WEB, API, MOBILE, etc.
    ip VARCHAR(45),                                 -- Dirección IP del usuario
    user_agent TEXT,                                -- User agent del navegador
    payload JSONB,                                  -- Datos adicionales en JSON
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_auditoria_180_entidad ON auditoria_180(entidad, entidad_id);
CREATE INDEX idx_auditoria_180_user ON auditoria_180(user_id);
CREATE INDEX idx_auditoria_180_empresa ON auditoria_180(empresa_id);
CREATE INDEX idx_auditoria_180_created ON auditoria_180(created_at DESC);

-- Tabla: CONCEPTO_180
-- Maestro de conceptos facturables
CREATE TABLE IF NOT EXISTS concepto_180 (
    id SERIAL PRIMARY KEY,
    empresa_id UUID REFERENCES empresa_180(id) ON DELETE CASCADE,
    nombre VARCHAR(200) NOT NULL,
    descripcion TEXT,
    fecha_creacion TIMESTAMP DEFAULT NOW() NOT NULL,
    activo BOOLEAN DEFAULT TRUE NOT NULL
);

CREATE INDEX idx_concepto_180_empresa ON concepto_180(empresa_id);
CREATE INDEX idx_concepto_180_activo ON concepto_180(activo);

-- Tabla: IVA_180
-- Tipos de IVA aplicables
CREATE TABLE IF NOT EXISTS iva_180 (
    id SERIAL PRIMARY KEY,
    empresa_id UUID REFERENCES empresa_180(id) ON DELETE CASCADE,
    porcentaje NUMERIC(5,2) NOT NULL,               -- 21.00, 10.00, 4.00, 0.00
    descripcion VARCHAR(100),                       -- "IVA General", "IVA Reducido", etc.
    activo BOOLEAN DEFAULT TRUE NOT NULL
);

CREATE INDEX idx_iva_180_empresa ON iva_180(empresa_id);
CREATE INDEX idx_iva_180_activo ON iva_180(activo);

-- Tabla: EMISOR_180
-- Configuración del emisor de facturas por empresa
CREATE TABLE IF NOT EXISTS emisor_180 (
    id SERIAL PRIMARY KEY,
    empresa_id UUID REFERENCES empresa_180(id) ON DELETE CASCADE UNIQUE,

    -- Datos identificativos
    nombre VARCHAR(200) NOT NULL,
    nif VARCHAR(20) NOT NULL,
    direccion VARCHAR(300) NOT NULL,
    poblacion VARCHAR(100) NOT NULL,
    provincia VARCHAR(100) NOT NULL,
    cp VARCHAR(10) NOT NULL,
    pais VARCHAR(100) DEFAULT 'España' NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    email VARCHAR(100) NOT NULL,
    web VARCHAR(200),

    -- Personalización
    logo_path VARCHAR(300),                         -- Ruta al logo
    texto_pie TEXT,                                 -- Pie de página en facturas
    texto_exento TEXT,                              -- Texto para facturas exentas de IVA
    texto_rectificativa TEXT,                       -- Texto para facturas rectificativas
    mensaje_iva TEXT,                               -- Mensaje personalizado sobre IVA

    -- Firma digital
    firmar_pdf BOOLEAN DEFAULT FALSE,
    certificado_path VARCHAR(300),
    certificado_password VARCHAR(200),

    -- Configuración de numeración
    modo_numeracion VARCHAR(20) DEFAULT 'BASICO' NOT NULL,  -- BASICO, SERIE
    serie VARCHAR(10),                              -- Serie de facturación (ej: "2025-")
    serie_facturacion VARCHAR(50) DEFAULT 'GENERAL' NOT NULL,
    numeracion_plantilla VARCHAR(100) DEFAULT '{YYYY}-{NUM}' NOT NULL,
    siguiente_numero INTEGER DEFAULT 1 NOT NULL,
    ultimo_anio_numerado INTEGER,
    numeracion_bloqueada BOOLEAN DEFAULT FALSE,
    anio_numeracion_bloqueada INTEGER,

    -- Rutas de archivos
    ruta_pdf VARCHAR(300),                          -- Directorio donde guardar PDFs
    ruta_facturas VARCHAR(300),

    -- Seguridad
    seguridad_pin VARCHAR(200),                     -- Hash del PIN de seguridad
    seguridad_timeout_min INTEGER DEFAULT 30,
    seguridad_login_timeout_min INTEGER DEFAULT 120,
    auto_update BOOLEAN DEFAULT TRUE
);

-- Tabla: CONFIGURACIONSISTEMA_180
-- Configuración global de facturación por empresa
CREATE TABLE IF NOT EXISTS configuracionsistema_180 (
    id SERIAL PRIMARY KEY,
    empresa_id UUID REFERENCES empresa_180(id) ON DELETE CASCADE UNIQUE,

    -- VeriFactu (AEAT)
    verifactu_activo BOOLEAN DEFAULT FALSE,
    verifactu_modo VARCHAR(20) DEFAULT 'TEST' NOT NULL,     -- TEST, PRODUCCION
    verifactu_url VARCHAR(300),
    verifactu_ultimo_hash VARCHAR(300),
    verifactu_ultimo_envio TIMESTAMP,

    -- Certificado AEAT
    cert_aeat_path VARCHAR(300),
    cert_aeat_password VARCHAR(200),
    cert_aeat_valido BOOLEAN DEFAULT FALSE,
    cert_aeat_caduca_en TIMESTAMP,

    -- Políticas de facturación
    facturas_inmutables BOOLEAN DEFAULT TRUE NOT NULL,      -- Impedir modificación de facturas validadas
    prohibir_borrado_facturas BOOLEAN DEFAULT TRUE NOT NULL,
    bloquear_fechas_pasadas BOOLEAN DEFAULT TRUE NOT NULL,  -- No permitir facturas con fechas pasadas

    -- Auditoría
    auditoria_activa BOOLEAN DEFAULT TRUE NOT NULL,
    nivel_auditoria VARCHAR(20) DEFAULT 'BASICA' NOT NULL,  -- BASICA, DETALLADA

    -- Seguridad
    pin_habilitado BOOLEAN DEFAULT FALSE,

    -- SMTP para envío de facturas
    smtp_enabled BOOLEAN DEFAULT FALSE,
    smtp_host VARCHAR(200),
    smtp_port INTEGER DEFAULT 587,
    smtp_user VARCHAR(200),
    smtp_password VARCHAR(200),
    smtp_from VARCHAR(200),
    smtp_tls BOOLEAN DEFAULT TRUE,
    smtp_ssl BOOLEAN DEFAULT FALSE,

    creado_en TIMESTAMP DEFAULT NOW() NOT NULL,
    actualizado_en TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Tabla: FACTURA_180
-- Facturas emitidas
CREATE TABLE IF NOT EXISTS factura_180 (
    id SERIAL PRIMARY KEY,
    empresa_id UUID REFERENCES empresa_180(id) ON DELETE CASCADE NOT NULL,
    cliente_id UUID REFERENCES clients_180(id) NOT NULL,    -- Cliente de app180

    numero VARCHAR(50),                             -- Número de factura (NULL si BORRADOR)
    fecha DATE NOT NULL,

    -- Totales
    subtotal NUMERIC(12,2) DEFAULT 0.00 NOT NULL,
    iva_global NUMERIC(5,2) DEFAULT 0.00 NOT NULL,  -- % IVA aplicado globalmente
    iva_total NUMERIC(12,2) DEFAULT 0.00 NOT NULL,
    total NUMERIC(12,2) DEFAULT 0.00 NOT NULL,
    mensaje_iva TEXT,

    -- Metadata
    rectificativa BOOLEAN DEFAULT FALSE,            -- Es factura rectificativa
    ruta_pdf VARCHAR(300),                          -- Ruta al PDF generado
    estado VARCHAR(20) DEFAULT 'BORRADOR' NOT NULL, -- BORRADOR, VALIDADA, ANULADA
    fecha_validacion TIMESTAMP,

    -- Sincronización offline
    offline_id VARCHAR(100),                        -- ID temporal para sincronización

    -- VeriFactu
    serie VARCHAR(50),
    verifactu_hash VARCHAR(300),
    verifactu_fecha_generacion TIMESTAMP,

    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_factura_180_empresa ON factura_180(empresa_id);
CREATE INDEX idx_factura_180_cliente ON factura_180(cliente_id);
CREATE INDEX idx_factura_180_numero ON factura_180(numero);
CREATE INDEX idx_factura_180_fecha ON factura_180(fecha DESC);
CREATE INDEX idx_factura_180_estado ON factura_180(estado);
CREATE INDEX idx_factura_180_offline ON factura_180(offline_id);

-- Tabla: LINEAFACTURA_180
-- Líneas de detalle de facturas
CREATE TABLE IF NOT EXISTS lineafactura_180 (
    id SERIAL PRIMARY KEY,
    factura_id INTEGER REFERENCES factura_180(id) ON DELETE CASCADE NOT NULL,
    concepto_id INTEGER REFERENCES concepto_180(id) ON DELETE SET NULL,

    descripcion TEXT NOT NULL,
    cantidad NUMERIC(10,2) DEFAULT 1.00 NOT NULL,
    precio_unitario NUMERIC(12,2) NOT NULL,
    total NUMERIC(12,2) NOT NULL,                   -- cantidad * precio_unitario

    created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_lineafactura_180_factura ON lineafactura_180(factura_id);
CREATE INDEX idx_lineafactura_180_concepto ON lineafactura_180(concepto_id);

-- Tabla: REGISTROVERIFACTU_180
-- Registro de hashes VeriFactu para la AEAT
CREATE TABLE IF NOT EXISTS registroverifactu_180 (
    id SERIAL PRIMARY KEY,
    empresa_id UUID REFERENCES empresa_180(id) ON DELETE CASCADE NOT NULL,
    factura_id INTEGER REFERENCES factura_180(id) ON DELETE CASCADE NOT NULL,

    numero_factura VARCHAR(50) NOT NULL,
    fecha_factura DATE NOT NULL,
    total_factura NUMERIC(12,2) NOT NULL,

    hash_actual VARCHAR(300) NOT NULL,             -- Hash de esta factura
    hash_anterior VARCHAR(300),                    -- Hash de la factura anterior (cadena)

    fecha_registro TIMESTAMP DEFAULT NOW() NOT NULL,
    estado_envio VARCHAR(20) DEFAULT 'PENDIENTE' NOT NULL,  -- PENDIENTE, ENVIADO, ERROR
    error_envio TEXT
);

CREATE INDEX idx_registroverifactu_180_factura ON registroverifactu_180(factura_id);
CREATE INDEX idx_registroverifactu_180_empresa ON registroverifactu_180(empresa_id);
CREATE INDEX idx_registroverifactu_180_estado ON registroverifactu_180(estado_envio);

-- Tabla: ENVIOS_EMAIL_180 (nueva, no estaba en el schema original)
-- Registro de envíos de facturas por email
CREATE TABLE IF NOT EXISTS envios_email_180 (
    id SERIAL PRIMARY KEY,
    factura_id INTEGER REFERENCES factura_180(id) ON DELETE CASCADE NOT NULL,

    destinatario VARCHAR(200) NOT NULL,
    cc VARCHAR(500),                                -- Múltiples destinatarios separados por coma
    asunto VARCHAR(300) NOT NULL,
    cuerpo TEXT,

    estado VARCHAR(20) DEFAULT 'ENVIADO' NOT NULL,  -- ENVIADO, ERROR
    error TEXT,

    enviado_por UUID REFERENCES users_180(id),
    enviado_en TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_envios_email_180_factura ON envios_email_180(factura_id);
CREATE INDEX idx_envios_email_180_fecha ON envios_email_180(enviado_en DESC);

-- ============================================================================
-- FUNCIONES Y TRIGGERS
-- ============================================================================

-- Trigger para actualizar updated_at en factura_180
CREATE OR REPLACE FUNCTION update_factura_180_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_factura_180_timestamp
BEFORE UPDATE ON factura_180
FOR EACH ROW
EXECUTE FUNCTION update_factura_180_timestamp();

-- Trigger para actualizar actualizado_en en configuracionsistema_180
CREATE OR REPLACE FUNCTION update_configuracionsistema_180_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_configuracionsistema_180_timestamp
BEFORE UPDATE ON configuracionsistema_180
FOR EACH ROW
EXECUTE FUNCTION update_configuracionsistema_180_timestamp();

-- ============================================================================
-- DATOS INICIALES (SEEDS)
-- ============================================================================

-- IVAs por defecto (se crearán por empresa cuando se configure)
-- Esto se hará desde la aplicación, no aquí

-- ============================================================================
-- PERMISOS Y SEGURIDAD (SUPABASE RLS)
-- ============================================================================

-- Habilitar Row Level Security en todas las tablas
ALTER TABLE auditoria_180 ENABLE ROW LEVEL SECURITY;
ALTER TABLE concepto_180 ENABLE ROW LEVEL SECURITY;
ALTER TABLE iva_180 ENABLE ROW LEVEL SECURITY;
ALTER TABLE emisor_180 ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracionsistema_180 ENABLE ROW LEVEL SECURITY;
ALTER TABLE factura_180 ENABLE ROW LEVEL SECURITY;
ALTER TABLE lineafactura_180 ENABLE ROW LEVEL SECURITY;
ALTER TABLE registroverifactu_180 ENABLE ROW LEVEL SECURITY;
ALTER TABLE envios_email_180 ENABLE ROW LEVEL SECURITY;

-- Políticas RLS (permitir acceso solo a la empresa del usuario autenticado)
-- NOTA: Estas políticas asumen que auth.jwt() contiene el empresa_id del usuario
-- Ajustar según la implementación de autenticación de app180

-- Ejemplo de política para factura_180:
CREATE POLICY "Usuarios pueden ver facturas de su empresa"
ON factura_180 FOR SELECT
USING (empresa_id = (auth.jwt() -> 'app_metadata' ->> 'empresa_id')::uuid);

CREATE POLICY "Usuarios pueden crear facturas en su empresa"
ON factura_180 FOR INSERT
WITH CHECK (empresa_id = (auth.jwt() -> 'app_metadata' ->> 'empresa_id')::uuid);

CREATE POLICY "Usuarios pueden actualizar facturas de su empresa"
ON factura_180 FOR UPDATE
USING (empresa_id = (auth.jwt() -> 'app_metadata' ->> 'empresa_id')::uuid);

-- Aplicar políticas similares a otras tablas...
-- (Para el MVP, puedes empezar sin RLS y añadirlo después)

-- ============================================================================
-- FIN DEL SCRIPT
-- ============================================================================

COMMENT ON TABLE factura_180 IS 'Facturas emitidas - Módulo de Facturación integrado con APP180';
COMMENT ON TABLE lineafactura_180 IS 'Líneas de detalle de facturas';
COMMENT ON TABLE concepto_180 IS 'Maestro de conceptos facturables';
COMMENT ON TABLE iva_180 IS 'Tipos de IVA aplicables por empresa';
COMMENT ON TABLE emisor_180 IS 'Configuración del emisor de facturas';
COMMENT ON TABLE configuracionsistema_180 IS 'Configuración global de facturación';
COMMENT ON TABLE registroverifactu_180 IS 'Registro VeriFactu (AEAT)';
COMMENT ON TABLE auditoria_180 IS 'Auditoría de operaciones del módulo de facturación';
COMMENT ON TABLE envios_email_180 IS 'Registro de envíos de facturas por email';
