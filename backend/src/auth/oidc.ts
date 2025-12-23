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

// Allow HTTP in development (openid-client requires HTTPS by default)
const execute: openidClient.CustomFetch | undefined = config.nodeEnv === 'development' 
  ? (...args) => openidClient.customFetch(...args)
  : undefined;

async function getOidcConfig(): Promise<openidClient.Configuration> {
  if (oidcConfig) return oidcConfig;

  const issuerUrl = new URL(`${config.authentik.url}/application/o/${config.authentik.slug}/`);

  try {
    oidcConfig = await openidClient.discovery(issuerUrl, config.authentik.clientId, {
      client_secret: config.authentik.clientSecret,
    }, undefined, {
      execute: config.nodeEnv === 'development' ? [openidClient.allowInsecureRequests] : undefined,
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

      // Build authorization URL
      const redirectUri = `${config.baseUrl}/api/auth/callback`;
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
        config.authentik.externalUrl
      );

      logger.info({ authUrl: externalAuthUrl }, 'Redirecting to OIDC provider');
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
      const redirectUri = `${config.baseUrl}/api/auth/callback`;

      // Exchange code for tokens
      const currentUrl = new URL(request.url, config.baseUrl);
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

      // Upsert user in database
      const user = await prisma.user.upsert({
        where: { externalId },
        create: {
          externalId,
          email,
          displayName,
          isAdmin,
        },
        update: {
          email,
          displayName,
          isAdmin, // Update admin status on each login
        },
      });

      logger.info({ userId: user.id, externalId, isAdmin }, 'User authenticated successfully');

      // Set session
      const session = request.session as any;
      session.user = {
        id: user.id,
        externalId: user.externalId,
        email: user.email || '',
        displayName: user.displayName || '',
        isAdmin: user.isAdmin,
      };
      
      // Store id_token for logout
      session.idToken = tokens.id_token;

      await request.session.save();

      // Redirect to original destination
      const returnTo = session.returnTo || '/';
      delete session.returnTo;

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
    
    // Use OIDC end-session endpoint with id_token_hint for proper SSO logout
    try {
      const oidc = await getOidcConfig();
      let logoutUrl = openidClient.buildEndSessionUrl(oidc, {
        id_token_hint: idToken,
        post_logout_redirect_uri: config.baseUrl,
      });
      
      // Replace internal Authentik URL with external URL for browser access
      const externalLogoutUrl = logoutUrl.href.replace(config.authentik.url, config.authentik.externalUrl);
      
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
    
    // Use OIDC end-session endpoint
    try {
      const oidc = await getOidcConfig();
      let logoutUrl = openidClient.buildEndSessionUrl(oidc, {
        id_token_hint: idToken,
        post_logout_redirect_uri: config.baseUrl,
      });
      
      // Replace internal Authentik URL with external URL for browser access
      const externalLogoutUrl = logoutUrl.href.replace(config.authentik.url, config.authentik.externalUrl);
      
      return reply.redirect(externalLogoutUrl);
    } catch (err) {
      logger.warn({ err }, 'Failed to build end session URL, redirecting to base URL');
      return reply.redirect(config.baseUrl);
    }
  });
}
