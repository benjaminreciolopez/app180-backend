import dotenv from "dotenv";
dotenv.config();

export const config = {
  supabase: {
    url: process.env.SUPABASE_DB_URL,
  },
  jwtSecret: process.env.JWT_SECRET, // 👈 ESTO FALTA
  port: process.env.PORT || 10000,
};
