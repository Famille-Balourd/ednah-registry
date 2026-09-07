// Schémas Zod : valident toutes les entrées externes (body, params, query).
// Le client n'est jamais de confiance (cf. SECURITY.md).
import { z } from "zod";

// --- Valeurs contrôlées ---
export const templateEnum = z.enum(["web-api", "mobile"]);
export const statusEnum = z.enum(["draft", "deployed", "building", "error"]);

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // kebab-case

// --- Users ---
export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

// --- Groups ---
export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().min(1).max(32).optional(),
  createdBy: z.number().int().positive(),
});

export const updateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    color: z.string().trim().min(1).max(32).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

// --- Projects ---
export const createProjectSchema = z.object({
  slug: z.string().trim().regex(slugRegex, "Invalid slug (kebab-case expected)").max(80),
  name: z.string().trim().min(1).max(120),
  template: templateEnum,
  subdomain: z.string().trim().min(1).max(120),
  groupId: z.number().int().positive().nullable().optional(),
  createdBy: z.number().int().positive(),
  githubOwner: z.string().trim().min(1).max(120).optional(),
  githubRepo: z.string().trim().min(1).max(120).optional(),
  devUrl: z.string().trim().url().max(300).optional(),
});

// Mise à jour partielle : tous les champs optionnels, au moins un requis.
export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    groupId: z.number().int().positive().nullable().optional(),
    status: statusEnum.optional(),
    subdomain: z.string().trim().min(1).max(120).optional(),
    githubOwner: z.string().trim().min(1).max(120).nullable().optional(),
    githubRepo: z.string().trim().min(1).max(120).nullable().optional(),
    devUrl: z.string().trim().url().max(300).nullable().optional(),
    productionDomain: z.string().trim().min(1).max(200).nullable().optional(),
    coolifyApplicationUuid: z.string().trim().min(1).max(120).nullable().optional(),
    coolifyProjectUuid: z.string().trim().min(1).max(120).nullable().optional(),
    passwordProtected: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

// Query optionnels pour GET /api/projects.
export const listProjectsQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  group_id: z.coerce.number().int().positive().optional(),
  created_by: z.coerce.number().int().positive().optional(),
  status: statusEnum.optional(),
});

// --- Params ---
export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const slugParamSchema = z.object({
  slug: z.string().trim().regex(slugRegex, "Invalid slug").max(80),
});
