import { sql } from './src/db.js';

(async () => {
  try {
    console.log('='.repeat(100));
    console.log('ANÁLISIS DE PERMISOS Y ROLES POR TABLA');
    console.log('='.repeat(100));
    
    // Obtener usuarios y sus roles
    const usuarios = await sql`
      SELECT 
        u.id,
        u.email,
        u.role,
        e.nombre as empresa,
        COUNT(DISTINCT c.id) as clientes_count,
        COUNT(DISTINCT em.id) as empleados_count
      FROM users_180 u
      LEFT JOIN empresa_180 e ON e.id = u.empresa_id
      LEFT JOIN clients_180 c ON c.empresa_id = u.empresa_id
      LEFT JOIN employees_180 em ON em.empresa_id = u.empresa_id
      GROUP BY u.id, u.email, u.role, e.nombre
      ORDER BY u.role, u.email
    `;
    
    console.log('\nUSUARIOS Y SUS ROLES:');
    console.log('─'.repeat(100));
    usuarios.forEach(u => {
      console.log(`📧 ${u.email}`);
      console.log(`   Role: ${u.role} | Empresa: ${u.empresa || 'N/A'}`);
      console.log(`   Clientes: ${u.clientes_count} | Empleados: ${u.empleados_count}`);
    });
    
    console.log('\n' + '='.repeat(100));
    console.log('ANÁLISIS DE OPERACIONES POR TABLA EN EL BACKEND:');
    console.log('─'.repeat(100));
    
    // Buscar qué rutas modifican datos (POST, PUT, DELETE)
    const tables_ops = [
      { tabla: 'clients_180', descripcion: 'Clientes' },
      { tabla: 'client_fiscal_data_180', descripcion: 'Datos Fiscales' },
      { tabla: 'employees_180', descripcion: 'Empleados' },
      { tabla: 'invoices_180', descripcion: 'Facturas' },
      { tabla: 'plantillas_jornada_180', descripcion: 'Plantillas Jornada' },
      { tabla: 'turnos_180', descripcion: 'Turnos' },
      { tabla: 'partes_dia_180', descripcion: 'Partes del Día' },
    ];
    
    console.log('\nPERMISOS ESPERADOS POR TABLA:');
    console.log('─'.repeat(100));
    
    tables_ops.forEach(t => {
      console.log(`\n📊 ${t.descripcion} (${t.tabla})`);
      console.log(`   SELECT: admin, empleado (solo su empresa)`);
      console.log(`   INSERT: admin`);
      console.log(`   UPDATE: admin, (empleado parcialmente - solo ciertos campos)`);
      console.log(`   DELETE: admin`);
    });
    
    console.log('\n' + '='.repeat(100));
    console.log('TABLAS SIN RLS Y SUS PERMISOS RECOMENDADOS:');
    console.log('─'.repeat(100));
    
    const tablas_analizar = [
      { 
        tabla: 'client_fiscal_data_180', 
        quien_crea: 'admin al crear cliente',
        quien_actualiza: 'admin',
        quien_elimina: 'admin (cascada)'
      },
      { 
        tabla: 'invoices_180', 
        quien_crea: 'admin/sistema',
        quien_actualiza: 'admin',
        quien_elimina: 'admin'
      },
      { 
        tabla: 'plantilla_bloques_180',
        quien_crea: 'admin',
        quien_actualiza: 'admin',
        quien_elimina: 'admin'
      },
      { 
        tabla: 'plantilla_dias_180',
        quien_crea: 'admin',
        quien_actualiza: 'admin',
        quien_elimina: 'admin'
      },
      { 
        tabla: 'plantilla_excepcion_bloques_180',
        quien_crea: 'admin',
        quien_actualiza: 'admin',
        quien_elimina: 'admin'
      },
      { 
        tabla: 'plantilla_excepciones_180',
        quien_crea: 'admin',
        quien_actualiza: 'admin',
        quien_elimina: 'admin'
      },
      { 
        tabla: 'calendario_importacion_180',
        quien_crea: 'admin',
        quien_actualiza: 'admin',
        quien_elimina: 'admin'
      },
      { 
        tabla: 'calendario_importacion_item_180',
        quien_crea: 'admin/sistema',
        quien_actualiza: 'admin',
        quien_elimina: 'admin'
      },
      { 
        tabla: 'purchases_180',
        quien_crea: 'admin',
        quien_actualiza: 'admin',
        quien_elimina: 'admin'
      },
      { 
        tabla: 'time_logs_180',
        quien_crea: 'admin/sistema',
        quien_actualiza: 'admin',
        quien_elimina: 'admin'
      },
      { 
        tabla: 'turno_bloques_180',
        quien_crea: 'admin',
        quien_actualiza: 'admin',
        quien_elimina: 'admin'
      },
      { 
        tabla: 'work_items_180',
        quien_crea: 'admin/sistema',
        quien_actualiza: 'admin/empleado (el suyo)',
        quien_elimina: 'admin'
      },
    ];
    
    tablas_analizar.forEach(t => {
      console.log(`\n📋 ${t.tabla}`);
      console.log(`   ├─ Crea: ${t.quien_crea}`);
      console.log(`   ├─ Actualiza: ${t.quien_actualiza}`);
      console.log(`   └─ Elimina: ${t.quien_elimina}`);
    });
    
    console.log('\n' + '='.repeat(100));
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
