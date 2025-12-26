# AzureGates - AI Agent Instructions

## Project Overview

AzureGates is a self-hosted garage gate control system designed to run on a Raspberry Pi. It provides a web interface for controlling physical gates via GPIO-connected relays, with full authentication, guest access via magic links, and audit logging. The system is built as a set of Docker containers orchestrated with Docker Compose, plus a Python GPIO service that runs directly on the Pi host.

This is a **public repository**, so never commit secrets, API keys, or credentials to git. All sensitive values go in `.env` (which is gitignored).

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐
│  Caddy (proxy)  │────▶│   Frontend SPA  │  React + Vite + Tailwind
│    ports 80/443 │     │   (nginx)       │
└────────┬────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Backend (Fastify)│────▶│  GPIO Service   │  Python on Pi host (port 5000)
│  TypeScript     │     │  (RPi.GPIO)     │
└────────┬────────┘     └─────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐ ┌───────────┐
│ Redis │ │Postgres│ │ Authentik │  Self-hosted OIDC IdP
└───────┘ └───────┘ └───────────┘
```

The frontend is a React SPA served by nginx. The backend is a Fastify (Node.js/TypeScript) API that handles authentication, gate commands, and configuration. Caddy acts as a reverse proxy, terminating TLS and routing requests. Authentik provides OIDC authentication. The GPIO service is a simple Python HTTP server that runs on the Pi host (not in Docker) and controls the physical relay pins.

### Key Data Flow
1. **Config source of truth**: Gate definitions live in [config/gates.yaml](../config/gates.yaml). On backend startup, this file is validated against the JSON schema and synced to PostgreSQL.
2. **GPIO control**: When a user triggers a gate command, the backend calls the GPIO service via HTTP at `http://172.17.0.1:5000` (Docker's host gateway). The Python service uses RPi.GPIO to pulse the appropriate pins.
3. **Auth**: Users authenticate via Authentik OIDC (accessible on port 9443). Sessions are stored in Redis. Guests can access gates via time-limited magic link tokens without needing an Authentik account.

## Project Structure

| Directory | Purpose |
|-----------|---------|
| `backend/` | Fastify TypeScript API. Entry point is `src/main.ts`. Routes are in `src/api/`, drivers in `src/drivers/`, auth in `src/auth/`. |
| `frontend/` | React SPA with Vite. Components in `src/components/`, pages in `src/pages/`, API client in `src/lib/api.ts`. |
| `config/` | Gate configuration YAML and JSON schema. The `history/` subfolder stores config backups. |
| `proxy/` | Caddyfile for the reverse proxy. Handles both local HTTPS and Cloudflare tunnel access. |
| `scripts/` | Helper scripts including `gpio_service.py` which runs on the Pi host. |
| `docs/` | Setup guides including Authentik configuration. |

## Package Manager

**Always use `bun` instead of `npm` or `yarn`.** Bun is the standard package manager for this project due to its speed and compatibility.

```bash
# Installing dependencies
bun install

# Running scripts
bun run dev
bun run build

# Running binaries (like prisma)
bunx prisma generate
bunx prisma db push
```

Never use `npm install`, `npm run`, or `npx` - always use the bun equivalents.

## Version Management

Version numbers are managed in two source-of-truth files:
- **Frontend**: `frontend/src/lib/constants.ts` (APP_VERSION)
- **Backend**: `backend/src/version.ts` (BACKEND_VERSION)

The service worker version file (`frontend/public/version.js`) is auto-generated from constants.ts during build.

### Version Bump Workflow

Versions are only bumped when explicitly requested via the VERSION_BUMP environment variable:

```bash
# Build WITHOUT version bump (default)
cd frontend && bun run build
cd backend && bun run build

# Build WITH version bump
cd frontend && bun run build:bump
cd backend && bun run build:bump
```

The `build:bump` script sets `VERSION_BUMP=1` and increments the patch version automatically.

### Recommended Release Flow

1. Make changes locally and test with `bun run dev`
2. When ready to release, bump versions locally:
   ```bash
   cd frontend && bun run build:bump
   cd backend && bun run build:bump
   ```
3. Commit the version changes: `git add -A && git commit -m "vX.Y.Z: Description" && git push`
4. Deploy to Pi (builds without bumping again):
   ```bash
   /usr/bin/ssh pi@garagepi.local "cd /opt/gates && git pull && docker compose up -d --build"
   ```

The Pi build uses `bun run build` (not `build:bump`), so it keeps the version you set locally.

## Development Workflow

### Raspberry Pi Deployment

The production Raspberry Pi is accessible at `garagepi.local` with username `pi`. The code lives at `/opt/gates` on the Pi. When SSHing to the Pi, use the full path `/usr/bin/ssh` to avoid any shell aliases:

```bash
# SSH to the Pi
/usr/bin/ssh pi@garagepi.local

# Navigate to the project
cd /opt/gates

# Pull latest changes and rebuild
git pull
docker compose down
docker compose up -d --build
```

**Always build on the Pi** rather than pulling pre-built images from a registry. The Pi's network connection is slow, so building locally is faster than downloading large images. The `docker compose up -d --build` command will build the backend and frontend images directly on the Pi.

### Testing Changes

To deploy and test changes on the Pi:

```bash
# From your local machine - push changes to git
git add -A && git commit -m "Your changes" && git push

# SSH to Pi and deploy
/usr/bin/ssh pi@garagepi.local "cd /opt/gates && git pull && docker compose up -d --build"

# View logs
/usr/bin/ssh pi@garagepi.local "cd /opt/gates && docker compose logs -f backend"

# Check container status
/usr/bin/ssh pi@garagepi.local "cd /opt/gates && docker compose ps"
```

The Pi is the **production environment** - there is no separate staging. Be careful with changes that could break gate access.

### GPIO Service

The GPIO service runs directly on the Pi host (not in Docker) because Docker containers can't easily access GPIO pins. Start it with:

```bash
/usr/bin/ssh pi@garagepi.local "sudo python3 /opt/gates/scripts/gpio_service.py --port 5000"
```

For persistent operation, the service should be set up as a systemd unit. The backend connects to it at `GPIO_SERVICE_URL=http://172.17.0.1:5000`.

### Local Development (Without Pi)

You can develop locally without a Pi. The backend will simulate GPIO operations when `NODE_ENV=development` or when the GPIO service is unreachable:

```bash
# Backend (needs Prisma generate first)
cd backend && bun install && bunx prisma generate && bun run dev

# Frontend (in another terminal)
cd frontend && bun install && bun run dev
```

**Important:** Always use `bun` instead of `npm` for package management. Bun is significantly faster and is the standard for this project.

## Critical Patterns

### GPIO Driver Safety (NEVER violate)
The [backend/src/drivers/gpio.ts](../backend/src/drivers/gpio.ts) driver enforces **mutual exclusion** between open/close operations. This is critical for electrical safety - activating both open and close relays simultaneously would cause hardware damage.

- Only one operation per gate at a time, enforced via `gateMutexes`
- The `stop` action bypasses locks intentionally (it's meant to interrupt active operations)
- Long pulses (`holdDurationMs > 1000ms`) return immediately with `async: true` while the GPIO service continues the pulse
- `activeHigh: false` means LOW activates the relay (common for relay modules)

### Configuration Loading
The [backend/src/config/loader.ts](../backend/src/config/loader.ts) handles configuration:
- Loads YAML from `config/gates.yaml`
- Validates against `config/gates.schema.json` using AJV
- Syncs the configuration to PostgreSQL via Prisma upserts
- Changes to the YAML require a backend restart or API reload call

### Driver Pattern
Gate drivers in `backend/src/drivers/` implement the `GateDriver` interface from [base.ts](../backend/src/drivers/base.ts). Currently there are two drivers: `gpio` for physical relays and `webhook` for HTTP-based control. To add a new driver, implement the interface and register it in [executor.ts](../backend/src/drivers/executor.ts).

## Project-Specific Conventions

### TypeScript (Backend)
- Use ESM modules with `.js` extensions in imports: `import { foo } from './bar.js'`
- Use Zod for runtime validation of request bodies and configuration
- Fastify routes use the plugin pattern - each route file exports an async function that registers routes

### TypeScript (Frontend)
- Use TanStack Router for navigation - import from `@tanstack/react-router`
- Navigate with `navigate({ to: '/path', replace: true })` not `navigate('/path', { replace: true })`
- Access route params with `getRouteApi('/parent/child/$param')` then `routeApi.useParams()`
- Access search params with `useSearch({ strict: false })` which returns typed object
- Use `Link` component from `@tanstack/react-router` for internal navigation
- Pages are lazy-loaded using `lazyRouteComponent()` in router configuration

### API Routes Structure
Routes in `backend/src/api/` follow this pattern:
```typescript
export async function exampleRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authPreHandler);  // Require authentication
  app.get('/path', async (request, reply) => { ... });
}
```

### Frontend
- React 19 with TanStack Router for navigation (file-based routing in [frontend/src/router.tsx](../frontend/src/router.tsx))
- TanStack Query for data fetching and caching
- All API calls go through [frontend/src/lib/api.ts](../frontend/src/lib/api.ts) which provides typed methods
- Auth state managed via React context in [frontend/src/lib/auth.tsx](../frontend/src/lib/auth.tsx)
- Code-split with lazy-loaded pages for optimal bundle size
- Monaco editor (YAML editing) lazy-loaded only on Settings page

### Environment Variables
- Production env vars are in `.env` on the Pi (see `.env.example` for the template)
- `LOCAL_HOSTS` controls which hostnames Caddy responds to
- `GPIO_SERVICE_URL=http://172.17.0.1:5000` points to the host GPIO service via Docker's gateway

## Authentik OIDC Integration

Self-hosted identity provider running alongside the app. See [docs/AUTHENTIK_SETUP.md](../docs/AUTHENTIK_SETUP.md).

### Key Configuration
```bash
AUTHENTIK_URL=https://authentik:9443          # Internal container URL
AUTHENTIK_EXTERNAL_URL=http://gates.local/auth # Via Cloudflare tunnel
AUTHENTIK_LOCAL_URL=https://garagepi.local:9443 # Direct LAN access
AUTHENTIK_SLUG=azure-gates                    # Application slug in Authentik
AUTHENTIK_ADMIN_GROUP=gates-admin             # Group name for admin privileges
```

### Callback URL Pattern
The [backend/src/auth/oidc.ts](../backend/src/auth/oidc.ts) dynamically selects callback URLs:
- **Remote access** (Cloudflare): `{BASE_URL}/api/auth/callback`
- **Local access**: `https://{request.host}/api/auth/callback`

When configuring Authentik, add **both** redirect URIs to the OAuth2 provider.

### Admin Detection
Users in the `AUTHENTIK_ADMIN_GROUP` group automatically get `isAdmin: true`. The group claim is extracted from the OIDC token's `groups` array.

## Cloudflare Tunnel (Remote Access)

The system supports secure remote access via Cloudflare Tunnel, which allows access from outside the local network without exposing ports to the internet.

### How It Works
- The `cloudflared` container connects outbound to Cloudflare's edge network
- Cloudflare routes requests from your custom domain (e.g., `gates.yourdomain.com`) through the tunnel
- Caddy detects Cloudflare requests via the `Cf-Ray` header and handles them on port 80 (SSL already terminated by Cloudflare)
- Local requests on the LAN use HTTPS with self-signed certs on port 443

### Configuration
The tunnel is optional and uses a Docker Compose profile. To enable it:

```bash
# Set the tunnel token in .env
CLOUDFLARE_TUNNEL_TOKEN=your-tunnel-token

# Start with the remote-access profile
docker compose --profile remote-access up -d
```

### Caddy Request Routing
The [proxy/Caddyfile](../proxy/Caddyfile) handles both access methods:
- **Cloudflare requests** (`Cf-Ray` header present): Routed via `:80`, real IP extracted from `CF-Connecting-IP`
- **Local requests**: Served via HTTPS on `{$LOCAL_HOSTS}` with internal TLS certs

### Environment Variables
```bash
CLOUDFLARE_TUNNEL_TOKEN=...           # Tunnel token from Cloudflare dashboard
BASE_URL=https://gates.yourdomain.com # Public URL for callbacks/redirects
AUTHENTIK_EXTERNAL_URL=https://gates.yourdomain.com/auth  # Public auth URL
```

## Guest Access (Magic Links)

Guests get scoped, time-limited access without Authentik accounts. Flow in [backend/src/auth/guest.ts](../backend/src/auth/guest.ts).

### Flow
1. **Admin creates invite**: `POST /api/guest/invites` with scope (LOCATION/AREA/GATE), actions, expiry
2. **Token generated**: SHA-256 hash stored in DB, raw token returned in magic link
3. **Guest redeems**: `GET /api/guest/redeem?token=...` → creates session with `isGuest: true`
4. **Scoped permissions**: Guest can only control gates within their scope with allowed actions

### Invite Schema
```typescript
{
  scopeType: 'LOCATION' | 'AREA' | 'GATE',
  scopeId: string,
  allowedActions: ('open' | 'close' | 'stop' | 'toggle')[],
  expiresInHours: 1-720,  // 1 hour to 30 days
  maxUses?: number        // Optional usage limit
}
```

### Security Notes
- Tokens are hashed before storage (never stored raw)
- `maxUses` prevents link sharing abuse
- Guest sessions expire with the invite
- All guest actions are audit logged with `guest-{inviteId}` as user ID

## Key Files Reference

| Purpose | Path |
|---------|------|
| Gate config (source of truth) | `config/gates.yaml` |
| Gate config schema | `config/gates.schema.json` |
| Backend entry | `backend/src/main.ts` |
| GPIO driver | `backend/src/drivers/gpio.ts` |
| Host GPIO service | `scripts/gpio_service.py` |
| Prisma schema | `backend/prisma/schema.prisma` |
| Reverse proxy | `proxy/Caddyfile` |
| Docker orchestration | `docker-compose.yml` |
