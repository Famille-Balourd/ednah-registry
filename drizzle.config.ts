// Configuration drizzle-kit (génération + application des migrations).
// Lit DATABASE_URL depuis l'environnement (jamais d'identifiants en dur).
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Placeholder si non défini : drizzle-kit generate n'a pas besoin d'une vraie DB.
    url: process.env.DATABASE_URL ?? "postgres://user:password@localhost:5432/ednah_registry",
  },
} satisfies Config;
