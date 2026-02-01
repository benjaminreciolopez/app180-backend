import { sql } from './src/db.js';

async function checkTables() {
    try {
        console.log("🔍 Checking table schemas...");

        // 1. Check clients_180 columns
        const clientsColumns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'clients_180'
    `;
        console.log("\n📋 [clients_180] Columns:");
        const clientFields = clientsColumns.map(c => c.column_name);
        console.log(clientFields.join(", "));

        // Check for missing fiscal fields
        const requiredClientFields = ['nif', 'direccion', 'poblacion', 'provincia', 'cp', 'pais', 'email'];
        const missingClientFields = requiredClientFields.filter(f => !clientFields.includes(f));

        if (missingClientFields.length > 0) {
            console.warn("⚠️ MISSING fields in clients_180:", missingClientFields);
        } else {
            console.log("✅ clients_180 has all basic fiscal fields.");
        }


        // 2. Check empresa_180 columns
        const empresaColumns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'empresa_180'
    `;
        console.log("\n🏢 [empresa_180] Columns:");
        console.log(empresaColumns.map(c => c.column_name).join(", "));


        // 3. Check emisor_180 existence and columns
        const emisorExists = await sql`
       SELECT to_regclass('emisor_180') as exists
    `;

        if (!emisorExists[0].exists) {
            console.error("\n❌ Table [emisor_180] DOES NOT EXIST.");
        } else {
            const emisorColumns = await sql`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'emisor_180'
        `;
            console.log("\n🧾 [emisor_180] Columns:");
            console.log(emisorColumns.map(c => c.column_name).join(", "));

            // Relación con empresa
            if (emisorColumns.find(c => c.column_name === 'empresa_id')) {
                console.log("✅ emisor_180 is linked to empresa_id");
            } else {
                console.error("❌ emisor_180 is missing 'empresa_id' foreign key");
            }
        }

        process.exit(0);
    } catch (err) {
        console.error("Error checking tables:", err);
        process.exit(1);
    }
}

checkTables();
