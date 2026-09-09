// Point d'entrée d'Studio Registry (Fastify + Drizzle + Postgres).
// Source de vérité des projets de la plateforme Studio.
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { registerUserRoutes } from "./routes/users.js";
import { registerGroupRoutes } from "./routes/groups.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerPresenceRoutes } from "./routes/presence.js";
import { registerUpdateRoutes } from "./routes/updates.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0"; // OBLIGATOIRE pour le déploiement conteneurisé (Coolify)

const app = Fastify({
  logger: true,
  bodyLimit: 1_048_576, // 1 MB
});

// --- CORS (configurable via env, défaut *) ---
const corsOrigin = process.env.STUDIO_CORS_ORIGIN ?? "*";
await app.register(cors, { origin: corsOrigin });

// --- Multipart (upload des artefacts d'update via POST /updates/upload) ---
// Limite haute : les artefacts .app.tar.gz peuvent peser plusieurs dizaines de Mo.
await app.register(multipart, {
  limits: { fileSize: 512 * 1024 * 1024 }, // 512 Mo max par fichier
});

// --- Auth : header X-Ednah-Key sur toutes les routes SAUF /api/health ---
const registryKey = process.env.EDNAH_REGISTRY_KEY;
if (!registryKey) {
  // Mode dev : on laisse passer mais on prévient.
  app.log.warn(
    "EDNAH_REGISTRY_KEY n'est pas défini — authentification désactivée (mode dev uniquement).",
  );
}

// Routes PUBLIQUES (pas de header X-Ednah-Key). /api/auth/login est public
// car l'app ne connaît pas encore la clé : c'est justement le login qui la lui
// fournit (via le bootstrap), après validation du code d'accès.
function isPublicRoute(url: string): boolean {
  const path = url.split("?")[0] ?? "";
  if (path === "/api/health" || path === "/api/auth/login") return true;
  // Service d'update Tauri : PUBLIC en lecture (l'updater ne s'authentifie pas).
  // On n'expose PAS /updates/upload ici : il reste protégé par X-Ednah-Key.
  if (path === "/updates/latest.json") return true;
  if (path.startsWith("/updates/") && path !== "/updates/upload") return true;
  return false;
}

app.addHook("onRequest", async (req, reply) => {
  if (isPublicRoute(req.url)) return;
  if (!registryKey) return; // mode dev : pas de clé configurée
  const provided = req.headers["x-ednah-key"];
  if (provided !== registryKey) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
});

// --- Route santé obligatoire (healthcheck Coolify). Ne pas supprimer. ---
app.get("/api/health", async () => ({ status: "ok" }));

// --- Route publique : login + bootstrap de la config client ---
await registerAuthRoutes(app);

// --- Routes métier ---
await registerUserRoutes(app);
await registerGroupRoutes(app);
await registerProjectRoutes(app);
await registerPresenceRoutes(app);

// --- Service de mise à jour de l'app desktop (auto-update Tauri) ---
// GET /updates/latest.json et GET /updates/:file sont PUBLICS (cf. isPublicRoute) ;
// POST /updates/upload est protégé par X-Ednah-Key.
await registerUpdateRoutes(app);

// --- Handler d'erreur : message générique, pas de stack renvoyée au client ---
app.setErrorHandler((err, _req, reply) => {
  app.log.error(err); // stack loggée côté serveur uniquement
  const status = err.statusCode ?? 500;
  reply.code(status).send({
    error: status >= 500 ? "Internal Server Error" : err.message,
  });
});

app
  .listen({ port: PORT, host: HOST })
  .then(() => app.log.info(`Studio Registry démarré sur http://${HOST}:${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
