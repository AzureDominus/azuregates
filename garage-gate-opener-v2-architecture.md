# Garage Gate Opener v2 (Raspberry Pi) — Architecture & Setup Brief
_Last updated: 2025-12-22_

This document describes a modern rebuild of a Raspberry Pi–based garage gate opener system. It is intended to be handed to an engineer to implement. It focuses on architecture, technical decisions, and deployment setup. It intentionally excludes UI/UX design details and avoids code samples.

---

## 1. Goals

### Functional
- **Multi-gate support** within a single home deployment.
- **Multiple gate control methods**:
  - GPIO relay control (Raspberry Pi), including **separate pins per action** (open/close/stop).
  - Non-relay gates via **webhooks** (future extension: MQTT, vendor APIs, Home Assistant).
- **Gate capability modeling** (not all gates support the same actions):
  - Actions may include: open, close, stop, toggle, report state.
- **Gate organization**:
  - Gates belong to **Areas** (e.g., Entrance, Garage).
  - Areas belong to a **Location** (one home per stack, but the model supports multiple).
- **Per-user access control**, including **guest access** with **expiry**.
- **Ability to disable gates** (soft-disable so gate remains visible but cannot be controlled).

### Non-functional
- **Docker-based deployment** on Raspberry Pi.
- **Pull-based updates** (device pulls released images).
- Works on **LAN without WAN** (internet down), including authentication.
- **Separation of frontend and backend** (separate services/artifacts).
- **Configuration stored as a file** (source of truth) but also editable in the UI.
- **Maintainable and extensible**: driver/plugin architecture, clean boundaries, audit logs.

---

## 2. Chosen Topology (Option A): One Stack per Home

Each home runs its own Docker Compose stack on a Raspberry Pi (or equivalent host). “Multi-home” is a future option by deploying multiple stacks, one per home. No centralized control plane is required initially.

Implications:
- Local access is always available on the LAN.
- Remote access is optional and can be added without changing core architecture.
- Data and configuration are scoped to a single home instance, simplifying security.

---

## 3. High-Level Components

### Core services
1. **Reverse Proxy**
   - Single entrypoint for LAN and (optional) WAN.
   - Routes:
     - Frontend
     - Backend API (e.g., under /api)
     - Auth (Authentik endpoints)
   - Optional TLS termination (recommended for any WAN access; optional on LAN depending on your environment).

2. **Frontend (SPA)**
   - Static web app served separately from backend.
   - Never holds long-lived credentials.

3. **Backend API**
   - Gate domain logic (locations, areas, gates).
   - Enforces permissions for every action.
   - Executes commands via gate “drivers” (GPIO/webhook/etc).
   - Owns configuration file import/export and validation.
   - Maintains server-side session (BFF pattern) for secure auth.

4. **Database (Postgres)**
   - Operational store: users (by external ID), permissions/bindings, invites, audit logs, gate definitions (derived from config), last command results.
   - Configuration file remains the source of truth; DB is derived/operational.

5. **Authentik (Self-hosted Identity Provider)**
   - Provides local login via username/password.
   - Optional: social login providers (Google) as an additional method when internet is available.
   - Must be available on LAN so authentication works offline (WAN down).

### Optional services
6. **Cloudflare Tunnel (cloudflared)**
   - Only if remote access is desired.
   - System must remain fully usable without it.

7. **Updater / Pull-based Deployment Agent**
   - Periodically pulls updated container images and restarts services.
   - Must support rollback and health checking.

---

## 4. Networking & Local Access

### LAN access via mDNS
- Provide a friendly LAN hostname using mDNS, for example:
  - gates.local
  - gates.home
- The reverse proxy should be reachable at that hostname.
- Keep everything functional via LAN even if WAN is down.

### Remote access (optional)
- If enabled, remote access should be additive and never required.
- Prefer exposing only the reverse proxy via a tunnel.
- Ensure auth and all core services remain local and functional without WAN.

---

## 5. Authentication Strategy (Approach 2): Self-hosted Authentik

### Requirements satisfied
- Local logins: **username/password** (no external dependency).
- Optional: Google login can be configured, but must not be the only login method.
- Offline: if internet is down, users can still authenticate locally.

### Implementation note: BFF pattern
- Backend acts as a “Backend for Frontend”:
  - The browser uses a session cookie to talk to the backend.
  - The backend handles OIDC with Authentik.
  - Avoid storing tokens in the SPA.
- This reduces client-side token risks and simplifies API security.

---

## 6. Authorization & Guest Access (Expiring)

### Policy model (conceptual)
- Permissions should be scoping-aware:
  - Location scope (entire home)
  - Area scope (subset of gates)
  - Gate scope (single gate)
- Permissions should be action-specific:
  - open / close / stop / toggle / view state / manage config / manage users

### Guest defaults and overrides
- Default guest actions: **open, close, stop**
- When creating a guest invite, admin can override the allowed actions (subset selection).

### Guest onboarding via magic link
- Admin generates an invite link from the backend.
- Invite contains:
  - Expiration time
  - Scope (location/area/gate)
  - Allowed actions
  - One-time token or short-lived signed token
- Guest clicks link:
  - If not authenticated, they are prompted to log in via Authentik.
  - After login, backend validates invite and binds permissions until expiry.
- Expiry enforcement is in the application layer (backend checks it at request time).

---

## 7. Gate Domain Model (No DB schema details)

### Entities and relationships
- **Location**: represents a home instance (in this topology, one location is typical).
- **Area**: grouping within a home (Entrance, Garage, Side yard).
- **Gate**: controllable unit within an area.

### Gate properties (conceptual)
- Enabled/disabled flag
- Driver type (GPIO relay, webhook, etc.)
- Supported capabilities (actions)
- Human-friendly name/label and optional metadata (notes, physical mapping)

### Gate capabilities
Each gate declares supported actions. Backend must:
- Reject unsupported actions with clear error messages.
- Hide/disable UI controls for unsupported actions (UI behavior is up to frontend, but backend must enforce).

---

## 8. Drivers and Extensibility

### Driver concept
A driver is a pluggable implementation that can execute actions on a gate.

Drivers must declare:
- Which actions they support
- What configuration they require
- Whether they support state reporting

### Initial drivers
1. **GPIO Relay Driver**
   - Separate pins per action (openPin, closePin, stopPin).
   - Pulse duration per action (ms).
   - Active-high or active-low support.
   - Safety features:
     - Debounce and cooldown (prevent rapid repeats).
     - Mutual exclusion (avoid issuing conflicting commands simultaneously).

2. **Webhook Driver**
   - Per-action endpoints or a unified endpoint with action parameter.
   - Configurable method, headers, timeout.
   - Fail fast behavior preferred (avoid long retries for physical operations).

### Future state reporting and sensors
State reporting is optional per gate and modeled as a capability.
- Future sensor sources can include:
  - GPIO input sensors (reed switches, limit switches)
  - Gate controller APIs
  - External systems (Home Assistant, PLC, etc.)
- Treat state as:
  - Observed state (from sensors) when available
  - Unknown otherwise
- Never assume state based solely on last command.

---

## 9. Configuration as File (Source of Truth) + UI Editing

### Key principle
- **Config file is the source of truth**
- Database is the operational store and can be derived from config

### Recommended workflow
- On startup (and on-demand), backend:
  1. Reads the config file.
  2. Validates it against a schema.
  3. Upserts derived entities into DB.
- UI edits flow:
  - UI sends change requests to backend.
  - Backend applies edits to the config file atomically:
    - Write to temp file
    - Validate
    - Replace original
  - Backend re-applies config to operational store.

### Configuration contents (conceptual, not syntax)
- Locations, areas, gates
- Driver assignments + driver-specific settings
- Defaults for permissions (optional)
- Global settings (rate limits, logging level, etc.)

### Versioning and rollback
- Maintain a small local history:
  - “last N config revisions” saved to disk
- Optionally, store config in git (GitOps) for explicit rollback and review.

---

## 10. Physical Safety & Operational Guardrails

Even with no sensors, the system should minimize accidental misuse:
- Per-gate rate limit / cooldown (e.g., no more than 1 command per X seconds).
- Mutual exclusion (do not issue open and close in parallel).
- Clear audit logging of every command attempt and result.
- Explicit disabled state for gates (hard block commands when disabled).
- Optional “maintenance mode” that disables all gates temporarily.

---

## 11. Observability

### Audit log (required)
Record every action attempt:
- Who (user identity)
- When (timestamp)
- What (gate, action)
- Where (client IP/device metadata if available)
- Result (success/failure, error reason)
- Latency/duration

### Operational logs
- Backend structured logs (JSON-friendly).
- Reverse proxy access logs.
- Authentik auth events (as available).

### Health checks
- Service health endpoints (backend, reverse proxy, Authentik).
- Optional: gate driver self-tests (GPIO accessibility, webhook connectivity).

---

## 12. Deployment & Environments

### Docker deployment
- All services run under Docker Compose on the Raspberry Pi.
- Prefer clearly separated networks:
  - “edge” network for reverse proxy-facing services
  - “internal” network for DB and private service traffic

### Secrets management
- Do not store secrets in the config file if that file is committed.
- Use:
  - Environment files on device
  - Docker secrets
  - Separate “secrets” directory mounted read-only

### Hardware access
- Backend must have access to GPIO:
  - Use least privilege required.
  - Document required permissions/groups for the container runtime on Raspberry Pi OS.

---

## 13. CI/CD Strategy (Pull-based)

### CI responsibilities
- Build container images (multi-arch, including ARM64).
- Run automated tests:
  - Unit tests
  - Driver conformance tests (including simulated driver)
  - Config schema validation tests
- Push images to registry with versioned tags.

### Release channels
- Prefer explicit versioning:
  - stable (manual promotion)
  - optional edge (latest)
- Raspberry Pi should generally track stable unless you want rapid iteration.

### Pull-based updates on device
- A scheduled updater checks for new versions and performs:
  1. Pull images
  2. Restart services
  3. Verify health checks
  4. Roll back on failure (if supported)
- Updates should not require human SSH access during normal operation.

---

## 14. Implementation Boundaries (to keep maintainable)

### Backend responsibilities
- Permissions and expiry enforcement
- Gate capability validation
- Driver selection + execution
- Config file management (read/validate/write)
- Audit logs and operational metrics

### Frontend responsibilities
- UI logic only
- Calls backend API
- No direct interaction with Authentik tokens beyond the normal session flow

### Authentik responsibilities
- Identity management
- Authentication (local user/pass)
- Optional social login providers

### Reverse proxy responsibilities
- Routing
- Optional TLS
- Optional request limits and security headers

---

## 15. Acceptance Criteria (for the engineer)

A successful v2 implementation should demonstrate:
- Multiple gates can be created and controlled, each with separate open/close/stop GPIO pins.
- Some gates can be configured as webhook-only and coexist with GPIO gates.
- Gates can be enabled/disabled, and disabled gates reject commands.
- Capabilities are enforced: unsupported actions are blocked.
- Local authentication works fully on LAN with internet disconnected.
- Guest magic links grant temporary access with expiry.
- Guest default actions are open/close/stop, with per-invite action selection available.
- Config exists as a file, loads on boot, validates, and can be edited via UI through backend-managed writes.
- Pull-based update mechanism exists and can update the stack without manual redeploy.
- Audit logs exist for every command attempt.

---

## 16. Suggested Delivery Milestones (no implementation detail)

1. Base stack: reverse proxy + backend + frontend + DB
2. Auth: Authentik integrated with local user/pass, backend session established
3. Gate model + GPIO driver (open/close/stop pins) + audit logs
4. Webhook driver + capability enforcement
5. Config file source-of-truth pipeline + UI-driven edits via backend
6. Guest magic links with expiry + action selection
7. Pull-based updater + health checks and rollback strategy
8. Optional: Cloudflare tunnel for remote access

---

## 17. Notes and Future Enhancements (optional)

- Add sensor support and true state reporting (reed switches, controller APIs).
- Add push notifications later if needed (email/push/webhook), but keep out of initial scope.
- Add multi-home aggregator later by introducing an “agent boundary” and a central control plane if desired.
