// Schéma Drizzle (PostgreSQL) — source de vérité des projets de la plateforme Studio.
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// --- users : profils simples (ex: "Imri", "Déborah"), pas de mot de passe pour l'instant ---
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // Dernière activité connue (heartbeat de l'app). Nullable : null = jamais vu.
  lastSeen: timestamp("last_seen", { withTimezone: true }),
});

// --- groups : groupes personnalisés pour organiser les projets ---
export const groups = pgTable("groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color"), // optionnel (ex: "#4f46e5")
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- projects : le catalogue central des projets Studio ---
export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    template: text("template").notNull(), // web-api | mobile
    subdomain: text("subdomain").notNull(),
    groupId: integer("group_id").references(() => groups.id, { onDelete: "set null" }),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    githubOwner: text("github_owner"),
    githubRepo: text("github_repo"),
    devUrl: text("dev_url"),
    productionDomain: text("production_domain"),
    coolifyApplicationUuid: text("coolify_application_uuid"),
    coolifyProjectUuid: text("coolify_project_uuid"),
    status: text("status").notNull().default("draft"), // draft | deployed | building | error
    passwordProtected: boolean("password_protected").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: index("projects_slug_idx").on(table.slug),
    groupIdx: index("projects_group_idx").on(table.groupId),
    createdByIdx: index("projects_created_by_idx").on(table.createdBy),
    statusIdx: index("projects_status_idx").on(table.status),
  }),
);

// Types dérivés, réutilisables dans les routes.
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
