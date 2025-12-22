# Authentik OIDC Setup Guide

This guide walks you through setting up Authentik for the Gates application.

## Prerequisites

- Gates dev environment running (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`)
- Access to Authentik at http://localhost:9000

## Step 1: Initial Authentik Setup

1. Navigate to http://localhost:9000/if/flow/initial-setup/
2. Create your admin account:
   - Email: your-email@example.com
   - Password: (choose a strong password)
3. Complete the initial setup wizard

## Step 2: Create OAuth2/OIDC Provider

1. Log in to Authentik Admin: http://localhost:9000/if/admin/
2. Go to **Applications** → **Providers**
3. Click **Create** and select **OAuth2/OpenID Provider**

### Provider Configuration:

| Field | Value |
|-------|-------|
| Name | `Gates OIDC Provider` |
| Authentication flow | `default-authentication-flow` |
| Authorization flow | `default-provider-authorization-implicit-consent` |
| Client type | `Confidential` |
| Client ID | `gates-dev` |
| Client Secret | `dev-client-secret` (or generate a new one) |
| Redirect URIs | `http://localhost:3000/api/auth/callback` |
| Signing Key | Select an existing key or create new |

### Advanced Settings:

| Field | Value |
|-------|-------|
| Subject mode | `Based on the User's ID` |
| Include claims in id_token | ✓ Enabled |
| Token validity | `minutes=60` |
| Scopes | `openid`, `profile`, `email` |

4. Click **Create**

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

3. Click **Create**

## Step 4: Create Local Users

For LAN-only authentication (works without internet):

1. Go to **Directory** → **Users**
2. Click **Create**
3. Fill in user details:
   - Username
   - Name
   - Email
   - Password (set via the Actions menu after creation)
4. Click **Create**

## Step 5: Verify Configuration

Test the OIDC discovery endpoint:

```bash
curl -s http://localhost:9000/application/o/gates/.well-known/openid-configuration | jq .
```

Expected response includes:
- `issuer`: `http://localhost:9000/application/o/gates/`
- `authorization_endpoint`
- `token_endpoint`
- `userinfo_endpoint`

## Step 6: Update Environment Variables

For production, update your `.env` file:

```env
AUTHENTIK_CLIENT_ID=gates
AUTHENTIK_CLIENT_SECRET=your-generated-secret
```

## Testing Authentication

1. Go to http://localhost:3000
2. Click "Sign in"
3. You should be redirected to Authentik
4. Log in with your created user
5. You should be redirected back to Gates dashboard

## Troubleshooting

### "Failed to configure authentication"

- Ensure Authentik is running: `docker compose logs authentik`
- Verify the OIDC discovery URL is accessible
- Check that client ID/secret match in both Authentik and `.env`

### "Invalid redirect_uri"

- Ensure the redirect URI exactly matches: `http://localhost:3000/api/auth/callback`
- Check for trailing slashes

### "User not found after login"

- This is normal for first login - the user is created automatically
- Check backend logs: `docker compose logs backend`

## Guest Access (Magic Links)

Once authenticated, you can create guest access links:

1. Go to Dashboard → Guest Access
2. Click "Create Invite"
3. Select:
   - Scope (Gate, Area, or Location)
   - Allowed actions (open, close, stop, toggle)
   - Expiry time
   - Max uses (optional)
4. Copy the magic link and share with your guest

Guests can access gates without needing an Authentik account.
