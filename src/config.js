import dotenv from "dotenv";
dotenv.config();

export const config = {
  supabase: {
    url: process.env.SUPABASE_DB_URL,
  },
  port: process.env.PORT || 10000,
};
