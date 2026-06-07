import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { getConnectedCount } from '../websocket/broadcast.js';

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /dashboard/stats — indicateurs nationaux
  fastify.get(
    '/dashboard/stats',
    { preHandler: [requireAuth, requireRole('field_agent', 'local_validator', 'territory_admin', 'humanitarian_partner', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const user = request.jwtUser;
      const scopeFilter = user.scope.length > 0
        ? sql`AND (e.location_pcode = ANY(${user.scope}) OR e.affected_pcodes && ${user.scope}::text[])`
        : sql``;

      const [counts] = await sql`
        SELECT
          COUNT(*) FILTER (WHERE e.status = 'active')                                  AS active_events,
          COUNT(*) FILTER (WHERE e.status IN ('reported','under_review'))               AS pending_events,
          COUNT(*) FILTER (WHERE e.severity IN ('Severe','Extreme') AND e.status = 'active') AS critical_events,
          COUNT(*) FILTER (WHERE e.start_date >= NOW() - INTERVAL '24 hours')           AS events_24h,
          COUNT(*) FILTER (WHERE e.start_date >= NOW() - INTERVAL '7 days')             AS events_7d,
          COALESCE(SUM(e.estimated_affected) FILTER (WHERE e.status = 'active'), 0)     AS total_affected
        FROM disaster_events e
        WHERE e.deleted_at IS NULL ${scopeFilter}
      `;

      const hazardBreakdown = await sql`
        SELECT hazard_type, COUNT(*) AS count
        FROM disaster_events
        WHERE status = 'active' AND deleted_at IS NULL ${scopeFilter}
        GROUP BY hazard_type ORDER BY count DESC
      `;

      const trend = await sql`
        SELECT day, SUM(count)::int AS count
        FROM events_daily_trend
        GROUP BY day ORDER BY day
      `;

      const topProvinces = await sql`
        SELECT pcode, province_name, active_events, severe_events, total_affected
        FROM province_stats
        ORDER BY severe_events DESC, active_events DESC
        LIMIT 10
      `;

      const [modQueue] = await sql`
        SELECT COUNT(*) AS pending FROM moderation_queue WHERE resolved_at IS NULL
      `;

      return reply.send({
        success: true,
        data: {
          counts: {
            activeEvents: Number(counts.activeEvents),
            pendingEvents: Number(counts.pendingEvents),
            criticalEvents: Number(counts.criticalEvents),
            events24h: Number(counts.events24h),
            events7d: Number(counts.events7d),
            totalAffected: Number(counts.totalAffected),
            moderationQueue: Number(modQueue.pending),
            wsConnected: getConnectedCount(),
          },
          hazardBreakdown,
          trend,
          topProvinces,
        },
      });
    },
  );

  // GET /dashboard/map-data — données légères pour la carte (sans géométrie complète)
  fastify.get('/dashboard/map-data', async (_request, reply) => {
    const events = await sql`
      SELECT
        id, title, hazard_type, status, severity,
        location_pcode, location_name,
        estimated_affected,
        start_date,
        ST_X(location_point) AS lng,
        ST_Y(location_point) AS lat,
        ARRAY_LENGTH(affected_pcodes, 1) AS province_count
      FROM disaster_events
      WHERE deleted_at IS NULL
        AND status NOT IN ('rejected', 'resolved')
        AND location_point IS NOT NULL
      ORDER BY start_date DESC
      LIMIT 500
    `;

    return reply.send({ success: true, data: events });
  });

  // GET /dashboard/export.csv — export CSV avec tags HXL
  fastify.get(
    '/dashboard/export.csv',
    { preHandler: [requireAuth, requireRole('territory_admin', 'humanitarian_partner', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { dateFrom, dateTo, province } = z.object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        province: z.string().optional(),
      }).parse(request.query);

      const rows = await sql`
        SELECT
          e.id,
          e.title,
          e.hazard_type,
          e.status,
          e.severity,
          e.location_pcode,
          e.location_name,
          e.estimated_affected,
          e.start_date,
          e.source,
          e.glide_number,
          ST_X(e.location_point) AS longitude,
          ST_Y(e.location_point) AS latitude,
          u.display_name AS reported_by
        FROM disaster_events e
        LEFT JOIN users u ON u.id = e.reported_by_id
        WHERE e.deleted_at IS NULL
          ${dateFrom ? sql`AND e.start_date >= ${dateFrom}::timestamptz` : sql``}
          ${dateTo ? sql`AND e.start_date <= ${dateTo}::timestamptz` : sql``}
          ${province ? sql`AND (e.location_pcode = ${province} OR ${province} = ANY(e.affected_pcodes))` : sql``}
        ORDER BY e.start_date DESC
        LIMIT 10000
      `;

      // En-têtes HXL (Humanitarian Exchange Language)
      const hxlHeaders = [
        '#id', '#event+type', '#event+name', '#status', '#severity',
        '#adm1+pcode', '#adm1+name', '#affected+num', '#date+occurred',
        '#meta+source', '#meta+glide', '#geo+lon', '#geo+lat', '#meta+reporter',
      ].join(',');

      const csvHeaders = [
        'ID', 'Type', 'Titre', 'Statut', 'Gravité',
        'Province P-code', 'Province', 'Affectés (estimé)', 'Date début',
        'Source', 'GLIDE', 'Longitude', 'Latitude', 'Signalé par',
      ].join(',');

      const csvRows = rows.map((r) =>
        [
          r.id, r.hazardType, `"${r.title.replace(/"/g, '""')}"`,
          r.status, r.severity, r.locationPcode, `"${r.locationName}"`,
          r.estimatedAffected ?? '', r.startDate.toISOString().slice(0, 10),
          r.source, r.glideNumber ?? '', r.longitude ?? '', r.latitude ?? '',
          `"${(r.reportedBy ?? '').replace(/"/g, '""')}"`,
        ].join(','),
      );

      const csv = [csvHeaders, hxlHeaders, ...csvRows].join('\n');

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="sinaur-events.csv"');
      return reply.send(csv);
    },
  );

  // POST /dashboard/refresh-stats — rafraîchit les vues matérialisées
  fastify.post(
    '/dashboard/refresh-stats',
    { preHandler: [requireAuth, requireRole('system_admin')] },
    async (_request, reply) => {
      await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY province_stats`;
      await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY current_risk_scores`.catch(() => {});
      return reply.send({ success: true, data: { message: 'Vues matérialisées rafraîchies' } });
    },
  );
}
