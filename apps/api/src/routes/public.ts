/**
 * Routes publiques SINAUR-RDC — aucune authentification requise.
 * Données strictement anonymisées : aucun nom, aucun numéro de téléphone,
 * aucune information permettant de réidentifier une personne.
 *
 * Endpoints :
 *   GET /public/alerts              — alertes CAP actives (JSON)
 *   GET /public/events              — événements anonymisés (JSON)
 *   GET /public/stats               — statistiques agrégées (JSON)
 *   GET /public/export/events.csv   — export HXL CSV
 *   GET /public/export/alerts.csv   — export HXL CSV
 *   GET /public/feed.atom           — flux Atom 1.0 + CAP 1.2
 */
import type { FastifyInstance } from 'fastify'
import { sql } from '../db.js'
import { logSecurityEvent, hasSuspiciousInput } from '../auth/security.js'

// Champs HXL pour les exports CSV
const HXL_EVENTS_HEADER  = 'id,hazard_type,severity,location_pcode,location_name,province,source,created_at,description'
const HXL_EVENTS_TAGS    = '#event+id,#crisis+type,#severity+code,#adm+pcode,#adm+name,#adm1+name,#source,#date+created,#description'
const HXL_ALERTS_HEADER  = 'identifier,sent_at,status,urgency,severity,certainty,headline,area_name,area_pcode,category'
const HXL_ALERTS_TAGS    = '#alert+id,#date+sent,#alert+status,#alert+urgency,#alert+severity,#alert+certainty,#alert+headline,#adm+name,#adm+pcode,#alert+category'

function csvEscape(val: unknown): string {
  if (val == null) return ''
  const s = String(val).replace(/"/g, '""')
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s
}

function toCSV(headers: string, tags: string, rows: Record<string, unknown>[], fields: string[]): string {
  const lines = [headers, tags]
  for (const row of rows) {
    lines.push(fields.map(f => csvEscape(row[f])).join(','))
  }
  return lines.join('\n')
}

export async function publicRoutes(fastify: FastifyInstance) {

  // Contrôle anti-injection sur les paramètres de query
  fastify.addHook('onRequest', async (request) => {
    const raw = JSON.stringify(request.query)
    if (hasSuspiciousInput(raw)) {
      logSecurityEvent('suspicious_input', request, { query: raw })
    }
  })

  // ── Alertes CAP actives ────────────────────────────────────────────────────

  fastify.get('/public/alerts', async (_request, reply) => {
    const rows = await sql`
      SELECT
        identifier,
        sent_at,
        status,
        msg_type,
        scope,
        info->>'category'  AS category,
        info->>'event'     AS event,
        info->>'urgency'   AS urgency,
        info->>'severity'  AS severity,
        info->>'certainty' AS certainty,
        info->>'headline'  AS headline,
        info->>'areaDesc'  AS area_name,
        info->>'areaCode'  AS area_pcode
      FROM cap_alerts
      WHERE status = 'actual'
        AND scope  = 'Public'
      ORDER BY sent_at DESC
      LIMIT 50
    `

    return reply
      .header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
      .send({ success: true, data: rows, meta: { count: rows.length } })
  })

  // ── Événements anonymisés ─────────────────────────────────────────────────

  fastify.get('/public/events', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, _reply) => {
    const q = request.query as Record<string, string>
    const page  = Math.max(1, parseInt(q.page ?? '1'))
    const limit = Math.min(50, Math.max(1, parseInt(q.limit ?? '20')))
    const offset = (page - 1) * limit

    const rows = await sql`
      SELECT
        e.id,
        e.hazard_type,
        e.severity,
        e.location_pcode,
        d.name_fr   AS location_name,
        p.name_fr   AS province_name,
        e.source,
        e.created_at,
        e.title     AS description
      FROM disaster_events e
      LEFT JOIN admin_divisions d ON d.pcode = e.location_pcode
      LEFT JOIN admin_divisions p ON p.pcode = LEFT(e.location_pcode, 4) AND p.level = 1
      WHERE e.is_public = TRUE
      ORDER BY e.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM disaster_events WHERE is_public = TRUE
    `

    return { success: true, data: rows, meta: { total, page, limit } }
  })

  // ── Statistiques agrégées ─────────────────────────────────────────────────

  fastify.get('/public/stats', async (_request, reply) => {
    const [provinces, byHazard, trend, totals, activeAlerts] = await Promise.all([
      sql`SELECT pcode, name_fr, events_30d, events_7d, active_alerts, last_event_at FROM public_stats ORDER BY events_30d DESC LIMIT 26`,
      sql`
        SELECT hazard_type, COUNT(*)::int AS count
        FROM disaster_events WHERE is_public = TRUE AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY hazard_type ORDER BY count DESC
      `,
      sql`
        SELECT stat_date, hazard_type, event_count
        FROM event_daily_stats
        WHERE stat_date >= CURRENT_DATE - 29
        ORDER BY stat_date, hazard_type
      `,
      sql`
        SELECT
          COUNT(*)::int                                                                                AS total_events,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int                       AS events_7d,
          COUNT(DISTINCT location_pcode) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS affected_provinces
        FROM disaster_events WHERE is_public = TRUE
      `,
      sql`SELECT COUNT(*)::int AS count FROM cap_alerts WHERE status = 'actual' AND scope = 'Public'`,
    ])

    return reply
      .header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
      .send({
        success: true,
        data: {
          ...totals[0],
          activeAlerts: activeAlerts[0].count,
          byHazardType: byHazard,
          byProvince:   provinces,
          trend,
        },
      })
  })

  // ── Export HXL CSV — événements ───────────────────────────────────────────

  fastify.get('/public/export/events.csv', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    const rows = await sql`
      SELECT
        e.id,
        e.hazard_type,
        e.severity,
        e.location_pcode,
        d.name_fr   AS location_name,
        p.name_fr   AS province,
        e.source,
        e.created_at,
        e.title     AS description
      FROM disaster_events e
      LEFT JOIN admin_divisions d ON d.pcode = e.location_pcode
      LEFT JOIN admin_divisions p ON p.pcode = LEFT(e.location_pcode, 4) AND p.level = 1
      WHERE e.is_public = TRUE
      ORDER BY e.created_at DESC
      LIMIT 5000
    `

    const csv = toCSV(HXL_EVENTS_HEADER, HXL_EVENTS_TAGS, rows as any, [
      'id', 'hazardType', 'severity', 'locationPcode', 'locationName', 'province', 'source', 'createdAt', 'description',
    ])

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="sinaur-rdc-events.csv"')
      .header('Cache-Control', 'public, max-age=3600')
      .send(csv)
  })

  // ── Export HXL CSV — alertes ──────────────────────────────────────────────

  fastify.get('/public/export/alerts.csv', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    const rows = await sql`
      SELECT
        identifier,
        sent_at,
        status,
        info->>'urgency'   AS urgency,
        info->>'severity'  AS severity,
        info->>'certainty' AS certainty,
        info->>'headline'  AS headline,
        info->>'areaDesc'  AS area_name,
        info->>'areaCode'  AS area_pcode,
        info->>'category'  AS category
      FROM cap_alerts
      WHERE scope = 'Public'
      ORDER BY sent_at DESC
      LIMIT 1000
    `

    const csv = toCSV(HXL_ALERTS_HEADER, HXL_ALERTS_TAGS, rows as any, [
      'identifier', 'sentAt', 'status', 'urgency', 'severity', 'certainty',
      'headline', 'areaName', 'areaPcode', 'category',
    ])

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="sinaur-rdc-alerts.csv"')
      .header('Cache-Control', 'public, max-age=3600')
      .send(csv)
  })

  // ── Flux Atom 1.0 + CAP 1.2 ───────────────────────────────────────────────

  fastify.get('/public/feed.atom', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    const rows = await sql`
      SELECT
        identifier,
        sent_at,
        info->>'headline'  AS headline,
        info->>'description' AS description,
        info->>'urgency'   AS urgency,
        info->>'severity'  AS severity,
        info->>'areaDesc'  AS area_desc,
        info->>'areaCode'  AS area_pcode,
        info->>'event'     AS event_name
      FROM cap_alerts
      WHERE status = 'actual' AND scope = 'Public'
      ORDER BY sent_at DESC
      LIMIT 20
    `

    const now = new Date().toISOString()

    const entries = rows.map((r: any) => `
  <entry>
    <title><![CDATA[${r.headline ?? r.eventName ?? 'Alerte SINAUR-RDC'}]]></title>
    <id>urn:sinaur-rdc:alert:${r.identifier}</id>
    <updated>${r.sentAt instanceof Date ? r.sentAt.toISOString() : r.sentAt}</updated>
    <summary type="text"><![CDATA[${r.urgency ?? ''} — ${r.severity ?? ''} — ${r.areaDesc ?? r.areaPcode ?? ''}]]></summary>
    <content type="html"><![CDATA[
      <p><strong>${r.headline ?? ''}</strong></p>
      <p>${r.description ?? ''}</p>
      <p>Zone : ${r.areaDesc ?? r.areaPcode ?? 'N/A'} | Urgence : ${r.urgency ?? 'N/A'} | Sévérité : ${r.severity ?? 'N/A'}</p>
    ]]></content>
    <category term="${r.eventName ?? 'Alerte'}" />
  </entry>`).join('\n')

    const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>SINAUR-RDC — Alertes officielles République Démocratique du Congo</title>
  <subtitle>Système National Intelligent d'Alerte, d'Urgence et de Réponse aux Sinistres</subtitle>
  <link href="https://sinaur-rdc.cd/public/feed.atom" rel="self" type="application/atom+xml"/>
  <link href="https://sinaur-rdc.cd" rel="alternate" type="text/html"/>
  <id>urn:sinaur-rdc:alerts-feed</id>
  <updated>${now}</updated>
  <rights>Données publiques SINAUR-RDC — Gouvernement de la RDC</rights>
  <generator uri="https://sinaur-rdc.cd" version="0.5.0-phase5">SINAUR-RDC API</generator>
${entries}
</feed>`

    return reply
      .header('Content-Type', 'application/atom+xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .send(atom)
  })

  // ── Rafraîchissement de la vue matérialisée (appel interne) ──────────────

  fastify.post('/public/refresh-stats', {
    config: { rateLimit: { max: 2, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const internalKey = request.headers['x-internal-service']
    if (internalKey !== 'ussd' && internalKey !== 'ingestion' && internalKey !== 'alerting') {
      return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN' } })
    }
    await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY public_stats`
    return { success: true, refreshed_at: new Date().toISOString() }
  })
}
