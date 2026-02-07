-- Migración para el módulo de Trabajos
-- 1. Añadir columna detalles a work_logs_180
ALTER TABLE work_logs_180 ADD COLUMN IF NOT EXISTS detalles TEXT;

-- 2. Crear tabla de plantillas de trabajo
CREATE TABLE IF NOT EXISTS work_log_templates_180 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL,
    descripcion TEXT NOT NULL,
    detalles TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_work_log_templates_empresa ON work_log_templates_180(empresa_id);
