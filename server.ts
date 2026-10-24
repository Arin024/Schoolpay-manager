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
import { initDatabase, isPgConnected, getPgStatus } from './server/db.ts';
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

  // Robust CORS Middleware for multi-domain support (bursariq.com.ng, subdomains, cloud run, localhost)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
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
      limit: '1mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));

  // Durable Database Protection Guard
  // In production/configured environment, reject modifying operations if Neon PostgreSQL is offline
  app.use((req, res, next) => {
    // If running in production or REQUIRE_POSTGRES is enabled or DATABASE_URL is configured, block mutations if PostgreSQL is offline
    const mustBeOnPostgres = process.env.NODE_ENV === 'production' || process.env.REQUIRE_POSTGRES === 'true' || Boolean(process.env.DATABASE_URL);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (mustBeOnPostgres && !isPgConnected()) {
        return res.status(503).json({
          error: 'DATABASE_UNAVAILABLE',
          message: 'Durable database connection to Neon PostgreSQL is offline. Modifying operations are strictly blocked to prevent uncommitted or divergent state.',
          code: 'DURABLE_STORAGE_OFFLINE',
        });
      }
    }
    next();
  });

  // Basic in-memory rate limiting map (IP -> timestamps)
  const rateLimitMap = new Map<string, number[]>();
  app.use((req, res, next) => {
    // Custom security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Simple rate-limiting for auth routes (100 reqs / min)
    if (req.path.startsWith('/api/v1/auth')) {
      const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || '127.0.0.1';
      const now = Date.now();
      const windowMs = 60 * 1000;
      const history = rateLimitMap.get(clientIp) || [];
      const recent = history.filter((ts) => now - ts < windowMs);

      if (recent.length >= 100) {
        return res.status(429).json({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again after 60 seconds.',
        });
      }
      recent.push(now);
      rateLimitMap.set(clientIp, recent);
    }

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

  // Health check endpoint with lightweight memory telemetry
  app.get(['/api/health', '/health'], (req, res) => {
    const mem = process.memoryUsage();
    res.json({
      status: 'healthy',
      service: 'BursarIQ API',
      version: '1.0.0',
      database: isPgConnected() ? 'Neon PostgreSQL (Durable Serverless)' : 'SQLite (Local Engine)',
      neonStatus: getPgStatus(),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        externalMb: Math.round(mem.external / 1024 / 1024),
      },
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

  // Dedicated error handler for API routes: ALWAYS return JSON, NEVER leak HTML error stacks
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/v1') ||
      req.path.startsWith('/auth') ||
      req.headers.accept?.includes('application/json')
    ) {
      console.error('[API Error]', err);
      return res.status(err.status || 500).json({
        error: err.code || 'SERVER_ERROR',
        message: err.message || 'An unexpected internal server error occurred.',
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`  SCHOOL PAY MANAGER - STEP 1 FOUNDATION SERVER`);
    console.log(`  Running on: http://0.0.0.0:${PORT}`);
    console.log(`  Multi-Tenant Guard: ACTIVE`);
    console.log(`  Platform Super Admin: SchoolPay28@gmail.com`);
    console.log(`=======================================================`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
