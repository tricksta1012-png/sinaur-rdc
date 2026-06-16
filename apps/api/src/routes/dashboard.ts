import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireAuth, requireRole } from '../auth/jwt.js';
import { getConnectedCount } from '../websocket/broadcast.js';
import { cGet, cSet } from '../lib/cache.js';

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /dashboard/stats — indicateurs nationaux (cache 30s)
  fastify.get(
    '/dashboard/stats',
    { preHandler: [requireAuth, requireRole('field_agent', 'local_validator', 'provincial_coordinator', 'territory_admin', 'humanitarian_partner', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const user = request.jwtUser;

      const cacheKey = `dashboard:stats:${user.scope.join(',') || 'national'}`;
      const cached = cGet<object>(cacheKey);
      if (cached) return reply.header('X-Cache', 'HIT').send(cached);

      const scopeFilter = user.scope.length > 0
        ? sql`AND (e.location_pcode = ANY(${user.scope}) OR e.affected_pcodes && ${user.scope}::text[])`
        : sql``;
      const scopeFilterPlain = user.scope.length > 0
        ? sql`AND (location_pcode = ANY(${user.scope}) OR affected_pcodes && ${user.scope}::text[])`
        : sql``;

      // All 9 queries run in parallel — one round trip to DB instead of 5 sequential + 4 parallel
      const [
        [counts],
        hazardBreakdown,
        trend,
        topProvinces,
        [modQueue],
        [crisisStats],
        [demandStats],
        [stockStats],
        recentActivity,
      ] = await Promise.all([
        sql`
          SELECT
            COUNT(*) FILTER (WHERE e.status = 'active')                                       AS active_events,
            COUNT(*) FILTER (WHERE e.status IN ('reported','under_review'))                    AS pending_events,
            COUNT(*) FILTER (WHERE e.severity IN ('Severe','Extreme') AND e.status = 'active') AS critical_events,
            COUNT(*) FILTER (WHERE e.start_date >= NOW() - INTERVAL '24 hours')                AS events_24h,
            COUNT(*) FILTER (WHERE e.start_date >= NOW() - INTERVAL '7 days')                  AS events_7d,
            COALESCE(SUM(e.estimated_affected) FILTER (WHERE e.status = 'active'), 0)          AS total_affected
          FROM disaster_events e
          WHERE e.deleted_at IS NULL ${scopeFilter}
        `,
        sql`
          SELECT hazard_type, COUNT(*) AS count
          FROM disaster_events
          WHERE status = 'active' AND deleted_at IS NULL ${scopeFilterPlain}
          GROUP BY hazard_type ORDER BY count DESC
        `,
        sql`
          SELECT day, SUM(count)::int AS count
          FROM events_daily_trend
          WHERE day >= NOW() - INTERVAL '30 days'
          GROUP BY day ORDER BY day
        `,
        sql`
          SELECT pcode, province_name, active_events, severe_events, total_affected
          FROM province_stats
          ORDER BY severe_events DESC, active_events DESC
          LIMIT 10
        `,
        sql`
          SELECT COUNT(*) AS pending FROM moderation_queue WHERE resolved_at IS NULL
        `,
        sql`
          SELECT
            COUNT(*) FILTER (WHERE status = 'active')    AS active_crises,
            COUNT(*) FILTER (WHERE status = 'contained') AS contained_crises,
            COALESCE(SUM(affected_count)  FILTER (WHERE status = 'active'), 0) AS crisis_affected,
            COALESCE(SUM(displaced_count) FILTER (WHERE status = 'active'), 0) AS crisis_displaced,
            COALESCE(SUM(deaths_count)    FILTER (WHERE status = 'active'), 0) AS crisis_deaths
          FROM crisis_events
        `,
        sql`
          SELECT
            COUNT(*) FILTER (WHERE status = 'pending')   AS pending_demands,
            COUNT(*) FILTER (WHERE status = 'approved')  AS approved_demands,
            COUNT(*) FILTER (WHERE status = 'fulfilled') AS fulfilled_demands
          FROM resource_demands
        `,
        sql`
          SELECT
            COUNT(*) FILTER (WHERE s.quantity_available <= s.minimum_threshold AND s.minimum_threshold > 0) AS critical_stocks,
            COUNT(DISTINCT s.depot_id) AS total_depots,
            COUNT(*)::int AS total_stock_lines
          FROM resource_stocks s
          JOIN resource_depots d ON d.id = s.depot_id
          WHERE d.is_active = true
        `,
        sql`
          SELECT activity_type, label, status, urgency, created_at
          FROM (
            SELECT 'crisis'::text AS activity_type, title AS label, status::text, NULL::text AS urgency, created_at
            FROM crisis_events
            UNION ALL
            SELECT 'demand'::text, resource_name, status::text, urgency, created_at
            FROM resource_demands
          ) recent
          ORDER BY created_at DESC
          LIMIT 8
        `,
      ]);

      const body = {
        success: true,
        data: {
          counts: {
            activeEvents:     Number(counts.activeEvents),
            pendingEvents:    Number(counts.pendingEvents),
            criticalEvents:   Number(counts.criticalEvents),
            events24h:        Number(counts.events24h),
            events7d:         Number(counts.events7d),
            totalAffected:    Number(counts.totalAffected),
            moderationQueue:  Number(modQueue.pending),
            wsConnected:      getConnectedCount(),
          },
          crisisStats: {
            activeCrises:    Number(crisisStats.activeCrises),
            containedCrises: Number(crisisStats.containedCrises),
            crisisAffected:  Number(crisisStats.crisisAffected),
            crisisDisplaced: Number(crisisStats.crisisDisplaced),
            crisisDeaths:    Number(crisisStats.crisisDeaths),
          },
          demandStats: {
            pendingDemands:   Number(demandStats.pendingDemands),
            approvedDemands:  Number(demandStats.approvedDemands),
            fulfilledDemands: Number(demandStats.fulfilledDemands),
          },
          stockStats: {
            criticalStocks:  Number(stockStats.criticalStocks),
            totalDepots:     Number(stockStats.totalDepots),
            totalStockLines: Number(stockStats.totalStockLines),
          },
          recentActivity,
          hazardBreakdown,
          trend,
          topProvinces,
        },
      };

      cSet(cacheKey, body, 30_000);
      return reply.header('X-Cache', 'MISS').send(body);
    },
  );

  // GET /dashboard/map-data
  fastify.get('/dashboard/map-data', async (request, reply) => {
    const { history } = (request.query as Record<string, string>);
    const isHistory = history === 'true';

    const events = await sql`
      SELECT
        id, title, hazard_type, status, severity,
        location_pcode, location_name,
        estimated_affected,
        glide_number,
        start_date,
        end_date,
        ST_X(location_point) AS lng,
        ST_Y(location_point) AS lat,
        ARRAY_LENGTH(affected_pcodes, 1) AS province_count
      FROM disaster_events
      WHERE deleted_at IS NULL
        AND status NOT IN ('rejected')
        AND ${isHistory ? sql`TRUE` : sql`status NOT IN ('resolved')`}
        AND location_point IS NOT NULL
      ORDER BY start_date DESC
      LIMIT ${isHistory ? 2000 : 500}
    `;

    return reply.send({ success: true, data: events });
  });

  // GET /dashboard/export.csv
  fastify.get(
    '/dashboard/export.csv',
    { preHandler: [requireAuth, requireRole('provincial_coordinator', 'territory_admin', 'humanitarian_partner', 'national_decision_maker', 'system_admin')] },
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

  // POST /dashboard/refresh-stats
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
