import dotenv from "dotenv";
dotenv.config();

// Validate required environment variables
const required = ["JWT_SECRET"];
const dbUrl = process.env.SUPABASE_URL || process.env.SUPABASE_DB_URL;

if (!dbUrl) {
  console.error("FATAL: Falta SUPABASE_URL o SUPABASE_DB_URL en las variables de entorno.");
  process.exit(1);
}

for (const key of required) {
  if (!process.env[key]) {
    console.error(`FATAL: Falta la variable de entorno ${key}.`);
    process.exit(1);
  }
}

export const config = {
  supabase: {
    url: dbUrl,
  },
  jwtSecret: process.env.JWT_SECRET,
  port: process.env.PORT || 10000,
};
