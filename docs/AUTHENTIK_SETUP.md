# Authentik OIDC Setup Guide

This guide walks you through setting up Authentik for the Gates application.

## Prerequisites

- Gates environment running (`docker compose up -d`)
- Access to Authentik at https://garagepi.local:9443

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

## Step 4: Add Google OAuth (Optional)

Enable "Sign in with Google" for users with Google accounts.

### 4.1: Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project or select existing
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth client ID**
5. Configure consent screen if prompted:
   - User Type: **External** (or Internal for Workspace)
   - App name: `Gates`
   - User support email: your email
   - Authorized domains: your domain (for production)
6. Create OAuth Client ID:
   - Application type: **Web application**
   - Name: `Authentik`
   - Authorized redirect URIs: `http://localhost:9000/source/oauth/callback/google/`
   - For production: `https://auth.yourdomain.com/source/oauth/callback/google/`
7. Copy the **Client ID** and **Client Secret**

### 4.2: Create Google OAuth Source in Authentik

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

### 4.3: Enable Google on Login Flow

1. Go to **Flows & Stages** → **Flows**
2. Click on `default-authentication-flow`
3. Click **Stage Bindings** tab
4. Find `default-authentication-identification` stage
5. Click the stage name to edit
6. Under **Sources**, enable `Google`
7. Click **Update**

Now users will see "Sign in with Google" on the login page.

### 4.4: Restrict to Specific Email Domains (Optional)

To only allow specific email domains (e.g., company emails):

1. Go to **Customization** → **Policies**
2. Click **Create** → **Expression Policy**
3. Configure:
   - Name: `allowed-email-domains`
   - Expression:
     ```python
     allowed_domains = ["yourdomain.com", "gmail.com"]
     user_email = request.context.get("pending_user", {}).get("email", "")
     return any(user_email.endswith(f"@{domain}") for domain in allowed_domains)
     ```
4. Bind this policy to your enrollment flow

## Step 5: Create Local Users (Optional)

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
