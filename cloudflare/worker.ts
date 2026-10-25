/**
 * Cloudflare Worker API entry point for BursarIQ (bursariq.com.ng)
 *
 * Architecture:
 * 1. Serves the precompiled React PWA static assets from dist/ via Cloudflare Assets (env.ASSETS).
 * 2. SPA Fallback: non-API client routes (e.g. /dashboard, /invoices, /login) serve /index.html.
 * 3. Proxies all /api/*, /v1/*, and /auth/* requests to the authoritative backend.
 * 4. Passes credentials, authorization, cookies, methods, and request bodies cleanly.
 * 5. Returns strict JSON error responses for API failures with no caching on private endpoints.
 */

export interface Env {
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
  DB?: any; // Cloudflare D1 Database binding (optional)
  JWT_SECRET?: string;
  ENVIRONMENT?: string;
  BACKEND_ORIGIN?: string;
}

const DEFAULT_BACKEND_ORIGIN = 'https://www.bursariq.com.ng';

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // Standard CORS headers
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
      'Access-Control-Allow-Headers':
        'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-School-Id, X-Session-Token',
      'Access-Control-Allow-Credentials': 'true',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Edge Health Check Endpoint
    if (url.pathname === '/api/health' || url.pathname === '/health') {
      return Response.json(
        {
          status: 'healthy',
          service: 'BursarIQ Edge Gateway',
          platform: 'Cloudflare Worker + Static Assets',
          tenantIsolation: 'ENFORCED',
          backendOrigin: env.BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN,
          timestamp: new Date().toISOString(),
        },
        { headers: { ...corsHeaders, 'Cache-Control': 'no-cache, no-store, must-revalidate' } }
      );
    }

    // 1. API PROXY ROUTING (/api/*, /v1/*, /auth/*)
    const isApiRequest =
      url.pathname.startsWith('/api') ||
      url.pathname.startsWith('/v1') ||
      url.pathname.startsWith('/auth');

    if (isApiRequest) {
      const backendOrigin = env.BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN;
      const targetUrl = new URL(url.pathname + url.search, backendOrigin);

      // Clone headers and rewrite Host for Google Cloud Run compatibility
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', new URL(backendOrigin).host);
      newHeaders.set('X-Forwarded-Host', url.host);
      newHeaders.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

      try {
        const originResponse = await fetch(targetUrl.toString(), {
          method: request.method,
          headers: newHeaders,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
          redirect: 'follow',
        });

        // Merge CORS headers and ensure financial/auth responses are NEVER cached in public caches
        const responseHeaders = new Headers(originResponse.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => {
          responseHeaders.set(k, v);
        });

        // Guarantee no-store on private financial and student APIs
        responseHeaders.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');

        return new Response(originResponse.body, {
          status: originResponse.status,
          statusText: originResponse.statusText,
          headers: responseHeaders,
        });
      } catch (err: any) {
        return Response.json(
          {
            error: 'BACKEND_GATEWAY_ERROR',
            message: 'Unable to reach BursarIQ core API server. Please retry in a few moments.',
            details: err?.message || String(err),
          },
          {
            status: 502,
            headers: { ...corsHeaders, 'Cache-Control': 'no-cache, no-store, must-revalidate' },
          }
        );
      }
    }

    // 2. STATIC ASSETS & SPA ROUTING VIA CLOUDFLARE ASSETS
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      try {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) {
          // Asset found (e.g. /index.html, /manifest.webmanifest, /sw.js, /assets/*)
          const assetHeaders = new Headers(assetResponse.headers);
          if (
            url.pathname === '/' ||
            url.pathname.endsWith('.html') ||
            url.pathname.endsWith('sw.js') ||
            url.pathname.endsWith('.webmanifest')
          ) {
            assetHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else if (url.pathname.startsWith('/assets/')) {
            assetHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
          }
          return new Response(assetResponse.body, {
            status: assetResponse.status,
            statusText: assetResponse.statusText,
            headers: assetHeaders,
          });
        }

        // SPA Fallback: If static asset is 404 and this is a browser navigation request (no file extension)
        if (!url.pathname.includes('.')) {
          const spaIndexUrl = new URL('/index.html', url.origin);
          const spaResponse = await env.ASSETS.fetch(new Request(spaIndexUrl.toString(), request));
          if (spaResponse.status === 200) {
            const spaHeaders = new Headers(spaResponse.headers);
            spaHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            return new Response(spaResponse.body, {
              status: 200,
              headers: spaHeaders,
            });
          }
        }

        return assetResponse;
      } catch (assetErr) {
        // Fallback to origin proxy below if asset fetching throws
      }
    }

    // 3. FALLBACK PROXY: If ASSETS is unconfigured, proxy web request to origin
    const backendOrigin = env.BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN;
    const targetUrl = new URL(url.pathname + url.search, backendOrigin);
    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', new URL(backendOrigin).host);
    newHeaders.set('X-Forwarded-Host', url.host);
    newHeaders.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

    try {
      const originResponse = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: newHeaders,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'follow',
      });
      return originResponse;
    } catch (err: any) {
      return Response.json(
        {
          error: 'GATEWAY_ORIGIN_UNREACHABLE',
          message: 'Unable to reach BursarIQ origin server.',
          details: err?.message || String(err),
        },
        { status: 502, headers: corsHeaders }
      );
    }
  },
};
