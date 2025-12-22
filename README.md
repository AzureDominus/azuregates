# Garage Gate Opener v2

A self-hosted, Docker-based garage gate control system for Raspberry Pi.

## Features

- 🚪 Multi-gate support with areas and locations
- 🔌 Pluggable drivers (GPIO relay, Webhook)
- 🔐 Local authentication via Authentik (works offline)
- 👥 Guest access with expiring magic links
- 📋 Audit logging for all commands
- ⚙️ Configuration as file (YAML) with UI editing
- 🔄 Pull-based updates

## Quick Start (Development)

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local development outside containers)

### Running the Stack

```bash
# Start all services in development mode
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Access the application
# Frontend: http://localhost:3000
# Backend API: http://localhost:3000/api
# Mock Server: http://localhost:4000
# Authentik: http://localhost:9000
```

### Development without Docker

```bash
# Backend
cd backend
npm install
npx prisma generate
npx prisma db push
npm run dev

# Frontend (in another terminal)
cd frontend
npm install
npm run dev

# Mock Server (in another terminal)
cd mock-server
npm install
npm start
```

## Project Structure

```
├── docker-compose.yml          # Production compose file
├── docker-compose.dev.yml      # Development overrides
├── config/
│   ├── gates.yaml              # Gate configuration (source of truth)
│   ├── gates.schema.json       # Configuration JSON schema
│   └── history/                # Config revision backups
├── backend/
│   ├── src/
│   │   ├── api/                # REST API routes
│   │   ├── config/             # Config loading & validation
│   │   ├── drivers/            # Gate drivers (GPIO, Webhook)
│   │   ├── permissions/        # Authorization logic
│   │   └── audit/              # Audit logging
│   └── prisma/
│       └── schema.prisma       # Database schema
├── frontend/
│   └── src/
│       ├── components/         # React components
│       ├── pages/              # Page components
│       └── lib/                # API client & utilities
├── proxy/
│   └── Caddyfile               # Reverse proxy config
└── mock-server/                # Webhook simulation for dev
```

## Configuration

Gates are configured in `config/gates.yaml`:

```yaml
version: 1

settings:
  defaultCooldownMs: 2000
  logLevel: info

locations:
  - id: home
    name: Home
    areas:
      - id: garage
        name: Garage
        gates:
          - id: main-gate
            name: Main Garage Door
            driver: webhook
            capabilities: [open, close, stop]
            config:
              endpoints:
                open: http://mock-server:4000/gate/main-gate/open
                close: http://mock-server:4000/gate/main-gate/close
                stop: http://mock-server:4000/gate/main-gate/stop
              method: POST
              timeoutMs: 5000
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/locations` | List locations with areas and gates |
| GET | `/api/gates` | List all gates |
| POST | `/api/gates/:id/command` | Execute gate action |
| GET | `/api/audit-logs` | Query audit logs |
| GET | `/api/config` | Get current config |
| POST | `/api/config/reload` | Reload config from file |

## Drivers

### Webhook Driver

For development or integrating with external systems:

```yaml
driver: webhook
config:
  endpoints:
    open: http://example.com/gate/open
    close: http://example.com/gate/close
  method: POST
  timeoutMs: 5000
```

### GPIO Driver

For Raspberry Pi with relay modules:

```yaml
driver: gpio
config:
  openPin: 17
  closePin: 27
  stopPin: 22
  pulseDurationMs: 500
  activeHigh: false
```

## Security

- Authentication via Authentik (self-hosted, works offline)
- Session-based auth (BFF pattern)
- Per-gate/area/location permissions
- Guest access with expiring tokens
- All commands logged to audit trail

## License

MIT
