// Point d'entrée d'Ednah Registry (Fastify + Drizzle + Postgres).
// Source de vérité des projets de la plateforme Ednah.
import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerUserRoutes } from "./routes/users.js";
import { registerGroupRoutes } from "./routes/groups.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerAuthRoutes } from "./routes/auth.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0"; // OBLIGATOIRE pour le déploiement conteneurisé (Coolify)

const app = Fastify({
  logger: true,
  bodyLimit: 1_048_576, // 1 MB
});

// --- CORS (configurable via env, défaut *) ---
const corsOrigin = process.env.EDNAH_CORS_ORIGIN ?? "*";
await app.register(cors, { origin: corsOrigin });

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
  const path = url.split("?")[0];
  return path === "/api/health" || path === "/api/auth/login";
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
  .then(() => app.log.info(`Ednah Registry démarré sur http://${HOST}:${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
