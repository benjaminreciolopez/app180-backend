-- =====================================================================
-- Migración: Consultas AEAT y Detección de Discrepancias
-- Fecha: 2026-04-11
-- Descripción: Tablas para almacenar consultas realizadas a AEAT
--              vía certificado electrónico y discrepancias detectadas
--              entre datos de la app y datos presentados en AEAT
-- =====================================================================

-- Historial de consultas realizadas a AEAT
CREATE TABLE IF NOT EXISTS aeat_consultas_180 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL,
    ejercicio INTEGER NOT NULL,
    modelo VARCHAR(10) NOT NULL,
    periodo VARCHAR(5),                          -- '1T','2T','3T','4T','0A' (anual)
    certificado_id UUID,                         -- certificado usado para la consulta
    fecha_consulta TIMESTAMPTZ DEFAULT NOW(),
    tipo_consulta VARCHAR(30) DEFAULT 'declaracion', -- 'declaracion', 'datos_fiscales', 'censo'
    datos_aeat JSONB,                            -- respuesta raw de AEAT parseada
    datos_app JSONB,                             -- snapshot de datos app al momento de consulta
    discrepancias_resumen JSONB,                 -- resumen: {total, altas, medias, bajas}
    estado VARCHAR(20) DEFAULT 'pendiente',      -- pendiente, revisado, resuelto, ignorado
    resuelto_por UUID,
    fecha_resolucion TIMESTAMPTZ,
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_aeat_consultas_empresa ON aeat_consultas_180(empresa_id);
CREATE INDEX IF NOT EXISTS idx_aeat_consultas_modelo ON aeat_consultas_180(empresa_id, modelo, ejercicio);
CREATE INDEX IF NOT EXISTS idx_aeat_consultas_estado ON aeat_consultas_180(estado);

-- Detalle de discrepancias campo a campo
CREATE TABLE IF NOT EXISTS aeat_discrepancias_180 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consulta_id UUID NOT NULL REFERENCES aeat_consultas_180(id) ON DELETE CASCADE,
    empresa_id UUID NOT NULL,
    modelo VARCHAR(10) NOT NULL,
    ejercicio INTEGER NOT NULL,
    periodo VARCHAR(5),
    casilla VARCHAR(20),                         -- nº casilla AEAT (ej: '01', '27', '69')
    campo_app VARCHAR(100),                      -- nombre campo en app (ej: 'devengado.cuota_total')
    descripcion_campo VARCHAR(200),              -- descripción legible del campo
    valor_app NUMERIC(15,2),
    valor_aeat NUMERIC(15,2),
    diferencia NUMERIC(15,2),
    porcentaje_diferencia NUMERIC(8,2),
    severidad VARCHAR(10) NOT NULL DEFAULT 'baja', -- 'alta', 'media', 'baja'
    estado VARCHAR(20) DEFAULT 'pendiente',      -- pendiente, corregido_app, corregido_aeat, ignorado
    accion_tomada VARCHAR(50),                   -- 'actualizar_app', 'rectificar_aeat', 'ignorar'
    corregido_por UUID,
    fecha_correccion TIMESTAMPTZ,
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para discrepancias
CREATE INDEX IF NOT EXISTS idx_aeat_discrepancias_consulta ON aeat_discrepancias_180(consulta_id);
CREATE INDEX IF NOT EXISTS idx_aeat_discrepancias_empresa ON aeat_discrepancias_180(empresa_id, modelo, ejercicio);
CREATE INDEX IF NOT EXISTS idx_aeat_discrepancias_severidad ON aeat_discrepancias_180(severidad, estado);

-- Mapeo de campos: casillas AEAT ↔ campos de la app por modelo
-- Tabla de referencia para el motor de discrepancias
CREATE TABLE IF NOT EXISTS aeat_campo_mapeo_180 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    modelo VARCHAR(10) NOT NULL,
    casilla VARCHAR(20) NOT NULL,                -- nº casilla AEAT
    campo_app VARCHAR(100) NOT NULL,             -- path JSON en datos_json de la app
    descripcion VARCHAR(200),                    -- descripción legible
    es_campo_clave BOOLEAN DEFAULT false,        -- campos clave tienen severidad alta si difieren
    tolerancia NUMERIC(10,2) DEFAULT 0.01,       -- tolerancia de redondeo en EUR
    UNIQUE(modelo, casilla)
);

-- Insertar mapeos conocidos para modelos principales

-- Modelo 303 - IVA Trimestral
INSERT INTO aeat_campo_mapeo_180 (modelo, casilla, campo_app, descripcion, es_campo_clave) VALUES
('303', '01', 'modelo303.devengado.por_tipo.al_4.base', 'Base imponible 4%', false),
('303', '03', 'modelo303.devengado.por_tipo.al_4.cuota', 'Cuota 4%', false),
('303', '04', 'modelo303.devengado.por_tipo.al_10.base', 'Base imponible 10%', false),
('303', '06', 'modelo303.devengado.por_tipo.al_10.cuota', 'Cuota 10%', false),
('303', '07', 'modelo303.devengado.por_tipo.al_21.base', 'Base imponible 21%', false),
('303', '09', 'modelo303.devengado.por_tipo.al_21.cuota', 'Cuota 21%', false),
('303', '27', 'modelo303.devengado.cuota', 'Total cuota devengada', true),
('303', '45', 'modelo303.deducible.cuota', 'Total a deducir', true),
('303', '69', 'modelo303.resultado', 'Resultado autoliquidación', true)
ON CONFLICT (modelo, casilla) DO NOTHING;

-- Modelo 130 - Estimación Directa
INSERT INTO aeat_campo_mapeo_180 (modelo, casilla, campo_app, descripcion, es_campo_clave) VALUES
('130', '01', 'modelo130.ingresos', 'Ingresos actividad', false),
('130', '02', 'modelo130.gastos', 'Gastos deducibles', false),
('130', '03', 'modelo130.rendimiento', 'Rendimiento neto', true),
('130', '19', 'modelo130.a_ingresar', 'Resultado a ingresar', true)
ON CONFLICT (modelo, casilla) DO NOTHING;

-- Modelo 111 - Retenciones IRPF
INSERT INTO aeat_campo_mapeo_180 (modelo, casilla, campo_app, descripcion, es_campo_clave) VALUES
('111', '01', 'modelo111.trabajo.perceptores', 'Nº perceptores trabajo', false),
('111', '02', 'modelo111.trabajo.rendimientos', 'Rendimientos trabajo', false),
('111', '03', 'modelo111.trabajo.retenciones', 'Retenciones trabajo', true),
('111', '41', 'modelo111.total_retenciones', 'Total retenciones', true)
ON CONFLICT (modelo, casilla) DO NOTHING;

-- Modelo 115 - Retenciones Arrendamientos
INSERT INTO aeat_campo_mapeo_180 (modelo, casilla, campo_app, descripcion, es_campo_clave) VALUES
('115', '01', 'modelo115.num_gastos', 'Nº perceptores', false),
('115', '02', 'modelo115.total_alquileres', 'Base retenciones', false),
('115', '03', 'modelo115.total_retenciones', 'Retenciones', true),
('115', '04', 'modelo115.a_ingresar', 'Resultado a ingresar', true)
ON CONFLICT (modelo, casilla) DO NOTHING;

-- Modelo 390 - Resumen anual IVA
INSERT INTO aeat_campo_mapeo_180 (modelo, casilla, campo_app, descripcion, es_campo_clave) VALUES
('390', '01', 'devengado.por_tipo.al_4.base', 'Base imponible 4%', false),
('390', '07', 'devengado.por_tipo.al_21.base', 'Base imponible 21%', false),
('390', '27', 'devengado.cuota_total', 'Total cuota devengada', true),
('390', '45', 'deducible.cuota_total', 'Total a deducir', true),
('390', '95', 'resultado_final', 'Resultado liquidación anual', true),
('390', '108', 'volumen_operaciones', 'Volumen total operaciones', true)
ON CONFLICT (modelo, casilla) DO NOTHING;

-- Modelo 190 - Resumen anual retenciones
INSERT INTO aeat_campo_mapeo_180 (modelo, casilla, campo_app, descripcion, es_campo_clave) VALUES
('190', 'T1_PERCEPTORES', 'total_perceptores', 'Nº total perceptores', false),
('190', 'T1_RENDIMIENTOS', 'total_rendimientos', 'Total rendimientos', true),
('190', 'T1_RETENCIONES', 'total_retenciones', 'Total retenciones', true)
ON CONFLICT (modelo, casilla) DO NOTHING;

-- Modelo 347 - Operaciones terceros
INSERT INTO aeat_campo_mapeo_180 (modelo, casilla, campo_app, descripcion, es_campo_clave) VALUES
('347', 'T1_DECLARADOS', 'total_terceros', 'Nº total declarados', false),
('347', 'T1_IMPORTE', 'importe_total', 'Importe total operaciones', true)
ON CONFLICT (modelo, casilla) DO NOTHING;
