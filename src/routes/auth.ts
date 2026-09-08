// Routes /api/auth — login par code d'accès + bootstrap de la config client.
//
// But : l'app Studio (sur le PC de l'utilisatrice) se connecte avec un code
// d'accès + un profil, et récupère TOUTE sa config depuis le serveur. Elle ne
// saisit jamais de clés ni de tokens ; ils vivent uniquement dans les variables
// d'environnement du Registry (injectées par Coolify).
//
// ⚠️ SÉCURITÉ — À LIRE :
//   La réponse bootstrap contient des SECRETS sensibles (coolify_token,
//   github_token, registry_key). C'est VOULU : l'app en a besoin pour appeler
//   Coolify, GitHub et les autres routes du Registry. MAIS ces secrets ne sont
//   renvoyés QUE :
//     - via POST /api/auth/login (jamais sur un GET, jamais sans body),
//     - APRÈS une validation réussie du code d'accès,
//   et ne sont JAMAIS écrits dans les logs (on ne logge ni le code, ni la config).
//   Ne pas exposer ces valeurs ailleurs. Ne pas ajouter de GET équivalent.
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { loginSchema } from "../lib/schemas.js";

// Petit délai anti-brute-force : ralentit chaque tentative échouée.
const FAILED_LOGIN_DELAY_MS = 300;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/auth/login — route PUBLIQUE (exemptée du header X-Ednah-Key,
  // cf. hook d'auth dans server.ts).
  app.post("/api/auth/login", async (req, reply) => {
    // 1) Valider le body (Zod).
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    }
    const { accessCode, profile } = parsed.data;

    // 2) Le login doit être configuré côté serveur. Si EDNAH_ACCESS_CODE est
    //    absent, on REFUSE tout (503) — on ne laisse jamais passer par défaut.
    const expectedCode = process.env.EDNAH_ACCESS_CODE;
    if (!expectedCode) {
      app.log.error(
        "EDNAH_ACCESS_CODE n'est pas défini — login non configuré, toute tentative est refusée.",
      );
      return reply.code(503).send({ error: "login non configuré" });
    }

    // 3) Valider le code d'accès. En cas d'échec : petit délai + log SANS le code.
    if (accessCode !== expectedCode) {
      app.log.warn(
        { ip: req.ip, profile: profile ?? null },
        "Tentative de login échouée (code d'accès invalide).",
      );
      await sleep(FAILED_LOGIN_DELAY_MS); // ralentit le brute force
      return reply.code(401).send({ error: "Code d'accès invalide" });
    }

    // 4) Résoudre/créer le user si un profil est fourni.
    let user: { id: number; name: string } | undefined;
    if (profile) {
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.name, profile))
        .limit(1);
      if (existing) {
        user = { id: existing.id, name: existing.name };
      } else {
        const [created] = await db
          .insert(users)
          .values({ name: profile })
          .returning();
        if (created) user = { id: created.id, name: created.name };
      }
    }

    // 5) Construire le bootstrap depuis les variables d'env du Registry.
    //    ⚠️ Contient des secrets — voir l'avertissement en tête de fichier.
    const config = {
      registry_url: process.env.CLIENT_REGISTRY_URL ?? "",
      registry_key: process.env.EDNAH_REGISTRY_KEY ?? "",
      coolify_url: process.env.CLIENT_COOLIFY_URL ?? "",
      coolify_server_uuid: process.env.CLIENT_COOLIFY_SERVER_UUID ?? "",
      dev_domain: process.env.CLIENT_DEV_DOMAIN ?? "",
      github_app_uuid: process.env.CLIENT_GITHUB_APP_UUID ?? "",
      // Secrets sensibles — renvoyés UNIQUEMENT ici, après login réussi :
      coolify_token: process.env.CLIENT_COOLIFY_TOKEN ?? "",
      github_token: process.env.CLIENT_GITHUB_TOKEN ?? "",
      github_owner: process.env.CLIENT_GITHUB_OWNER ?? "",
    };

    // On ne logge PAS la config (secrets). Juste le succès.
    app.log.info(
      { profile: profile ?? null, userId: user?.id ?? null },
      "Login réussi, bootstrap envoyé.",
    );

    return reply.code(200).send({ ok: true, config, user });
  });
}
