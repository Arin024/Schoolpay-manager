import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { initDatabase } from './server/db.js';
import { apiRouter } from './server/routes.js';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize SQLite multi-tenant database & default seeds
  initDatabase();

  // Middleware: Request Parsing & Security Headers
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Basic in-memory rate limiting map (IP -> timestamps)
  const rateLimitMap = new Map<string, number[]>();
  app.use((req, res, next) => {
    // Custom security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
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

  // Mount API Router on /api
  app.use('/api', apiRouter);

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'healthy',
      service: 'School Pay Manager API',
      version: '1.0.0-step1',
      tenantIsolation: 'ENFORCED',
      timestamp: new Date().toISOString(),
    });
  });

  // In development, hook into Vite middlewares for React SPA
  if (process.env.NODE_ENV !== 'production') {
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
    // In production serve dist static assets
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`  SCHOOL PAY MANAGER - STEP 1 FOUNDATION SERVER`);
    console.log(`  Running on: http://0.0.0.0:${PORT}`);
    console.log(`  Multi-Tenant Guard: ACTIVE`);
    console.log(`  Platform Super Admin: superadmin@schoolpay.ng`);
    console.log(`=======================================================`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
