# Ednah Registry

**La source de vérité des projets de la plateforme Ednah.** Petit backend Fastify
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
| `EDNAH_REGISTRY_KEY`  | Clé d'API partagée exigée dans `X-Ednah-Key` (sauf `/api/health`)   | —      |
| `EDNAH_CORS_ORIGIN`   | Origine CORS autorisée                                               | `*`    |

Si `EDNAH_REGISTRY_KEY` n'est **pas** défini : mode dev, l'auth est désactivée
(un warning est loggé). Aucun secret n'est jamais écrit en dur dans le repo.

## Authentification

Toutes les routes **sauf `GET /api/health`** exigent le header :

```
X-Ednah-Key: <valeur de EDNAH_REGISTRY_KEY>
```

Une clé absente ou incorrecte renvoie `401 { "error": "Unauthorized" }`.
En mode dev (clé non définie côté serveur), aucune clé n'est requise.

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

### Users
- `GET /api/users` → `200 User[]`
- `POST /api/users` — body `{ "name": string }` → `201 User`

### Groups
- `GET /api/groups` → `200 Group[]`
- `POST /api/groups` — body `{ "name": string, "color"?: string, "created_by": number }` → `201 Group`
- `PATCH /api/groups/:id` — body partiel `{ "name"?: string, "color"?: string|null }` → `200 Group` (au moins un champ)
- `DELETE /api/groups/:id` → `204` (les projets liés passent `group_id = null`)

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
KEY="votre-cle-ednah"
BASE="https://registry.ednah-group.com/api"   # ou http://localhost:3000/api

# Santé (pas d'auth)
curl -s $BASE/health

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
