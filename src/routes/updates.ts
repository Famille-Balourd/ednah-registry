// Routes /updates — service de mise à jour de l'app desktop Studio (auto-update Tauri v2).
//
// Le repo GitHub étant privé, l'updater Tauri ne peut pas télécharger depuis les
// GitHub Releases (URLs 404). On sert donc les artefacts d'update directement
// depuis le VPS (registry.dev.ednah-group.com).
//
// - GET  /updates/latest.json  → manifeste updater Tauri v2 (PUBLIC, pas d'auth).
// - GET  /updates/:file        → binaire d'update, ex. Studio.app.tar.gz (PUBLIC).
// - POST /updates/upload       → dépôt des fichiers d'update (PROTÉGÉ X-Ednah-Key).
//
// IMPORTANT : les deux routes GET sont publiques (déclarées dans isPublicRoute,
// cf. server.ts) car l'updater Tauri ne s'authentifie pas. L'upload, lui, exige
// la clé X-Ednah-Key comme le reste de l'API.
//
// Les fichiers vivent dans UPDATES_DIR (défaut /data/updates), qui DOIT être un
// volume persistant en Docker/Coolify (cf. README section "Updates").
import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat, mkdir, writeFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { pipeline } from "node:stream/promises";

// Dossier persistant où sont stockés latest.json + les artefacts (.tar.gz, .sig).
export const UPDATES_DIR = process.env.UPDATES_DIR ?? "/data/updates";

// Content-Type par extension pour les fichiers servis.
function contentTypeFor(file: string): string {
  const ext = extname(file).toLowerCase();
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".gz" || ext === ".tgz") return "application/gzip";
  if (ext === ".sig") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

// Renvoie un fichier depuis UPDATES_DIR en streaming, ou 404 s'il n'existe pas.
// Le nom est passé par basename() pour éviter toute traversée de chemin (../).
async function sendUpdateFile(reply: import("fastify").FastifyReply, name: string) {
  const safeName = basename(name); // neutralise ../, chemins absolus, etc.
  const filePath = join(UPDATES_DIR, safeName);
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return reply.code(404).send({ error: "Not found" });
    reply.header("Content-Type", contentTypeFor(safeName));
    reply.header("Content-Length", info.size);
    return reply.send(createReadStream(filePath));
  } catch {
    return reply.code(404).send({ error: "Not found" });
  }
}

export async function registerUpdateRoutes(app: FastifyInstance): Promise<void> {
  // GET /updates/latest.json — manifeste updater (servi tel quel s'il existe).
  app.get("/updates/latest.json", async (_req, reply) => {
    return sendUpdateFile(reply, "latest.json");
  });

  // GET /updates/:file — sert un binaire d'update (.tar.gz) ou sa signature.
  app.get<{ Params: { file: string } }>("/updates/:file", async (req, reply) => {
    return sendUpdateFile(reply, req.params.file);
  });

  // POST /updates/upload — dépôt des fichiers d'update (PROTÉGÉ par X-Ednah-Key,
  // l'auth globale s'applique car la route n'est PAS dans isPublicRoute).
  //
  // Accepte un multipart/form-data contenant un ou plusieurs fichiers (au moins
  // latest.json + l'artefact .app.tar.gz, éventuellement le .sig). Chaque fichier
  // est écrit dans UPDATES_DIR sous son nom (basename, anti-traversée).
  app.post("/updates/upload", async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: "Expected multipart/form-data" });
    }
    await mkdir(UPDATES_DIR, { recursive: true });
    const written: string[] = [];
    for await (const part of req.parts()) {
      if (part.type !== "file") continue;
      const safeName = basename(part.filename);
      if (!safeName) {
        // On draine le flux pour ne pas bloquer l'itération.
        part.file.resume();
        continue;
      }
      await pipeline(part.file, (await import("node:fs")).createWriteStream(join(UPDATES_DIR, safeName)));
      written.push(safeName);
    }
    if (written.length === 0) {
      return reply.code(400).send({ error: "No file provided" });
    }
    return { ok: true, written };
  });
}
