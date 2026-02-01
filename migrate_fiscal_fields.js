import { sql } from './src/db.js';

async function updateSchema() {
    try {
        console.log("🚀 Starting database schema update...");

        // 1. ADD COLUMNS TO clients_180
        // Usamos IF NOT EXISTS para cada campo para no romper si ya existen
        await sql`
      DO $$ 
      BEGIN 
        BEGIN
          ALTER TABLE clients_180 ADD COLUMN nif TEXT;
        EXCEPTION
          WHEN duplicate_column THEN RAISE NOTICE 'column nif already exists in clients_180.';
        END;

        BEGIN
            ALTER TABLE clients_180 ADD COLUMN poblacion TEXT;
        EXCEPTION
            WHEN duplicate_column THEN RAISE NOTICE 'column poblacion already exists in clients_180.';
        END;

        BEGIN
            ALTER TABLE clients_180 ADD COLUMN provincia TEXT;
        EXCEPTION
            WHEN duplicate_column THEN RAISE NOTICE 'column provincia already exists in clients_180.';
        END;

        BEGIN
            ALTER TABLE clients_180 ADD COLUMN cp TEXT;
        EXCEPTION
            WHEN duplicate_column THEN RAISE NOTICE 'column cp already exists in clients_180.';
        END;

        BEGIN
            ALTER TABLE clients_180 ADD COLUMN pais TEXT DEFAULT 'España';
        EXCEPTION
            WHEN duplicate_column THEN RAISE NOTICE 'column pais already exists in clients_180.';
        END;

        BEGIN
            ALTER TABLE clients_180 ADD COLUMN email TEXT;
        EXCEPTION
            WHEN duplicate_column THEN RAISE NOTICE 'column email already exists in clients_180.';
        END;
      END $$;
    `;
        console.log("✅ clients_180 schema updated successfully.");

        // 2. CREATE (IF NOT EXISTS) emisor_180 linked to empresa_180
        // Ya que detectamos que existe, vamos a verificar que tenga empresa_id
        // Si no existiera, aquí pondríamos el CREATE TABLE.
        // Como existe, solo logueamos. Si hubiese que añadir campos, se haría igual que arriba.

        console.log("🎉 Database schema update complete!");
        process.exit(0);

    } catch (err) {
        console.error("❌ Error updating schema:", err);
        process.exit(1);
    }
}

updateSchema();
