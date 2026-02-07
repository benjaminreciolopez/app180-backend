import { sql } from '../src/db.js';

async function verify() {
  const result = await sql`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'lineafactura_180'
    AND column_name = 'iva_percent'
  `;

  if (result.length > 0) {
    console.log('✅ Columna iva_percent existe:');
    console.log(result[0]);
  } else {
    console.log('❌ Columna iva_percent NO existe');
  }

  process.exit(0);
}

verify();
