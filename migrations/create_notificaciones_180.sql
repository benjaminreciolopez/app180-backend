-- =====================================================
-- SISTEMA DE NOTIFICACIONES - APP180
-- Tabla: notificaciones_180
-- Fecha: 2026-02-23
-- =====================================================

-- 1. Crear tabla de notificaciones
CREATE TABLE IF NOT EXISTS notificaciones_180 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL,
    user_id UUID,  -- NULL = notificación para toda la empresa

    -- Contenido
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('info', 'success', 'warning', 'error', 'alert')),
    titulo VARCHAR(255) NOT NULL,
    mensaje TEXT NOT NULL,
    prioridad VARCHAR(10) DEFAULT 'normal' CHECK (prioridad IN ('baja', 'normal', 'alta', 'urgente')),

    -- Enlace opcional
    enlace TEXT,
    enlace_texto VARCHAR(100),

    -- Estado
    leida BOOLEAN DEFAULT FALSE,
    fecha_lectura TIMESTAMP,

    -- Metadata
    origen VARCHAR(50),  -- 'sistema', 'verifactu', 'facturacion', 'fiscal', etc.
    categoria VARCHAR(50),  -- 'fiscal', 'facturacion', 'sistema', 'recordatorio', etc.
    datos_extra JSONB,  -- Datos adicionales flexibles

    -- Fechas
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP,  -- Fecha de expiración (NULL = nunca expira)

    -- Constraints
    CONSTRAINT fk_notificaciones_empresa
        FOREIGN KEY (empresa_id)
        REFERENCES empresa_180(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_notificaciones_user
        FOREIGN KEY (user_id)
        REFERENCES users_180(id)
        ON DELETE CASCADE
);

-- 2. Índices para performance
CREATE INDEX idx_notificaciones_empresa ON notificaciones_180(empresa_id);
CREATE INDEX idx_notificaciones_user ON notificaciones_180(user_id);
CREATE INDEX idx_notificaciones_leida ON notificaciones_180(leida) WHERE leida = FALSE;
CREATE INDEX idx_notificaciones_tipo ON notificaciones_180(tipo);
CREATE INDEX idx_notificaciones_fecha ON notificaciones_180(created_at DESC);
CREATE INDEX idx_notificaciones_expira ON notificaciones_180(expires_at) WHERE expires_at IS NOT NULL;

-- 3. Enable RLS
ALTER TABLE notificaciones_180 ENABLE ROW LEVEL SECURITY;

-- 4. Políticas RLS

-- Admin puede ver todas las notificaciones de su empresa
CREATE POLICY notificaciones_admin_select ON notificaciones_180
    FOR SELECT
    USING (
        empresa_id IN (
            SELECT e.id FROM empresa_180 e
            INNER JOIN users_180 u ON u.id = e.user_id
            WHERE u.id = auth.uid() AND u.role = 'admin'
        )
    );

-- Empleado solo puede ver sus notificaciones y las generales de la empresa
CREATE POLICY notificaciones_empleado_select ON notificaciones_180
    FOR SELECT
    USING (
        (user_id = auth.uid() OR user_id IS NULL)
        AND empresa_id IN (
            SELECT empresa_id FROM users_180 WHERE id = auth.uid()
        )
    );

-- Admin puede crear notificaciones para su empresa
CREATE POLICY notificaciones_admin_insert ON notificaciones_180
    FOR INSERT
    WITH CHECK (
        empresa_id IN (
            SELECT e.id FROM empresa_180 e
            INNER JOIN users_180 u ON u.id = e.user_id
            WHERE u.id = auth.uid() AND u.role = 'admin'
        )
    );

-- Admin puede actualizar notificaciones de su empresa
CREATE POLICY notificaciones_admin_update ON notificaciones_180
    FOR UPDATE
    USING (
        empresa_id IN (
            SELECT e.id FROM empresa_180 e
            INNER JOIN users_180 u ON u.id = e.user_id
            WHERE u.id = auth.uid() AND u.role = 'admin'
        )
    );

-- Empleado puede marcar como leídas sus propias notificaciones
CREATE POLICY notificaciones_empleado_update ON notificaciones_180
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Admin puede eliminar notificaciones de su empresa
CREATE POLICY notificaciones_admin_delete ON notificaciones_180
    FOR DELETE
    USING (
        empresa_id IN (
            SELECT e.id FROM empresa_180 e
            INNER JOIN users_180 u ON u.id = e.user_id
            WHERE u.id = auth.uid() AND u.role = 'admin'
        )
    );

-- 5. Función para limpiar notificaciones expiradas (ejecutar diariamente)
CREATE OR REPLACE FUNCTION limpiar_notificaciones_expiradas()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM notificaciones_180
    WHERE expires_at IS NOT NULL
      AND expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 6. Función para marcar notificación como leída
CREATE OR REPLACE FUNCTION marcar_notificacion_leida(notificacion_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE notificaciones_180
    SET leida = TRUE,
        fecha_lectura = NOW()
    WHERE id = notificacion_id
      AND leida = FALSE;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- 7. Función para crear notificación del sistema
CREATE OR REPLACE FUNCTION crear_notificacion_sistema(
    p_empresa_id UUID,
    p_user_id UUID,
    p_tipo VARCHAR,
    p_titulo VARCHAR,
    p_mensaje TEXT,
    p_origen VARCHAR DEFAULT 'sistema',
    p_categoria VARCHAR DEFAULT 'sistema',
    p_prioridad VARCHAR DEFAULT 'normal',
    p_enlace TEXT DEFAULT NULL,
    p_enlace_texto VARCHAR DEFAULT NULL,
    p_expires_at TIMESTAMP DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    nueva_notificacion_id UUID;
BEGIN
    INSERT INTO notificaciones_180 (
        empresa_id, user_id, tipo, titulo, mensaje,
        origen, categoria, prioridad, enlace, enlace_texto, expires_at
    ) VALUES (
        p_empresa_id, p_user_id, p_tipo, p_titulo, p_mensaje,
        p_origen, p_categoria, p_prioridad, p_enlace, p_enlace_texto, p_expires_at
    )
    RETURNING id INTO nueva_notificacion_id;

    RETURN nueva_notificacion_id;
END;
$$ LANGUAGE plpgsql;

-- 8. Comentarios en la tabla
COMMENT ON TABLE notificaciones_180 IS 'Sistema de notificaciones para usuarios y empresas';
COMMENT ON COLUMN notificaciones_180.user_id IS 'NULL = notificación para toda la empresa';
COMMENT ON COLUMN notificaciones_180.tipo IS 'info, success, warning, error, alert';
COMMENT ON COLUMN notificaciones_180.prioridad IS 'baja, normal, alta, urgente';
COMMENT ON COLUMN notificaciones_180.origen IS 'Módulo que generó la notificación';
COMMENT ON COLUMN notificaciones_180.categoria IS 'Categoría para filtrado';
COMMENT ON COLUMN notificaciones_180.datos_extra IS 'Datos adicionales en formato JSON';
COMMENT ON COLUMN notificaciones_180.expires_at IS 'Fecha de expiración, NULL = nunca expira';

-- 9. Datos de ejemplo (OPCIONAL - comentar en producción)
/*
INSERT INTO notificaciones_180 (empresa_id, tipo, titulo, mensaje, categoria, prioridad) VALUES
(
    (SELECT id FROM empresa_180 LIMIT 1),
    'info',
    'Bienvenido a APP180',
    'Tu sistema de gestión está listo para usar. Configura tu emisor y empieza a facturar.',
    'sistema',
    'normal'
);
*/

-- =====================================================
-- FIN DE MIGRACIÓN
-- =====================================================
