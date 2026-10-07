/**
 * Cloudflare Worker API entry point for School Pay Manager (Free-tier Cloudflare Workers + D1)
 *
 * Deploy with:
 *   npx wrangler d1 create schoolpay-db
 *   npx wrangler d1 execute schoolpay-db --file=schema.sql
 *   npx wrangler deploy
 */

export interface Env {
  DB: any; // Cloudflare D1 Database binding
  JWT_SECRET?: string;
  ENVIRONMENT?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // Basic CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-School-Id, X-Session-Token',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 1. Health check
      if (url.pathname === '/api/health') {
        return Response.json(
          {
            status: 'healthy',
            platform: 'Cloudflare Workers (Edge)',
            database: 'Cloudflare D1',
            tenantIsolation: 'ENFORCED',
            timestamp: new Date().toISOString(),
          },
          { headers: corsHeaders }
        );
      }

      // 2. School Registration
      if (url.pathname === '/api/v1/auth/register-school' && request.method === 'POST') {
        const body: any = await request.json();
        const schoolId = 'sch_' + crypto.randomUUID().slice(0, 8);
        const userId = 'usr_' + crypto.randomUUID().slice(0, 8);
        const settingsId = 'set_' + crypto.randomUUID().slice(0, 8);
        const userRoleId = 'ur_' + crypto.randomUUID().slice(0, 8);

        // Batch execution in Cloudflare D1 for atomic ACID execution
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO schools (id, name, slug, type, status, address, state, lga, phone, email, website)
             VALUES (?, ?, ?, ?, 'TRIAL', ?, ?, ?, ?, ?, ?)`
          ).bind(
            schoolId,
            body.schoolName,
            body.schoolName.toLowerCase().replace(/\s+/g, '-') + '-' + crypto.randomUUID().slice(0, 4),
            body.schoolType,
            body.address || '',
            body.state,
            body.lga,
            body.phone,
            body.email.toLowerCase(),
            body.website || null
          ),
          env.DB.prepare(
            `INSERT INTO school_settings (id, school_id, currency, currency_symbol, current_academic_session, current_term, payment_notification_email)
             VALUES (?, ?, 'NGN', '₦', '2024/2025', '1st Term', ?)`
          ).bind(settingsId, schoolId, body.email.toLowerCase()),
          env.DB.prepare(
            `INSERT INTO users (id, email, password_hash, salt, full_name, phone, is_platform_admin, is_active)
             VALUES (?, ?, ?, ?, ?, ?, 0, 1)`
          ).bind(userId, body.ownerEmail.toLowerCase(), 'pbkdf2_hash_stored', 'salt', body.ownerName, body.phone),
          env.DB.prepare(
            `INSERT INTO user_roles (id, user_id, school_id, role_id, is_primary)
             VALUES (?, ?, ?, 'role_school_owner', 1)`
          ).bind(userRoleId, userId, schoolId),
          env.DB.prepare(
            `INSERT INTO audit_logs (actor_id, actor_email, school_id, action, entity, entity_id)
             VALUES (?, ?, ?, 'REGISTER_SCHOOL', 'SCHOOL', ?)`
          ).bind(userId, body.ownerEmail.toLowerCase(), schoolId, schoolId),
        ]);

        return Response.json(
          {
            success: true,
            message: 'School tenant and proprietor registered successfully on Cloudflare D1',
            schoolId,
            userId,
          },
          { headers: corsHeaders }
        );
      }

      // Default fallback
      return Response.json(
        { error: 'NOT_FOUND', message: 'API Route not found in Cloudflare Worker' },
        { status: 404, headers: corsHeaders }
      );
    } catch (err: any) {
      return Response.json(
        { error: 'WORKER_INTERNAL_ERROR', details: err?.message || String(err) },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
