# Docker Deployment — wacrm

This guide covers containerized deployment of the wacrm CRM application using
Docker and docker-compose.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Docker Compose](https://docs.docker.com/compose/install/) v2+
- A Supabase project (hosted or self-hosted) — see [Environment Variables](#environment-variables)

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/ArnasDon/wacrm.git
cd wacrm
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```bash
cp .env.local.example .env
```

Edit `.env` and set at minimum the **required** variables:

| Variable                       | Description                                          |
|--------------------------------|------------------------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`     | Your Supabase project URL                            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`| Supabase anonymous (public) key                      |
| `SUPABASE_SERVICE_ROLE_KEY`    | Supabase service-role key (bypasses RLS)             |
| `ENCRYPTION_KEY`               | 64-char hex string for AES-256-GCM token encryption  |
| `META_APP_SECRET`              | Meta App Secret for WhatsApp webhook verification    |

Generate an encryption key if you don't have one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Start the application

```bash
docker compose up -d
```

The app will be available at **[http://localhost:3000](http://localhost:3000)**.

To follow the logs:

```bash
docker compose logs -f app
```

### 4. Run database migrations

If you are using Supabase migrations (via `supabase/migrations/`), apply them
after the services are running:

```bash
# Using the Supabase CLI (requires: npm install -g supabase)
supabase link --project-ref <your-project-ref>
supabase db push

# Or connect directly to your database and run migration SQL files
# psql "$SUPABASE_DB_CONNECTION_STRING" -f supabase/migrations/<migration>.sql
```

> The app container does not run migrations automatically — they must be
> applied out-of-band via the Supabase CLI or your database admin tool.

---

## Environment Variables

### Required

| Variable                       | Required | Description                                                                                     |
|--------------------------------|----------|-------------------------------------------------------------------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`     | Yes      | Your Supabase project URL (e.g. `https://xxxx.supabase.co`)                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`| Yes      | Supabase anonymous (public) key                                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`    | Yes      | Service-role key for server-side operations (bypasses RLS). Keep this secret.                   |
| `ENCRYPTION_KEY`               | Yes      | 64 hex chars (32 bytes). Used for AES-256-GCM encryption of WhatsApp tokens.                   |
| `META_APP_SECRET`              | Yes      | Meta App Secret. Verifies HMAC-SHA256 signatures on inbound webhooks.                           |

### Recommended

| Variable                    | Default            | Description                                                                    |
|-----------------------------|--------------------|--------------------------------------------------------------------------------|
| `NEXT_PUBLIC_SITE_URL`      | `http://localhost:3000` | Canonical public URL of this deployment (no trailing slash).              |

### Optional

| Variable                     | Description                                                                                  |
|------------------------------|----------------------------------------------------------------------------------------------|
| `AUTOMATION_CRON_SECRET`     | Secret for the automation cron endpoint. Required if using Wait steps in automations.        |
| `META_APP_ID`                | Meta App ID. Required for creating message templates with IMAGE headers.                     |
| `ALLOWED_INVITE_HOSTS`       | Comma-separated hostname allow-list for invite URLs. See `.env.local.example` for details.   |
| `WHATSAPP_TEMPLATES_DRY_RUN` | Set to `true` to skip Meta API calls for template submission (local/CI development).         |
| `POSTGRES_PASSWORD`          | Password for the local PostgreSQL dev database (default: `postgres`).                        |

---

## Building and Running

### Build the image

```bash
docker compose build
```

### Start services

```bash
# Start all services (app + optional db)
docker compose up -d

# Start only the app (when using a remote Supabase project)
docker compose up -d app
```

### Stop services

```bash
docker compose down
```

### Rebuild after code changes

```bash
docker compose build --no-cache app
docker compose up -d
```

### View logs

```bash
# App logs
docker compose logs -f app

# Database logs
docker compose logs -f db
```

---

## Database Migrations

wacrm uses Supabase for its database layer. Migrations are stored in
`supabase/migrations/`. Apply them via one of these methods:

### Option A: Supabase CLI (recommended)

```bash
# Install the CLI
npm install -g supabase

# Link to your project
supabase link --project-ref <your-project-ref>

# Push migrations
supabase db push
```

### Option B: Direct SQL

If you have the database connection string, run migration files directly:

```bash
psql "$SUPABASE_DB_CONNECTION_STRING" -f supabase/migrations/YYYYMMDDHHMMSS_migration_name.sql
```

### Option C: Self-hosted Supabase

For a fully self-hosted setup including the Supabase backend (auth, Realtime,
Storage, API gateway), follow the official guide:

- https://github.com/supabase/supabase/tree/master/docker
- https://supabase.com/docs/guides/hosting/overview

Then point wacrm's Supabase URL/keys to your self-hosted instance.

---

## Production Deployment Tips

### 1. Use a reverse proxy

Place a reverse proxy (Caddy, Nginx, or Traefik) in front of the app for:

- **TLS termination** (the app itself serves HTTP on port 3000)
- **Rate limiting**
- **Request logging**

Example Caddyfile:

```caddy
crm.example.com {
    reverse_proxy app:3000
}
```

### 2. Set a strong ENCRYPTION_KEY

Generate a cryptographically random key per deployment:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Rotating this key will orphan all previously encrypted WhatsApp tokens — users
would need to re-save their WhatsApp settings.

### 3. Use Docker secrets (Swarm) or a secret manager

For production, avoid passing secrets via environment variables in plain text.
Instead, use Docker secrets or an external secrets manager:

```yaml
# docker-compose.yml (Docker Swarm mode)
secrets:
  supabase_service_key:
    file: ./secrets/supabase_service_key.txt

services:
  app:
    secrets:
      - supabase_service_key
```

### 4. Health checks

The docker-compose file includes a health check that pings `/api/health`
(you may need to create this endpoint if it doesn't exist). Configure your
orchestrator to restart unhealthy containers.

### 5. Resource limits

Set memory and CPU limits in docker-compose to prevent resource exhaustion:

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: "1"
          memory: "512M"
```

### 6. Persist logs

Configure Docker's logging driver for production:

```yaml
services:
  app:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 7. Keep Node.js updated

Pin the Dockerfile's base image to a specific Node.js LTS version and update
it regularly for security patches.

---

## Architecture

```
                    ┌─────────────┐
                    │   Browser   │
                    └──────┬──────┘
                           │ :443
                    ┌──────▼──────┐
                    │   Reverse   │
                    │   Proxy     │
                    │  (Caddy/    │
                    │   Nginx)    │
                    └──────┬──────┘
                           │ :3000
                    ┌──────▼──────┐
                    │   wacrm     │
                    │   (Node.js) │
                    └──────┬──────┘
                           │ Supabase SDK
                    ┌──────▼──────┐
                    │  Supabase   │—— PostgreSQL
                    │  (hosted    │—— GoTrue (Auth)
                    │   or self-  │—— Realtime
                    │   hosted)   │—— Storage
                    └─────────────┘
```

The wacrm container connects to a Supabase project over the network. It does
**not** bundle or run the Supabase backend itself — that remains a separate
service, either hosted at supabase.com or self-hosted via supabase/docker.

---

## Troubleshooting

| Problem                          | Likely Cause                               | Solution                                        |
|----------------------------------|--------------------------------------------|-------------------------------------------------|
| App won't start                  | Missing required env vars                  | Check `docker compose config` for empty vars    |
| Auth not working                 | Wrong Supabase URL or anon key             | Verify `NEXT_PUBLIC_SUPABASE_URL` and key       |
| WhatsApp webhook returns 401     | `META_APP_SECRET` mismatch                 | Ensure it matches the Meta App Dashboard        |
| Build fails with TypeScript error| TypeScript errors in source                | Run `npm run typecheck` locally first           |
| Container exits immediately      | Port conflict on :3000                     | Change host port: `ports: ["3001:3000"]`        |
| Database connection refused      | Supabase project not accessible            | Check network/firewall rules                    |

---

## See Also

- [README.md](README.md) — project overview
- [CONTRIBUTING.md](CONTRIBUTING.md) — development guide
- [Supabase Docker](https://github.com/supabase/supabase/tree/master/docker) — self-hosted Supabase
- [Supabase CLI](https://supabase.com/docs/guides/cli) — database migrations
