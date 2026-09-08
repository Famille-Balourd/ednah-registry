// Routes /api/projects — le catalogue central des projets Studio.
import type { FastifyInstance } from "fastify";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { projects } from "../db/schema.js";
import {
  createProjectSchema,
  listProjectsQuerySchema,
  slugParamSchema,
  updateProjectSchema,
} from "../lib/schemas.js";

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/projects — liste avec filtres optionnels (?search= ?group_id= ?created_by= ?status=).
  app.get("/api/projects", async (req, reply) => {
    const query = listProjectsQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ error: query.error.issues[0]?.message ?? "Invalid query" });
    }
    const { search, group_id, created_by, status } = query.data;

    const filters: SQL[] = [];
    if (search) {
      // Recherche insensible à la casse sur le nom et le slug.
      const searchFilter = or(
        ilike(projects.name, `%${search}%`),
        ilike(projects.slug, `%${search}%`),
      );
      if (searchFilter) filters.push(searchFilter);
    }
    if (group_id !== undefined) filters.push(eq(projects.groupId, group_id));
    if (created_by !== undefined) filters.push(eq(projects.createdBy, created_by));
    if (status !== undefined) filters.push(eq(projects.status, status));

    const where = filters.length > 0 ? and(...filters) : undefined;
    return db.select().from(projects).where(where).orderBy(desc(projects.createdAt));
  });

  // GET /api/projects/:slug — un projet par slug.
  app.get("/api/projects/:slug", async (req, reply) => {
    const params = slugParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Invalid slug" });
    }
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, params.data.slug));
    if (!project) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return project;
  });

  // POST /api/projects — crée un projet.
  app.post("/api/projects", async (req, reply) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }
    const data = parsed.data;

    // Slug unique : on refuse un doublon avec un message clair.
    const [existing] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, data.slug));
    if (existing) {
      return reply.code(409).send({ error: "Slug already exists" });
    }

    const [created] = await db
      .insert(projects)
      .values({
        slug: data.slug,
        name: data.name,
        template: data.template,
        subdomain: data.subdomain,
        groupId: data.groupId ?? null,
        createdBy: data.createdBy,
        githubOwner: data.githubOwner ?? null,
        githubRepo: data.githubRepo ?? null,
        devUrl: data.devUrl ?? null,
      })
      .returning();
    return reply.code(201).send(created);
  });

  // PATCH /api/projects/:slug — mise à jour partielle.
  app.patch("/api/projects/:slug", async (req, reply) => {
    const params = slugParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Invalid slug" });
    }
    const body = updateProjectSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid input" });
    }
    const [updated] = await db
      .update(projects)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(projects.slug, params.data.slug))
      .returning();
    if (!updated) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return updated;
  });

  // DELETE /api/projects/:slug — supprime un projet.
  app.delete("/api/projects/:slug", async (req, reply) => {
    const params = slugParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Invalid slug" });
    }
    const [deleted] = await db
      .delete(projects)
      .where(eq(projects.slug, params.data.slug))
      .returning();
    if (!deleted) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return reply.code(204).send();
  });
}
