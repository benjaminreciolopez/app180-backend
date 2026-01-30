import { sql } from "../src/db.js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

/**
 * Migration: Create empresa_email_config_180 table
 * Purpose: Store email configuration for each empresa (OAuth2 or SMTP)
 */

async function migrate() {
  try {
    console.log("🔄 Creating empresa_email_config_180 table...");

    await sql`
      CREATE TABLE IF NOT EXISTS empresa_email_config_180 (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresa_180(id) ON DELETE CASCADE,
        
        -- Email sending mode
        modo VARCHAR(20) DEFAULT 'disabled' CHECK (modo IN ('disabled', 'oauth2', 'smtp')),
        
        -- OAuth2 configuration (Gmail/Outlook)
        oauth2_provider VARCHAR(20) CHECK (oauth2_provider IN ('gmail', 'outlook')),
        oauth2_email VARCHAR(255),
        oauth2_refresh_token TEXT, -- Encrypted
        oauth2_connected_at TIMESTAMP,
        
        -- SMTP configuration (optional, for other providers)
        smtp_host VARCHAR(255),
        smtp_port INTEGER,
        smtp_user VARCHAR(255),
        smtp_password TEXT, -- Encrypted
        smtp_secure BOOLEAN DEFAULT true,
        
        -- Common configuration
        from_name VARCHAR(255), -- Display name in emails
        from_email VARCHAR(255),
        
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        UNIQUE(empresa_id)
      )
    `;

    console.log("✅ Table empresa_email_config_180 created successfully");

    // Create index for faster lookups
    await sql`
      CREATE INDEX IF NOT EXISTS idx_empresa_email_config_empresa_id 
      ON empresa_email_config_180(empresa_id)
    `;

    console.log("✅ Index created successfully");

    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

migrate();
