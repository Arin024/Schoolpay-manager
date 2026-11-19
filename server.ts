import dotenv from 'dotenv';
import fs from 'node:fs';

// Guard Linux glibc memory arenas on low-memory containers (Render Free 512MB RAM)
if (!process.env.MALLOC_ARENA_MAX) {
  process.env.MALLOC_ARENA_MAX = '2';
}

import { ensureNeonEnvironment } from './server/neonEnvResolver.ts';

if (fs.existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' });
} else {
  dotenv.config();
}

// Disable HMR in AI Studio cloud environment as documented in vite.config.ts
process.env.DISABLE_HMR = 'true';

import express from 'express';
// Note: Vite dev server is dynamically loaded only in development mode to save ~50MB RAM in production
import path from 'node:path';
import { initDatabase, isPgConnected, ensurePgConnected, getPgStatus, getPgEndpointHostPrefix } from './server/db.ts';
import { apiRouter } from './server/routes.ts';

async function startServer() {
  const app = express();
  // In AI Studio preview environment, always bind to 3000. On Render (process.env.RENDER or PORT !== 8080), use process.env.PORT.
  const PORT = process.env.RENDER ? (process.env.PORT ? parseInt(process.env.PORT, 10) : 10000) : 3000;

  // Trust Cloud Run / reverse proxy headers
  app.set('trust proxy', 1);

  // Ensure Neon PostgreSQL environment is resolved and available
  await ensureNeonEnvironment();

  // Initialize multi-tenant database & hydration
  await initDatabase();

  // Strict Production Enforcement: In production, fail startup if PostgreSQL is required but offline
  if (process.env.NODE_ENV === 'production' && process.env.REQUIRE_POSTGRES === 'true' && !isPgConnected()) {
    console.error('[FATAL ERROR] Production startup aborted: REQUIRE_POSTGRES=true is set, but authoritative Neon PostgreSQL is disconnected.');
    process.exit(1);
  }

  app.disable('x-powered-by');

  // Strict CORS Allowlist Middleware for multi-domain support (bursariq.com.ng, subdomains, cloud run, localhost)
  const extraAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean);

  function isOriginAllowed(origin: string): boolean {
    try {
      const url = new URL(origin);
      const hostname = url.hostname.toLowerCase();
      if (extraAllowedOrigins.includes(origin.toLowerCase())) return true;
      if (hostname === 'bursariq.com.ng' || hostname.endsWith('.bursariq.com.ng')) return url.protocol === 'https:';
      if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
      if (hostname.endsWith('.run.app') || hostname.endsWith('.aistudio.google.com') || hostname === 'aistudio.google.com') {
        return url.protocol === 'https:';
      }
      return false;
    } catch {
      return false;
    }
  }

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      if (isOriginAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
      } else if (req.method === 'OPTIONS') {
        return res.status(403).json({ error: 'CORS_ORIGIN_FORBIDDEN', message: 'Origin is not permitted.' });
      }
    }
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-School-Id, X-Session-Token'
    );

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });

  // Middleware: Request Parsing & Security Headers
  // Preserve raw request body string for cryptographic HMAC webhook signature validation
  app.use(
    express.json({
      limit: '8mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));

  // Durable Database Protection Guard
  // In production/configured environment, attempt reconnection on cold wake-up before rejecting mutations
  app.use(async (req, res, next) => {
    const mustBeOnPostgres =
      process.env.NODE_ENV === 'production' ||
      process.env.REQUIRE_POSTGRES === 'true' ||
      Boolean(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (mustBeOnPostgres && !isPgConnected()) {
        const reconnected = await ensurePgConnected();
        if (!reconnected) {
          return res.status(503).json({
            error: 'DATABASE_UNAVAILABLE',
            message: 'Durable database connection to Neon PostgreSQL is temporarily unavailable. Modifying operations are blocked to prevent uncommitted state. Please retry in a moment.',
            code: 'DURABLE_STORAGE_OFFLINE',
          });
        }
      }
    }
    next();
  });

  // In-memory rate limiting map (IP:bucket -> timestamps) with bounded cleanup
  const rateLimitMap = new Map<string, number[]>();
  const rateLimitCleanup = setInterval(() => {
    const cutoff = Date.now() - 120 * 1000;
    for (const [key, timestamps] of rateLimitMap.entries()) {
      const active = timestamps.filter((ts) => ts > cutoff);
      if (active.length === 0) rateLimitMap.delete(key);
      else rateLimitMap.set(key, active);
    }
  }, 5 * 60 * 1000);
  if (rateLimitCleanup.unref) rateLimitCleanup.unref();

  app.use((req, res, next) => {
    // Hardened HTTP security headers (iframe-compatible for AI Studio preview)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'"
    );
    if (process.env.NODE_ENV === 'production' || req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // Rate-limiting across all auth & recovery mount aliases
    const lowerPath = req.path.toLowerCase();
    const isAuthRoute =
      lowerPath.startsWith('/api/v1/auth') ||
      lowerPath.startsWith('/api/auth') ||
      lowerPath.startsWith('/v1/auth') ||
      lowerPath.startsWith('/auth');
    const isSensitiveAuthAction =
      isAuthRoute &&
      (lowerPath.includes('/login') ||
        lowerPath.includes('/forgot-password') ||
        lowerPath.includes('/reset-password') ||
        lowerPath.includes('/recovery/') ||
        lowerPath.includes('/register'));

    if (isAuthRoute) {
      const clientIp = (req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1').split(',')[0].trim();
      const bucketKey = `${clientIp}:${isSensitiveAuthAction ? 'strict' : 'auth'}`;
      const limit = isSensitiveAuthAction ? 25 : 100;
      const now = Date.now();
      const windowMs = 60 * 1000;
      const history = rateLimitMap.get(bucketKey) || [];
      const recent = history.filter((ts) => now - ts < windowMs);

      if (recent.length >= limit) {
        return res.status(429).json({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many authentication or recovery requests. Please wait 60 seconds and try again.',
        });
      }
      recent.push(now);
      if (rateLimitMap.size > 5000) rateLimitMap.clear();
      rateLimitMap.set(bucketKey, recent);
    }

    next();
  });

  // Prevent edge/carrier/browser proxies from ever caching dynamic API responses or transient errors
  app.use(['/api', '/api/v1', '/v1', '/health'], (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // Mount API Router on /api and aliases (/v1, /api/v1) to guarantee zero routing divergence
  app.use('/api', apiRouter);
  app.use('/api/v1', apiRouter);
  app.use('/v1', (req, res, next) => {
    req.url = '/v1' + req.url;
    apiRouter(req, res, next);
  });

  // Serve static assets from public (robots.txt, sitemap.xml, og-image.png, icons, etc.)
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));

  // Lightweight Production Memory Heartbeat (Logs once every 15 minutes, unrefed)
  const memMonitorInterval = setInterval(() => {
    const mem = process.memoryUsage();
    const rssMb = (mem.rss / 1024 / 1024).toFixed(1);
    const heapUsedMb = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const heapTotalMb = (mem.heapTotal / 1024 / 1024).toFixed(1);
    const extMb = (mem.external / 1024 / 1024).toFixed(1);
    console.log(`[Memory Monitor] RSS: ${rssMb}MB | Heap: ${heapUsedMb}MB / ${heapTotalMb}MB | Ext: ${extMb}MB`);

    // If RSS approaches 85% of Render Free limit (512MB), request garbage collection if exposed
    if (mem.rss > 420 * 1024 * 1024 && (global as any).gc) {
      console.warn('[Memory Monitor] RSS exceeded 420MB threshold. Triggering manual GC.');
      (global as any).gc();
    }
  }, 15 * 60 * 1000);
  if (memMonitorInterval.unref) memMonitorInterval.unref();

  // Health check endpoint with sanitized status telemetry (zero DB usernames/credentials exposed)
  app.get(['/api/health', '/health'], async (_req, res) => {
    if (!isPgConnected()) {
      await ensurePgConnected();
    }
    const rawPgStatus = getPgStatus();
    const safePgStatus = rawPgStatus
      ? {
          status: rawPgStatus.status,
          connectedAt: rawPgStatus.connectedAt,
          reconnectedAt: rawPgStatus.reconnectedAt,
          endpoint: rawPgStatus.endpoint,
        }
      : null;
    res.json({
      status: 'healthy',
      service: 'BursarIQ API',
      version: '1.0.0',
      commit: process.env.RENDER_GIT_COMMIT || 'local',
      database: isPgConnected() ? 'Neon PostgreSQL (Durable Serverless)' : 'SQLite (Local Engine)',
      neonConnected: isPgConnected(),
      neonEndpoint: getPgEndpointHostPrefix(),
      neonStatus: safePgStatus,
      tenantIsolation: 'ENFORCED',
      timestamp: new Date().toISOString(),
    });
  });

  // Dedicated catch-all for unhandled API routes: ALWAYS return JSON 404, NEVER fall through to HTML SPA
  app.all(['/api', '/api/*', '/api/v1/*', '/v1/*', '/auth', '/auth/*'], (req, res) => {
    res.status(404).json({
      error: 'ENDPOINT_NOT_FOUND',
      message: `The requested API endpoint ${req.method} ${req.originalUrl || req.path} was not found on this server.`,
    });
  });

  // Strict API guard: Any request accepting JSON or targeting an API-like route must NEVER receive HTML SPA
  app.use((req, res, next) => {
    const isApiRequest =
      req.path.startsWith('/api') ||
      req.path.startsWith('/v1') ||
      req.path.startsWith('/auth') ||
      (req.headers.accept?.includes('application/json') && !req.path.includes('.'));

    if (isApiRequest) {
      return res.status(404).json({
        error: 'ENDPOINT_NOT_FOUND',
        message: `The requested endpoint ${req.method} ${req.originalUrl || req.path} was not found.`,
      });
    }
    next();
  });

  // Dedicated error handler for API routes: ALWAYS return JSON, NEVER leak internal stacks or SQL errors
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/v1') ||
      req.path.startsWith('/auth') ||
      req.headers.accept?.includes('application/json')
    ) {
      console.error('[API Error]', err);
      const status = typeof err.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
      const clientMessage = status >= 500
        ? 'An unexpected internal server error occurred. Please try again.'
        : (err.message || 'Invalid request.');
      return res.status(status).json({
        error: err.code || 'SERVER_ERROR',
        message: clientMessage,
      });
    }
    next(err);
  });

  // In development, dynamically hook into Vite middlewares for React SPA
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.RENDER) ||
    fs.existsSync(path.resolve(process.cwd(), 'dist', 'index.html'));

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: process.cwd(),
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In production serve dist static assets with revalidation header for index.html & SW
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distPath, {
        etag: true,
        lastModified: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html') || filePath.endsWith('sw.js') || filePath.endsWith('.webmanifest')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`  SCHOOL PAY MANAGER - STEP 1 FOUNDATION SERVER`);
    console.log(`  Running on: http://0.0.0.0:${PORT}`);
    console.log(`  Multi-Tenant Guard: ACTIVE`);
    console.log(`  Platform Super Admin: SchoolPay28@gmail.com`);
    console.log(`=======================================================`);
  });

  // Align Node HTTP keep-alive timeouts above Cloudflare/Render 60s upstream idle timeout
  // to prevent spurious 502 / connection-reset errors when proxy reuses pooled sockets.
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
