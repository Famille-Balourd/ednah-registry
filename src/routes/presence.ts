// Routes /api/presence — tracker de présence (en ligne / hors ligne).
// L'app envoie un heartbeat régulier ; on considère un user "en ligne" si son
// dernier heartbeat date de moins de ONLINE_WINDOW_MS.
import type { FastifyInstance } from "fastify";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { heartbeatSchema } from "../lib/schemas.js";

// Fenêtre de fraîcheur : au-delà, l'app est considérée hors ligne (90 s).
const ONLINE_WINDOW_MS = 90_000;

export async function registerPresenceRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/presence/heartbeat — marque un user comme actif (last_seen = now()).
  app.post("/api/presence/heartbeat", async (req, reply) => {
    const parsed = heartbeatSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }
    const [updated] = await db
      .update(users)
      .set({ lastSeen: sql`now()` })
      .where(eq(users.id, parsed.data.userId))
      .returning({ id: users.id });
    if (!updated) {
      return reply.code(404).send({ error: "User not found" });
    }
    return { ok: true };
  });

  // GET /api/presence — liste des users avec leur statut en ligne / hors ligne.
  app.get("/api/presence", async () => {
    const rows = await db
      .select({ id: users.id, name: users.name, lastSeen: users.lastSeen })
      .from(users)
      .orderBy(asc(users.id));
    const now = Date.now();
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      lastSeen: u.lastSeen,
      online: u.lastSeen != null && now - new Date(u.lastSeen).getTime() < ONLINE_WINDOW_MS,
    }));
  });
}
