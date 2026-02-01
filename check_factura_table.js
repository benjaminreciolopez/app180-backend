import { sql } from './src/db.js';

async function check() {
  try {
    console.log("Checking tables...");
    
    try {
      const r1 = await sql`select count(*) from facturas_180`;
      console.log("facturas_180 exists, count:", r1[0].count);
    } catch(e) { console.log("facturas_180 error:", e.message); }

    try {
      const r2 = await sql`select count(*) from factura_180`;
      console.log("factura_180 exists, count:", r2[0].count);
    } catch(e) { console.log("factura_180 error:", e.message); }

    try {
      const r3 = await sql`select count(*) from invoices_180`;
      console.log("invoices_180 exists, count:", r3[0].count);
    } catch(e) { console.log("invoices_180 error:", e.message); }

    try {
      const r_linea = await sql`select count(*) from lineafactura_180`;
      console.log("lineafactura_180 exists, count:", r_linea[0].count);
    } catch(e) { console.log("lineafactura_180 error:", e.message); }

    try {
      const r_verifactu = await sql`select count(*) from registroverifactu_180`;
      console.log("registroverifactu_180 exists, count:", r_verifactu[0].count);
    } catch(e) { console.log("registroverifactu_180 error:", e.message); }

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

check();
