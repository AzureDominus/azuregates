# AzureGates - AI Agent Instructions

## ⚠️ CRITICAL: Deployment Workflow

**ALWAYS follow this exact sequence when making changes:**

1. **Make changes** locally
2. **Bump version** before committing:
   ```bash
   cd backend && bun run build:bump:patch   # or :minor / :major
   cd frontend && bun run build:bump:patch  # if frontend changed
   ```
3. **Commit with version**: `git add -A && git commit -m "vX.Y.Z: Description" && git push`
4. **Deploy to Pi**: `/usr/bin/ssh pi@garagepi.local "cd /opt/gates && git pull && docker compose up <containers> -d --build"`

**NEVER commit without bumping the version first.** The Pi build does not bump versions.

### Version Bump Types
- **patch**: Bug fixes, minor improvements (most common)
- **minor**: New features, backward compatible  
- **major**: Breaking changes

---

## Project Overview

AzureGates is a self-hosted garage gate control system for Raspberry Pi. It provides a web interface for controlling physical gates via GPIO-connected relays, with OIDC authentication, guest access via magic links, and audit logging.

**Public repository** - never commit secrets. All sensitive values go in `.env` (gitignored).

## Architecture

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

### Key Components
| Component | Purpose |
|-----------|---------|
| `backend/` | Fastify TypeScript API (auth, gate commands, config) |
| `frontend/` | React SPA with Vite, TanStack Router/Query |
| `config/gates.yaml` | Gate definitions (source of truth, synced to DB) |
| `scripts/gpio_service.py` | Python HTTP server on Pi host for GPIO control |
| `proxy/Caddyfile` | Reverse proxy (local HTTPS + Cloudflare tunnel) |

### Data Flow
1. **Config**: `gates.yaml` → validated against JSON schema → synced to PostgreSQL on backend startup
2. **GPIO**: Backend → HTTP to `http://172.17.0.1:5000` → Python service → RPi.GPIO → relay pins
3. **Auth**: Authentik OIDC → sessions in Redis → guests via magic link tokens

---

## Package Manager

**Always use `bun`** - never npm or yarn:
```bash
bun install          # Install deps
bun run dev          # Dev server
bun run build        # Production build
bunx prisma generate # Run prisma CLI
```

---

## Pi Deployment Commands

```bash
# SSH to Pi (use full path to avoid aliases)
/usr/bin/ssh pi@garagepi.local

# Deploy specific containers
/usr/bin/ssh pi@garagepi.local "cd /opt/gates && git pull && docker compose up backend -d --build"
/usr/bin/ssh pi@garagepi.local "cd /opt/gates && git pull && docker compose up frontend -d --build"
/usr/bin/ssh pi@garagepi.local "cd /opt/gates && git pull && docker compose up proxy -d --build"

# View logs
/usr/bin/ssh pi@garagepi.local "cd /opt/gates && docker compose logs -f backend"

# Check status
/usr/bin/ssh pi@garagepi.local "cd /opt/gates && docker compose ps"
```

**Always build on the Pi** - don't pull pre-built images (slow network).

---

## Local Development

```bash
# Backend (terminal 1)
cd backend && bun install && bunx prisma generate && bun run dev

# Frontend (terminal 2)
cd frontend && bun install && bun run dev
```

GPIO operations are simulated when `NODE_ENV=development` or GPIO service unreachable.

---

## Critical Safety: GPIO Driver

The GPIO driver (`backend/src/drivers/gpio.ts`) enforces **mutual exclusion** between open/close operations. This is critical - activating both relays simultaneously causes hardware damage.

- Only one operation per gate at a time via `gateMutexes`
- `stop` action bypasses locks (meant to interrupt operations)
- `activeHigh: false` means LOW activates relay (common for relay modules)
- Long pulses (`holdDurationMs > 1000ms`) return `async: true` while GPIO service continues

---

## Code Conventions

### Backend (TypeScript/Fastify)
- ESM modules with `.js` extensions: `import { foo } from './bar.js'`
- Zod for runtime validation
- Routes export async plugin functions

### Frontend (React/TanStack)
- TanStack Router: `navigate({ to: '/path', replace: true })`
- Route params: `getRouteApi('/path/$param').useParams()`
- Search params: `useSearch({ strict: false })`
- All API calls via `src/lib/api.ts`

### AI Agent File Editing Rules
- **ALWAYS use native tools** (`create_file`, `replace_string_in_file`, `multi_replace_string_in_file`) for local file edits
- **NEVER use `cat >` or heredocs** to write files locally - this bypasses proper tooling
- **Only use `cat`** when reading/writing files on the Pi via SSH (where native tools don't work)
- Use `run_in_terminal` for git commands, builds, and deployments - not file editing

### User Communication via Terminal
When you need to ask the user a question during a session, use the ask script instead of ending the chat:
```bash
/home/azure/Repos/AzureGates/scripts/ask.sh "Your question here"
```
This blocks execution until the user types a response, which you can then read from the terminal output. Useful when the chat input is glitchy or for interactive workflows.

---

## Auth & Access

### Authentik OIDC
- Internal: `https://authentik:9443`
- Local LAN: `https://garagepi.local:9443`
- Remote (Cloudflare): `{BASE_URL}/auth`
- Admin group: `AUTHENTIK_ADMIN_GROUP` env var

### Guest Access (Magic Links)
1. Admin creates invite with scope (LOCATION/AREA/GATE), actions, expiry
2. Token hashed and stored, raw token in magic link
3. Guest redeems → session with `isGuest: true`, scoped permissions

---

## Environment Variables

Key variables in `.env`:
```bash
# Auth
AUTHENTIK_URL=https://authentik:9443
AUTHENTIK_CLIENT_ID=...
AUTHENTIK_CLIENT_SECRET=...
AUTHENTIK_ADMIN_GROUP=gates-admin
SESSION_SECRET=...

# GPIO
GPIO_SERVICE_URL=http://172.17.0.1:5000
GPIO_SERVICE_SECRET=...

# Remote access
BASE_URL=https://gates.yourdomain.com
CLOUDFLARE_TUNNEL_TOKEN=...
```

---

## Key Files

| Purpose | Path |
|---------|------|
| Gate config | `config/gates.yaml` |
| Backend entry | `backend/src/main.ts` |
| GPIO driver | `backend/src/drivers/gpio.ts` |
| GPIO service | `scripts/gpio_service.py` |
| API client | `frontend/src/lib/api.ts` |
| Auth context | `frontend/src/lib/auth.tsx` |
| Prisma schema | `backend/prisma/schema.prisma` |
| Docker config | `docker-compose.yml` |
| Proxy config | `proxy/Caddyfile` |
