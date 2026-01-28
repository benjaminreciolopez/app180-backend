
import { sql } from '../src/db.js';

async function checkEnum() {
  try {
    const rows = await sql`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'jornada_cierre_180'
    `;
    console.log('Jornada Cierre Enum Values:', rows.map(r => r.enumlabel));
  } catch (err) {
    console.error(err);
  }
}

checkEnum();
