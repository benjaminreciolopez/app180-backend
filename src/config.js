import dotenv from "dotenv";
dotenv.config();

export const config = {
  supabase: {
    url: process.env.SUPABASE_URL,
  },
  jwtSecret: process.env.JWT_SECRET,
  port: process.env.PORT || 10000,
};
