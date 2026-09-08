# Studio Registry

**La source de vérité des projets de la plateforme Studio.** Petit backend Fastify
+ TypeScript + PostgreSQL (via Drizzle ORM) qui stocke la liste de tous les
projets, qui les a créés, leur état et leurs groupes.

Déployé sur le VPS via Coolify (Docker). Base de données PostgreSQL en conteneur
sur le même VPS (cf. `docs/DATABASE.md`).

---

## Stack

- Node.js 22 + Fastify 4 + TypeScript (ESM)
- Drizzle ORM + drizzle-kit (migrations versionnées) pour PostgreSQL
- Validation Zod sur toutes les entrées
- pnpm

## Démarrage local

```bash
pnpm install
cp .env.example .env          # renseigner DATABASE_URL (Postgres local ou VPS)
pnpm drizzle-kit generate     # génère les migrations depuis le schéma (déjà commitées)
pnpm drizzle-kit migrate      # applique les migrations à la DATABASE_URL
pnpm dev                      # serveur en watch (tsx)
# ou :
pnpm build && pnpm start
```

## Variables d'environnement

| Variable              | Rôle                                                                 | Défaut |
| --------------------- | -------------------------------------------------------------------- | ------ |
| `PORT`                | Port d'écoute (le serveur écoute sur `0.0.0.0`)                      | `3000` |
| `DATABASE_URL`        | Connexion Postgres (injectée par Coolify, réseau Docker interne)     | —      |
| `EDNAH_REGISTRY_KEY`  | Clé d'API partagée exigée dans `X-Ednah-Key` (sauf routes publiques) | —      |
| `STUDIO_CORS_ORIGIN`   | Origine CORS autorisée                                               | `*`    |
| `EDNAH_ACCESS_CODE`   | Code d'accès attendu par `POST /api/auth/login`. **Absent → login refusé (503)** | — |

### Variables `CLIENT_*` (config renvoyée par le bootstrap)

Renvoyées à l'app Studio par `POST /api/auth/login` **après login réussi**
(l'app ne saisit jamais ces valeurs elle-même). À configurer côté serveur (Coolify).

| Variable                     | Renvoyé comme            | Notes                                  |
| ---------------------------- | ------------------------ | -------------------------------------- |
| `CLIENT_REGISTRY_URL`        | `config.registry_url`    | URL de base du Registry                |
| `CLIENT_COOLIFY_URL`         | `config.coolify_url`     | URL de l'API Coolify                   |
| `CLIENT_COOLIFY_SERVER_UUID` | `config.coolify_server_uuid` |                                    |
| `CLIENT_DEV_DOMAIN`          | `config.dev_domain`      | ex: `dev.ednah-group.com`              |
| `CLIENT_GITHUB_APP_UUID`     | `config.github_app_uuid` |                                        |
| `CLIENT_GITHUB_OWNER`        | `config.github_owner`    |                                        |
| `CLIENT_COOLIFY_TOKEN`       | `config.coolify_token`   | **🔒 secret** — token API Coolify      |
| `CLIENT_GITHUB_TOKEN`        | `config.github_token`    | **🔒 secret** — token GitHub           |

> `config.registry_key` (= `EDNAH_REGISTRY_KEY`) est aussi renvoyé, pour que
> l'app puisse ensuite appeler les routes protégées avec le header `X-Ednah-Key`.

Si `EDNAH_REGISTRY_KEY` n'est **pas** défini : mode dev, l'auth est désactivée
(un warning est loggé). Aucun secret n'est jamais écrit en dur dans le repo.

## Authentification

Toutes les routes **sauf les routes publiques** exigent le header :

```
X-Ednah-Key: <valeur de EDNAH_REGISTRY_KEY>
```

Routes **publiques** (pas de header) : `GET /api/health` et `POST /api/auth/login`.
Une clé absente ou incorrecte renvoie `401 { "error": "Unauthorized" }`.
En mode dev (clé non définie côté serveur), aucune clé n'est requise.

### Login par code d'accès + bootstrap (app Studio)

`POST /api/auth/login` permet à l'app Studio (sur le PC de l'utilisatrice) de se
connecter avec un **code d'accès** + un **profil**, et de récupérer toute sa
config depuis le serveur : elle ne saisit jamais de clés ni de tokens.

**Sécurité :**
- Route **publique** (pas de `X-Ednah-Key`) : c'est le login qui fournit la clé à l'app.
- Si `EDNAH_ACCESS_CODE` n'est pas défini côté serveur → **`503 { "error": "login non configuré" }`** (rien ne passe).
- Code invalide → **`401`** après un petit délai (~300 ms) anti-brute-force ; la tentative
  est loggée **sans** le code.
- La réponse contient des **secrets** (`coolify_token`, `github_token`, `registry_key`) :
  c'est voulu (l'app en a besoin), mais renvoyés **uniquement** ici, **après login réussi**,
  **jamais** sur un GET et **jamais loggés**.

**Body :**
```json
{ "accessCode": "le-code-d-acces", "profile": "Imri" }
```
`profile` est optionnel (`"Imri"` | `"Déborah"`, …) ; s'il est fourni, l'utilisateur
est résolu ou créé dans la table `users`.

**Réponse `200` (bootstrap) :**
```json
{
  "ok": true,
  "config": {
    "registry_url": "https://registry.dev.ednah-group.com",
    "registry_key": "<EDNAH_REGISTRY_KEY>",
    "coolify_url": "https://coolify.ednah-group.com",
    "coolify_server_uuid": "…",
    "dev_domain": "dev.ednah-group.com",
    "github_app_uuid": "…",
    "coolify_token": "<secret>",
    "github_token": "<secret>",
    "github_owner": "ednah-group"
  },
  "user": { "id": 1, "name": "Imri" }
}
```
`user` est présent uniquement si `profile` a été fourni. Les valeurs de `config`
proviennent des variables d'env `CLIENT_*` (+ `EDNAH_REGISTRY_KEY`).

Réponses : `400` (body invalide) · `401` (code invalide) · `503` (login non configuré).

## Déploiement Coolify

- `Dockerfile` multi-stage (build tsc → runtime prod). Écoute `0.0.0.0:$PORT`.
- Au démarrage, le conteneur applique les migrations (`drizzle-kit migrate`) puis
  lance l'API (`node dist/server.js`).
- Healthcheck : `GET /api/health` → `{ "status": "ok" }`.
- Créer une ressource Database → PostgreSQL dans Coolify et injecter sa
  connection string interne dans `DATABASE_URL`. Aucun port DB exposé publiquement.

---

## Modèle de données

### `users`
| Colonne      | Type        | Notes                        |
| ------------ | ----------- | ---------------------------- |
| `id`         | serial PK   |                              |
| `name`       | text        | ex: "Imri", "Déborah"       |
| `created_at` | timestamptz | défaut `now()`               |
| `last_seen`  | timestamptz (null) | dernier heartbeat de l'app (présence) |

### `groups`
| Colonne      | Type        | Notes                        |
| ------------ | ----------- | ---------------------------- |
| `id`         | serial PK   |                              |
| `name`       | text        |                              |
| `color`      | text (null) | optionnel, ex: `#4f46e5`     |
| `created_by` | integer FK  | → `users.id`                 |
| `created_at` | timestamptz | défaut `now()`               |

### `projects`
| Colonne                    | Type          | Notes                                     |
| -------------------------- | ------------- | ----------------------------------------- |
| `id`                       | serial PK     |                                           |
| `slug`                     | text UNIQUE   | kebab-case                                |
| `name`                     | text          |                                           |
| `template`                 | text          | `web-api` \| `mobile`                     |
| `subdomain`                | text          |                                           |
| `group_id`                 | integer (null)| FK → `groups.id` (ON DELETE SET NULL)     |
| `created_by`               | integer FK    | → `users.id`                              |
| `github_owner`             | text (null)   |                                           |
| `github_repo`              | text (null)   |                                           |
| `dev_url`                  | text (null)   |                                           |
| `production_domain`        | text (null)   |                                           |
| `coolify_application_uuid` | text (null)   |                                           |
| `coolify_project_uuid`     | text (null)   |                                           |
| `status`                   | text          | `draft` \| `deployed` \| `building` \| `error` (défaut `draft`) |
| `password_protected`       | boolean       | défaut `false`                            |
| `created_at`               | timestamptz   | défaut `now()`                            |
| `updated_at`               | timestamptz   | défaut `now()`, maj à chaque PATCH        |

---

## Contrat d'API (préfixe `/api`)

Toutes les réponses sont en JSON. Erreurs : `400` (entrée invalide, `{ "error": "..." }`),
`401` (clé manquante/invalide), `404` (introuvable), `409` (slug déjà pris).

### Santé
- `GET /api/health` → `200 { "status": "ok" }` — **pas d'auth**.

### Auth
- `POST /api/auth/login` — **pas d'auth** (route publique). body `{ "accessCode": string, "profile"?: string }`
  → `200 { ok, config, user? }` (bootstrap, cf. section [Login par code d'accès](#login-par-code-dacces--bootstrap-app-studio))
  · `401` code invalide · `503` login non configuré.

### Users
- `GET /api/users` → `200 User[]`
- `POST /api/users` — body `{ "name": string }` → `201 User`

### Groups
- `GET /api/groups` → `200 Group[]`
- `POST /api/groups` — body `{ "name": string, "color"?: string, "created_by": number }` → `201 Group`
- `PATCH /api/groups/:id` — body partiel `{ "name"?: string, "color"?: string|null }` → `200 Group` (au moins un champ)
- `DELETE /api/groups/:id` → `204` (les projets liés passent `group_id = null`)

### Presence (tracker de présence)
- `POST /api/presence/heartbeat` — body `{ "userId": number }` → `200 { "ok": true }` | `404` (user introuvable).
  Met à jour `users.last_seen = now()`. L'app l'appelle régulièrement (~30 s) pour se signaler active.
- `GET /api/presence` → `200 { id, name, lastSeen, online }[]`
  (`online = last_seen != null && now - last_seen < 90 s`). Sert à afficher l'état en ligne / hors ligne des profils.

### Projects
- `GET /api/projects` — query optionnels `?search=&group_id=&created_by=&status=` → `200 Project[]`
  (triés par `created_at` décroissant ; `search` = recherche insensible à la casse sur `name` et `slug`)
- `GET /api/projects/:slug` → `200 Project` | `404`
- `POST /api/projects` — body :
  ```json
  {
    "slug": "mon-projet",
    "name": "Mon Projet",
    "template": "web-api",
    "subdomain": "mon-projet",
    "createdBy": 1,
    "groupId": 2,
    "githubOwner": "ednah-group",
    "githubRepo": "mon-projet",
    "devUrl": "https://mon-projet.dev.ednah-group.com"
  }
  ```
  Requis : `slug`, `name`, `template`, `subdomain`, `createdBy`.
  Optionnels : `groupId`, `githubOwner`, `githubRepo`, `devUrl`.
  → `201 Project` | `409` si le slug existe déjà.
- `PATCH /api/projects/:slug` — mise à jour partielle (au moins un champ) parmi :
  `name`, `groupId`, `status`, `subdomain`, `githubOwner`, `githubRepo`, `devUrl`,
  `productionDomain`, `coolifyApplicationUuid`, `coolifyProjectUuid`, `passwordProtected`.
  Les champs nullables acceptent `null`. → `200 Project` | `404`
- `DELETE /api/projects/:slug` → `204` | `404`

> **Convention de nommage** : les payloads et réponses utilisent le **camelCase**
> (`groupId`, `createdBy`, `githubOwner`, `passwordProtected`, ...). Les query
> params de `GET /api/projects` utilisent le **snake_case** (`group_id`,
> `created_by`).

### Exemples curl

```bash
KEY="votre-cle-studio"
BASE="https://registry.ednah-group.com/api"   # ou http://localhost:3000/api

# Santé (pas d'auth)
curl -s $BASE/health

# Login + bootstrap (pas d'auth) — renvoie la config client (dont des secrets)
curl -s -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"accessCode":"le-code-d-acces","profile":"Imri"}'

# Créer un utilisateur
curl -s -X POST $BASE/users \
  -H "X-Ednah-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Imri"}'

# Créer un groupe
curl -s -X POST $BASE/groups \
  -H "X-Ednah-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Clients","color":"#4f46e5","created_by":1}'

# Créer un projet
curl -s -X POST $BASE/projects \
  -H "X-Ednah-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"slug":"boulangerie","name":"Boulangerie","template":"web-api","subdomain":"boulangerie","createdBy":1}'

# Lister les projets (filtres)
curl -s "$BASE/projects?status=deployed&created_by=1" -H "X-Ednah-Key: $KEY"

# Récupérer un projet
curl -s $BASE/projects/boulangerie -H "X-Ednah-Key: $KEY"

# Mettre à jour un projet (déploiement)
curl -s -X PATCH $BASE/projects/boulangerie \
  -H "X-Ednah-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"status":"deployed","coolifyApplicationUuid":"abc123","productionDomain":"boulangerie.ednah-group.com"}'

# Supprimer un projet
curl -s -X DELETE $BASE/projects/boulangerie -H "X-Ednah-Key: $KEY"
```

---

## Migrations Drizzle

```bash
pnpm drizzle-kit generate   # régénère une migration après modif de src/db/schema.ts
pnpm drizzle-kit migrate    # applique les migrations en attente à DATABASE_URL
```

Les fichiers sont dans `drizzle/` et **commités** dans le repo. Elles sont
appliquées automatiquement au démarrage du conteneur (voir `Dockerfile`).
