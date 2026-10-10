/** Prints the Postgres schema the app creates on startup (useful for Supabase's SQL editor / migrations). */
import { schemaSql } from "../src/lib/db";
console.log(schemaSql("postgres"));
