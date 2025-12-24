# Authentik OIDC Setup Guide - Raspberry Pi Production

This guide walks you through setting up Authentik for the Gates application on a Raspberry Pi with Cloudflare Tunnel for secure remote access.

## Prerequisites

- Raspberry Pi with Gates production stack running
- Access to Authentik at `http://garagepi.local:9000` or `https://garagepi.local:9443`
- (Optional) Cloudflare account with a domain for remote access

## Network Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Local Network                                                       │
│  ┌─────────────────┐      ┌─────────────────┐                       │
│  │  Your Phone/PC  │─────▶│  Raspberry Pi   │                       │
│  │                 │      │  garagepi.local │                       │
│  └─────────────────┘      │                 │                       │
│         │                 │  :80/:443 Caddy │                       │
│         │                 │  :9000 Authentik│                       │
│         │                 └────────┬────────┘                       │
└─────────│──────────────────────────│────────────────────────────────┘
          │                          │
          │                          │ Cloudflare Tunnel (optional)
          ▼                          ▼
    ┌─────────────────────────────────────────┐
    │         Cloudflare Edge                  │
    │   gates.yourdomain.com                   │
    │   auth.yourdomain.com                    │
    └─────────────────────────────────────────┘
```

## Step 1: Initial Authentik Setup

### 1.1: Access Authentik

Access Authentik directly on the Pi:
- **Local HTTP:** `http://garagepi.local:9000/`
- **Local HTTPS:** `https://garagepi.local:9443/` (self-signed cert warning)

### 1.2: Use Recovery Token

If this is a fresh install, generate a recovery token:

```bash
ssh pi@garagepi.local
cd /opt/gates
docker exec gates-authentik ak create_recovery_key 30 akadmin
```

Use the generated URL to access Authentik and set up the admin password.

### 1.3: Create Admin Account

1. Navigate to the recovery URL
2. Set your admin password
3. Complete the initial setup

## Step 2: Create OAuth2/OIDC Provider

1. Log in to Authentik Admin: `http://garagepi.local:9000/if/admin/`
2. Go to **Applications** → **Providers**
3. Click **Create** and select **OAuth2/OpenID Provider**

### Provider Configuration (Local Only):

| Field | Value |
|-------|-------|
| Name | `Gates OIDC Provider` |
| Authentication flow | `default-authentication-flow` |
| Authorization flow | `default-provider-authorization-implicit-consent` |
| Client type | `Confidential` |
| Client ID | `gates` |
| Client Secret | (click generate and save this!) |
| Redirect URIs | `http://garagepi.local/api/auth/callback` |
| Signing Key | Select an existing key or create new |

### Provider Configuration (With Cloudflare Tunnel):

If using Cloudflare Tunnel, add both local and remote redirect URIs:

| Field | Value |
|-------|-------|
| Redirect URIs | `http://garagepi.local/api/auth/callback`<br>`https://gates.yourdomain.com/api/auth/callback` |

### Advanced Settings:

| Field | Value |
|-------|-------|
| Subject mode | `Based on the User's ID` |
| Include claims in id_token | ✓ Enabled |
| Token validity | `minutes=60` |
| Scopes | `openid`, `profile`, `email` |

4. Click **Create**
5. **Important:** Copy the Client ID and Client Secret!

## Step 3: Create Application

1. Go to **Applications** → **Applications**
2. Click **Create**

### Application Configuration:

| Field | Value |
|-------|-------|
| Name | `Gates` |
| Slug | `gates` |
| Provider | Select `Gates OIDC Provider` |
| Policy engine mode | `any` |
| Launch URL | `http://garagepi.local/` (or your Cloudflare domain) |

3. Click **Create**

## Step 4: Update Pi Environment Variables

SSH to the Pi and update the `.env` file:

```bash
ssh pi@garagepi.local
cd /opt/gates
nano .env
```

Update these values with your Authentik provider settings:

```env
# Authentik OIDC Configuration
AUTHENTIK_URL=http://authentik:9000
AUTHENTIK_EXTERNAL_URL=http://garagepi.local:9000
AUTHENTIK_CLIENT_ID=gates
AUTHENTIK_CLIENT_SECRET=your-generated-secret-here
AUTHENTIK_SLUG=gates
AUTHENTIK_ADMIN_GROUP=Gates Admins
```

Restart the backend to apply:

```bash
docker compose -f docker-compose.prod.yml restart backend
```

## Step 5: Create Admin Group and User

### 5.1: Create Admin Group

1. Go to **Directory** → **Groups**
2. Click **Create**
3. Set Name: `Gates Admins`
4. Click **Create**

### 5.2: Create Your User

1. Go to **Directory** → **Users**
2. Click **Create**
3. Fill in:
   - Username: your username
   - Name: Your Name
   - Email: your-email@example.com
4. Click **Create**
5. Click on the user, then **Set Password**
6. Add the user to `Gates Admins` group under the **Groups** tab

## Step 6: Verify OIDC Configuration

Test the OIDC discovery endpoint:

```bash
curl -s http://garagepi.local:9000/application/o/gates/.well-known/openid-configuration | jq .
```

Expected response includes:
- `issuer`: `http://garagepi.local:9000/application/o/gates/`
- `authorization_endpoint`
- `token_endpoint`
- `userinfo_endpoint`

## Step 7: Test Local Authentication

1. Go to `http://garagepi.local/`
2. Click "Sign in"
3. You should be redirected to Authentik
4. Log in with your created user
5. You should be redirected back to Gates dashboard

---

## Cloudflare Tunnel Setup (Optional - Remote Access)

Enable secure remote access to Gates from anywhere using Cloudflare Tunnel.

### Prerequisites

- A domain managed by Cloudflare (free tier works)
- Cloudflare Zero Trust account (free for up to 50 users)

### 7.1: Create Cloudflare Tunnel

1. Log in to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
2. Go to **Networks** → **Tunnels**
3. Click **Create a tunnel**
4. Choose **Cloudflared** as connector
5. Name your tunnel: `gates-tunnel`
6. Click **Save tunnel**
7. **Copy the tunnel token** (looks like `eyJhIjoi...`)

### 7.2: Configure Tunnel Routes

Add two public hostnames in the Cloudflare dashboard:

#### Route 1: Gates Application
| Field | Value |
|-------|-------|
| Subdomain | `gates` |
| Domain | `yourdomain.com` |
| Service Type | `HTTPS` |
| URL | `proxy:443` |
| TLS | Enable "No TLS Verify" (for internal self-signed cert) |

#### Route 2: Authentik (Optional, for remote login)
| Field | Value |
|-------|-------|
| Subdomain | `auth` |
| Domain | `yourdomain.com` |
| Service Type | `HTTP` |
| URL | `authentik:9000` |

### 7.3: Update Pi Environment

Add the Cloudflare tunnel token to your `.env`:

```bash
ssh pi@garagepi.local
cd /opt/gates
nano .env
```

Add:

```env
# Cloudflare Tunnel
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...your-token-here...

# Update Authentik external URL for remote access
AUTHENTIK_EXTERNAL_URL=https://auth.yourdomain.com

# Update base URL
BASE_URL=https://gates.yourdomain.com
```

### 7.4: Update Authentik Provider Redirect URIs

1. Go to Authentik Admin → **Applications** → **Providers**
2. Edit `Gates OIDC Provider`
3. Add redirect URI: `https://gates.yourdomain.com/api/auth/callback`
4. Save

### 7.5: Start Cloudflare Tunnel

```bash
cd /opt/gates
docker compose -f docker-compose.prod.yml --profile remote-access up -d cloudflared
```

Verify it's running:

```bash
docker logs gates-cloudflared
```

### 7.6: Update Caddy for Custom Domain

Edit the Caddyfile to include your custom domain. Update `/opt/gates/proxy/Caddyfile.prod`:

```bash
nano /opt/gates/proxy/Caddyfile.prod
```

Uncomment and configure the custom domain section:

```caddyfile
# Custom domain via Cloudflare Tunnel
gates.yourdomain.com {
    tls {
        # Cloudflare handles TLS at edge
    }
    
    handle /api/* {
        reverse_proxy backend:3001 {
            header_up X-Forwarded-Proto {scheme}
            header_up X-Real-IP {http.request.header.CF-Connecting-IP}
        }
    }

    handle /auth/* {
        reverse_proxy authentik:9000 {
            header_up X-Forwarded-Proto {scheme}
            header_up X-Real-IP {http.request.header.CF-Connecting-IP}
        }
    }

    handle {
        reverse_proxy frontend:80 {
            header_up X-Forwarded-Proto {scheme}
        }
    }
}
```

Restart proxy:

```bash
docker compose -f docker-compose.prod.yml restart proxy
```

### 7.7: Test Remote Access

1. Go to `https://gates.yourdomain.com/`
2. You should see the Gates login page
3. Login should redirect to Authentik and back

---

## SSL Certificate Options

### Option A: Cloudflare Tunnel (Recommended)

- **No configuration needed** - Cloudflare handles SSL at the edge
- Valid certificate for your domain
- Works with any subdomain

### Option B: Let's Encrypt with DNS Challenge

If you have a domain but don't want to use Cloudflare Tunnel:

1. Install Caddy with Cloudflare DNS plugin
2. Update Caddyfile:

```caddyfile
gates.yourdomain.com {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }
    # ... rest of config
}
```

3. Add to `.env`:

```env
CLOUDFLARE_API_TOKEN=your-api-token
```

### Option C: Self-Signed (Local Only)

For local network only, use the built-in self-signed certs:

```caddyfile
gates.local, garagepi.local {
    tls internal
    # ... rest of config
}
```

Accept the browser warning on first access.

---

## Add Google OAuth (Optional)

Enable "Sign in with Google" for easier authentication.

### 1: Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project: `Gates`
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth client ID**
5. Configure consent screen:
   - User Type: **External**
   - App name: `Gates`
6. Create OAuth Client ID:
   - Application type: **Web application**
   - Name: `Authentik`
   - Authorized redirect URIs:
     - `http://garagepi.local:9000/source/oauth/callback/google/`
     - `https://auth.yourdomain.com/source/oauth/callback/google/` (if using Cloudflare)
7. Copy **Client ID** and **Client Secret**

### 2: Create Google OAuth Source in Authentik

1. Go to **Directory** → **Federation & Social login**
2. Click **Create** → **OAuth Source**

| Field | Value |
|-------|-------|
| Name | `Google` |
| Slug | `google` |
| Authentication flow | `default-source-authentication` |
| Enrollment flow | `default-source-enrollment` |
| Provider type | `Google` |
| Consumer Key | Your Google Client ID |
| Consumer Secret | Your Google Client Secret |
| Scopes | `openid email profile` |

3. Click **Create**

### 3: Enable Google on Login Flow

1. Go to **Flows & Stages** → **Flows**
2. Click on `default-authentication-flow`
3. Click **Stage Bindings** tab
4. Find `default-authentication-identification` stage
5. Click the stage to edit
6. Under **Sources**, enable `Google`
7. Click **Update**

---

## Troubleshooting

### "Invalid CORS origin option"

- Check that `BASE_URL` is set correctly in `.env`
- Restart backend: `docker compose -f docker-compose.prod.yml restart backend`

### "Failed to configure authentication"

- Ensure Authentik is running: `docker logs gates-authentik`
- Verify OIDC discovery URL is accessible
- Check that client ID/secret match in both Authentik and `.env`

### "Invalid redirect_uri"

- Ensure redirect URI in Authentik exactly matches your domain
- Check for trailing slashes
- For Cloudflare, ensure you added the HTTPS redirect URI

### Cloudflare Tunnel not connecting

- Check tunnel token is correct
- View logs: `docker logs gates-cloudflared`
- Verify tunnel is active in Cloudflare dashboard

### "Not Found" on /auth/ routes

- Access Authentik directly at port 9000/9443 for admin tasks
- The `/auth/` proxy is for OIDC flows, not the admin interface

### Backend can't reach Authentik

- Verify both are on the same Docker network
- Check: `docker exec gates-backend ping authentik`

---

## Quick Reference

### Local Access
- Gates: `http://garagepi.local/` or `https://garagepi.local/`
- Authentik Admin: `http://garagepi.local:9000/if/admin/`

### Remote Access (with Cloudflare Tunnel)
- Gates: `https://gates.yourdomain.com/`
- Authentik: `https://auth.yourdomain.com/if/admin/`

### Generate Recovery Token
```bash
ssh pi@garagepi.local
docker exec gates-authentik ak create_recovery_key 30 akadmin
```

### Restart Services
```bash
cd /opt/gates
docker compose -f docker-compose.prod.yml restart backend authentik proxy
```

### View Logs
```bash
docker logs gates-backend
docker logs gates-authentik
docker logs gates-proxy
docker logs gates-cloudflared
```
