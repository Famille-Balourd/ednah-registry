// Routes /api/groups — groupes personnalisés pour organiser les projets.
import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { groups } from "../db/schema.js";
import { createGroupSchema, idParamSchema, updateGroupSchema } from "../lib/schemas.js";

export async function registerGroupRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/groups — liste tous les groupes.
  app.get("/api/groups", async () => {
    return db.select().from(groups).orderBy(asc(groups.id));
  });

  // POST /api/groups — crée un groupe.
  app.post("/api/groups", async (req, reply) => {
    const parsed = createGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }
    const { name, color, createdBy } = parsed.data;
    const [created] = await db
      .insert(groups)
      .values({ name, color: color ?? null, createdBy })
      .returning();
    return reply.code(201).send(created);
  });

  // PATCH /api/groups/:id — met à jour un groupe.
  app.patch("/api/groups/:id", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Invalid id" });
    }
    const body = updateGroupSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid input" });
    }
    const [updated] = await db
      .update(groups)
      .set(body.data)
      .where(eq(groups.id, params.data.id))
      .returning();
    if (!updated) {
      return reply.code(404).send({ error: "Group not found" });
    }
    return updated;
  });

  // DELETE /api/groups/:id — supprime un groupe (les projets liés passent group_id=null).
  app.delete("/api/groups/:id", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Invalid id" });
    }
    const [deleted] = await db
      .delete(groups)
      .where(eq(groups.id, params.data.id))
      .returning();
    if (!deleted) {
      return reply.code(404).send({ error: "Group not found" });
    }
    return reply.code(204).send();
  });
}
