import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as openidClient from 'openid-client';
import { randomBytes, createHash } from 'crypto';
import { config } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { getCurrentUser, type SessionUser } from './session.js';

// OIDC configuration cache
let oidcConfig: openidClient.Configuration | null = null;
let codeVerifier: string | null = null;

async function getOidcConfig(): Promise<openidClient.Configuration> {
  if (oidcConfig) return oidcConfig;

  const issuerUrl = new URL(`${config.authentik.url}/application/o/${config.authentik.slug}/`);

  // Allow insecure requests for internal Docker networking (HTTP between containers)
  // or in development mode
  const isInternalHttp = issuerUrl.protocol === 'http:';
  const allowInsecure = config.nodeEnv === 'development' || isInternalHttp;

  try {
    oidcConfig = await openidClient.discovery(issuerUrl, config.authentik.clientId, {
      client_secret: config.authentik.clientSecret,
    }, undefined, {
      execute: allowInsecure ? [openidClient.allowInsecureRequests] : undefined,
    });
    logger.info({ issuer: issuerUrl.toString() }, 'OIDC discovery completed');
    return oidcConfig;
  } catch (err) {
    logger.error({ err, issuerUrl: issuerUrl.toString() }, 'OIDC discovery failed');
    throw new Error('Failed to configure authentication');
  }
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export async function oidcRoutes(app: FastifyInstance) {
  // Get current user info
  app.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    
    if (!user) {
      return reply.send({
        authenticated: false,
        user: null,
      });
    }

    return reply.send({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isAdmin: user.isAdmin ?? false,
        isGuest: user.isGuest ?? false,
        permissions: user.permissions ?? [],
        // Activation status for frontend to handle pending/disabled states
        isActivated: user.isActivated ?? false,
        wasEverActivated: user.wasEverActivated ?? false,
      },
    });
  });

  // Initiate OIDC login flow
  app.get('/login', async (request: FastifyRequest<{ Querystring: { returnTo?: string } }>, reply: FastifyReply) => {
    try {
      const oidc = await getOidcConfig();
      
      // Generate PKCE code verifier/challenge
      codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      // Generate state for CSRF protection
      const state = randomBytes(16).toString('hex');

      // Store return URL and state in session
      const session = request.session as any;
      session.returnTo = request.query.returnTo || '/';

      // Determine the base URL and auth URL based on the incoming request
      // Check if request is from configured BASE_URL (remote) or local access
      const requestHost = request.headers.host || '';
      const baseUrlHost = new URL(config.baseUrl).host;
      const isRemoteAccess = requestHost === baseUrlHost || !!request.headers['cf-ray'];
      
      const effectiveBaseUrl = isRemoteAccess ? config.baseUrl : `https://${requestHost}`;
      const effectiveAuthUrl = isRemoteAccess 
        ? config.authentik.externalUrl 
        : `https://${requestHost.replace(':443', '').replace(':80', '')}:9443`;

      // Build authorization URL
      const redirectUri = `${effectiveBaseUrl}/api/auth/callback`;
      const authUrl = openidClient.buildAuthorizationUrl(oidc, {
        redirect_uri: redirectUri,
        scope: 'openid profile email groups',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      // Replace internal Authentik URL with external URL for browser redirect
      const externalAuthUrl = authUrl.href.replace(
        config.authentik.url,
        effectiveAuthUrl
      );

      logger.info({ authUrl: externalAuthUrl, isRemoteAccess }, 'Redirecting to OIDC provider');
      return reply.redirect(externalAuthUrl);
    } catch (err) {
      logger.error({ err }, 'Failed to initiate OIDC login');
      return reply.status(500).send({ 
        error: 'Authentication unavailable',
        message: 'Unable to connect to identity provider',
      });
    }
  });

  // OIDC callback handler
  app.get('/callback', async (request: FastifyRequest<{ Querystring: Record<string, string> }>, reply: FastifyReply) => {
    try {
      const oidc = await getOidcConfig();
      
      // Determine base URL dynamically based on incoming request
      const requestHost = request.headers.host || '';
      const baseUrlHost = new URL(config.baseUrl).host;
      const isRemoteAccess = requestHost === baseUrlHost || !!request.headers['cf-ray'];
      const effectiveBaseUrl = isRemoteAccess ? config.baseUrl : `https://${requestHost}`;
      
      const redirectUri = `${effectiveBaseUrl}/api/auth/callback`;

      // Exchange code for tokens
      const currentUrl = new URL(request.url, effectiveBaseUrl);
      const tokens = await openidClient.authorizationCodeGrant(oidc, currentUrl, {
        expectedState: request.query.state as any,
        pkceCodeVerifier: codeVerifier!,
      });

      // Get user info from claims
      const claims = tokens.claims();
      if (!claims) {
        throw new Error('No claims in token response');
      }

      const externalId = claims.sub as string;
      const email = (claims.email as string) || '';
      const displayName = (claims.preferred_username as string) || 
                          (claims.name as string) || 
                          email.split('@')[0] || 
                          'Unknown User';

      // Check if user is in admin group from Authentik
      const groups = (claims.groups as string[]) || [];
      const isAdmin = groups.includes(config.authentik.adminGroup);
      
      logger.debug({ groups, adminGroup: config.authentik.adminGroup, isAdmin }, 'Checking admin group membership');

      // Check if this is a new user (for activation logic)
      const existingUser = await prisma.user.findUnique({
        where: { externalId },
        select: { id: true, isActivated: true, activatedAt: true },
      });

      // New users: isActivated = false (unless admin, who are auto-activated)
      // Existing users: preserve their activation status
      // Admins are always auto-activated to prevent lockout
      const isNewUser = !existingUser;
      const shouldAutoActivate = isAdmin;

      // Upsert user in database with activation logic
      const user = await prisma.user.upsert({
        where: { externalId },
        create: {
          externalId,
          email,
          displayName,
          isAdmin,
          // New admins are auto-activated, regular users need approval
          isActivated: shouldAutoActivate,
          activatedAt: shouldAutoActivate ? new Date() : null,
          activatedBy: shouldAutoActivate ? 'system-admin-group' : null,
        },
        update: {
          email,
          displayName,
          isAdmin, // Update admin status on each login
          // If user becomes admin, auto-activate them
          ...(shouldAutoActivate && !existingUser?.isActivated ? {
            isActivated: true,
            activatedAt: existingUser?.activatedAt ?? new Date(),
            activatedBy: existingUser?.activatedAt ? undefined : 'system-admin-group',
          } : {}),
        },
      });

      logger.info(
        { userId: user.id, externalId, isAdmin, isActivated: user.isActivated, isNewUser },
        'User authenticated successfully'
      );

      // Set session with activation status
      const session = request.session as any;
      session.user = {
        id: user.id,
        externalId: user.externalId,
        email: user.email || '',
        displayName: user.displayName || '',
        isAdmin: user.isAdmin,
        isActivated: user.isActivated,
        // Track if account was ever activated (for disabled vs pending distinction)
        wasEverActivated: !!user.activatedAt,
      };
      
      // Store id_token for logout
      session.idToken = tokens.id_token;

      await request.session.save();

      // Redirect based on activation status
      const returnTo = session.returnTo || '/';
      delete session.returnTo;

      // If not activated, redirect to appropriate page
      if (!user.isActivated) {
        // If never activated (activatedAt is null), show pending approval page
        // If was activated before but now disabled, show account disabled page
        if (user.activatedAt) {
          return reply.redirect('/account-disabled');
        } else {
          return reply.redirect('/pending-approval');
        }
      }

      return reply.redirect(returnTo);
    } catch (err) {
      logger.error({ err }, 'OIDC callback failed');
      return reply.redirect('/?error=auth_failed');
    }
  });

  // Logout - clears local session and fully logs out of Authentik
  app.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    
    if (user) {
      logger.info({ userId: user.id }, 'User logging out');
    }

    const session = request.session as any;
    const idToken = session.idToken;
    session.user = null;
    session.idToken = null;
    session.destroy();
    
    // Determine if this is remote access (via Cloudflare) or local access
    const requestHost = request.headers.host || '';
    const baseUrlHost = new URL(config.baseUrl).host;
    // Remote access: host matches BASE_URL (e.g., gates.aztelar.com) or has cf-ray header
    const isRemoteAccess = requestHost === baseUrlHost || !!request.headers['cf-ray'];
    
    // Use appropriate URLs based on access type
    const effectiveBaseUrl = isRemoteAccess 
      ? config.baseUrl  // Remote: use configured base URL (e.g., https://gates.aztelar.com)
      : `https://${requestHost}`;  // Local: use request host (e.g., https://garagepi.local:9443)
    const effectiveAuthUrl = isRemoteAccess
      ? config.authentik.externalUrl  // Remote: use external auth URL (e.g., https://gates-auth.aztelar.com)
      : config.authentik.localUrl;  // Local: use local auth URL (e.g., https://garagepi.local:9443)
    
    // Use OIDC end-session endpoint with id_token_hint for proper SSO logout
    try {
      const oidc = await getOidcConfig();
      let logoutUrl = openidClient.buildEndSessionUrl(oidc, {
        id_token_hint: idToken,
        post_logout_redirect_uri: effectiveBaseUrl,
      });
      
      // Replace internal Authentik URL with appropriate external URL for browser access
      const externalLogoutUrl = logoutUrl.href.replace(config.authentik.url, effectiveAuthUrl);
      
      logger.info({ 
        isRemoteAccess, 
        effectiveBaseUrl, 
        effectiveAuthUrl, 
        externalLogoutUrl,
        requestHost,
      }, 'Built logout URL');
      
      return reply.send({ 
        success: true, 
        message: 'Logged out successfully',
        logoutUrl: externalLogoutUrl,
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to build end session URL, redirecting to base URL');
      return reply.send({ 
        success: true, 
        message: 'Logged out successfully',
      });
    }
  });

  // Get logout (for redirect-based logout with SSO logout)
  app.get('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    
    if (user) {
      logger.info({ userId: user.id }, 'User logging out');
    }

    const session = request.session as any;
    const idToken = session.idToken;
    session.user = null;
    session.idToken = null;
    session.destroy();
    
    // Determine if this is remote access (via Cloudflare) or local access
    const requestHost = request.headers.host || '';
    const baseUrlHost = new URL(config.baseUrl).host;
    // Remote access: host matches BASE_URL (e.g., gates.aztelar.com) or has cf-ray header
    const isRemoteAccess = requestHost === baseUrlHost || !!request.headers['cf-ray'];
    
    // Use appropriate URLs based on access type
    const effectiveBaseUrl = isRemoteAccess 
      ? config.baseUrl  // Remote: use configured base URL (e.g., https://gates.aztelar.com)
      : `https://${requestHost}`;  // Local: use request host (e.g., https://garagepi.local:9443)
    const effectiveAuthUrl = isRemoteAccess
      ? config.authentik.externalUrl  // Remote: use external auth URL (e.g., https://gates-auth.aztelar.com)
      : config.authentik.localUrl;  // Local: use local auth URL (e.g., https://garagepi.local:9443)
    
    // Use OIDC end-session endpoint
    try {
      const oidc = await getOidcConfig();
      let logoutUrl = openidClient.buildEndSessionUrl(oidc, {
        id_token_hint: idToken,
        post_logout_redirect_uri: effectiveBaseUrl,
      });
      
      // Replace internal Authentik URL with appropriate external URL for browser access
      const externalLogoutUrl = logoutUrl.href.replace(config.authentik.url, effectiveAuthUrl);
      
      return reply.redirect(externalLogoutUrl);
    } catch (err) {
      logger.warn({ err }, 'Failed to build end session URL, redirecting to base URL');
      return reply.redirect(effectiveBaseUrl);
    }
  });
}
