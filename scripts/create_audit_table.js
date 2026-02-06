// backend/scripts/create_audit_table.js
import { sql } from '../src/db.js';

async function createAuditTable() {
  try {
    console.log('🔧 Creando tabla audit_log_180...');

    await sql`
      CREATE TABLE IF NOT EXISTS audit_log_180 (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users_180(id) ON DELETE SET NULL,
        empleado_id UUID REFERENCES employees_180(id) ON DELETE SET NULL,
        
        accion VARCHAR(100) NOT NULL,
        entidad_tipo VARCHAR(50) NOT NULL,
        entidad_id UUID,
        
        datos_anteriores JSONB,
        datos_nuevos JSONB,
        motivo TEXT,
        
        ip_address INET,
        user_agent TEXT,
        
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    console.log('✅ Tabla audit_log_180 creada');

    console.log('🔧 Creando índices...');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_empresa 
      ON audit_log_180(empresa_id, created_at DESC)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_user 
      ON audit_log_180(user_id, created_at DESC)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_empleado 
      ON audit_log_180(empleado_id, created_at DESC)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_entidad 
      ON audit_log_180(entidad_tipo, entidad_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_accion 
      ON audit_log_180(accion)
    `;

    console.log('✅ Índices creados');
    console.log('✅ Migración completada exitosamente');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error en migración:', error);
    process.exit(1);
  }
}

createAuditTable();
