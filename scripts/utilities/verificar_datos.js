import { sql } from './src/db.js';

(async () => {
  try {
    console.log('='.repeat(80));
    console.log('VERIFICACIÓN DE DATOS FISCALES - CLIENTES');
    console.log('='.repeat(80));
    
    // Query que muestra los clientes y sus datos fiscales
    const clientes = await sql`
      SELECT 
        c.id,
        c.nombre,
        c.razon_social as razon_social_en_clients,
        f.cliente_id,
        f.razon_social as razon_social_en_fiscal,
        f.nif_cif,
        f.iva_defecto,
        f.forma_pago,
        f.iban,
        f.persona_contacto,
        f.email_factura
      FROM clients_180 c
      LEFT JOIN client_fiscal_data_180 f ON f.cliente_id = c.id
      WHERE c.activo = true
      ORDER BY c.nombre
      LIMIT 10
    `;
    
    console.log('\nCLIENTES CON DATOS FISCALES:');
    console.log('─'.repeat(80));
    
    clientes.forEach((row, idx) => {
      console.log(`\n[${idx + 1}] ${row.nombre}`);
      console.log(`    ID: ${row.id}`);
      console.log(`    Razón Social (clients_180): ${row.razon_social_en_clients || 'NULL'}`);
      console.log(`    Razón Social (fiscal): ${row.razon_social_en_fiscal || 'NULL'}`);
      console.log(`    NIF/CIF: ${row.nif_cif || 'NULL'}`);
      console.log(`    IVA por defecto: ${row.iva_defecto || 'NULL'}`);
      console.log(`    Forma de pago: ${row.forma_pago || 'NULL'}`);
      console.log(`    IBAN: ${row.iban || 'NULL'}`);
      console.log(`    Persona contacto: ${row.persona_contacto || 'NULL'}`);
      console.log(`    Email factura: ${row.email_factura || 'NULL'}`);
      console.log(`    Fiscal record exists: ${row.cliente_id ? '✓ SÍ' : '✗ NO'}`);
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('ESTADÍSTICAS:');
    console.log('─'.repeat(80));
    
    const stats = await sql`
      SELECT 
        COUNT(DISTINCT c.id) as total_clientes,
        COUNT(DISTINCT f.cliente_id) as clientes_con_fiscal,
        SUM(CASE WHEN f.iva_defecto IS NOT NULL THEN 1 ELSE 0 END) as clientes_con_iva
      FROM clients_180 c
      LEFT JOIN client_fiscal_data_180 f ON f.cliente_id = c.id
      WHERE c.activo = true
    `;
    
    const s = stats[0];
    console.log(`Total clientes activos: ${s.total_clientes}`);
    console.log(`Clientes con registro fiscal: ${s.clientes_con_fiscal}`);
    console.log(`Clientes con IVA asignado: ${s.clientes_con_iva}`);
    
    console.log('\n' + '='.repeat(80));
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
