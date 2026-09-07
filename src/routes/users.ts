// Routes /api/users — profils simples (Imri, Déborah...).
import type { FastifyInstance } from "fastify";
import { asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { createUserSchema } from "../lib/schemas.js";

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/users — liste tous les utilisateurs.
  app.get("/api/users", async () => {
    const rows = await db.select().from(users).orderBy(asc(users.id));
    return rows;
  });

  // POST /api/users — crée un utilisateur.
  app.post("/api/users", async (req, reply) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }
    const [created] = await db.insert(users).values({ name: parsed.data.name }).returning();
    return reply.code(201).send(created);
  });
}
