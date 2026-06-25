import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireAuth, requireRole, writeAuditLog } from '../auth/jwt.js';
import { buildDedupHash, isDuplicate, registerHash, enqueueModeration } from '../services/dedup.js';
import { sendAcknowledgment } from '../services/sms.js';
import { broadcastNewEvent } from '../websocket/broadcast.js';

const createEventSchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().default(''),
  hazardType: z.enum(['flood','landslide','mass_displacement','humanitarian_crisis',
    'health_epidemic','volcanic_eruption','drought','fire','conflict','earthquake','other']),
  severity: z.enum(['Minor','Moderate','Severe','Extreme','Unknown']).default('Unknown'),
  source: z.enum(['citizen','field_agent','ai_prediction','reliefweb',
    'fews_net','mettelsat','ocha','official','other']),
  locationPcode: z.string().min(2).max(20),
  locationName: z.string().min(2).max(200),
  locationLevel: z.number().int().min(0).max(6),
  locationAccuracy: z.enum(['gps','pcode','village','territory','province']).default('pcode'),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  estimatedAffected: z.number().int().positive().optional(),
  startDate: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
  isFlaggedSensitive: z.boolean().default(false),
  clientCreatedAt: z.string().datetime().optional(),
});

const filterSchema = z.object({
  hazardType: z.string().optional(),
  status: z.string().optional(),
  province: z.string().optional(),
  within: z.string().optional(),   // filtre hiérarchique : location_pcode LIKE within%
  severity: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function eventRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /events — liste paginée avec filtres
  fastify.get('/events', async (request, reply) => {
    const q = filterSchema.parse(request.query);
    const offset = (q.page - 1) * q.limit;

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT
          e.id, e.title, e.hazard_type, e.status, e.severity, e.confidence,
          e.source, e.location_pcode, e.location_name, e.location_level,
          e.estimated_affected, e.start_date, e.end_date, e.tags,
          e.is_flagged_sensitive, e.created_at,
          ST_AsGeoJSON(e.location_point)::json AS location_point,
          u.display_name AS reported_by_name
        FROM disaster_events e
        LEFT JOIN users u ON u.id = e.reported_by_id
        WHERE e.deleted_at IS NULL
          ${q.hazardType ? sql`AND e.hazard_type = ${q.hazardType}::hazard_type` : sql``}
          ${q.status ? sql`AND e.status = ${q.status}::event_status` : sql``}
          ${q.severity ? sql`AND e.severity = ${q.severity}::alert_severity` : sql``}
          ${q.province ? sql`AND (e.location_pcode = ${q.province} OR ${q.province} = ANY(e.affected_pcodes))` : sql``}
          ${q.within ? sql`AND e.location_pcode LIKE ${q.within + '%'}` : sql``}
          ${q.dateFrom ? sql`AND e.start_date >= ${q.dateFrom}::timestamptz` : sql``}
          ${q.dateTo ? sql`AND e.start_date <= ${q.dateTo}::timestamptz` : sql``}
          ${q.search ? sql`AND (e.title ILIKE ${'%' + q.search + '%'} OR e.description ILIKE ${'%' + q.search + '%'})` : sql``}
        ORDER BY e.start_date DESC
        LIMIT ${q.limit} OFFSET ${offset}
      `,
      sql`
        SELECT COUNT(*)::int AS count FROM disaster_events
        WHERE deleted_at IS NULL
          ${q.hazardType ? sql`AND hazard_type = ${q.hazardType}::hazard_type` : sql``}
          ${q.status ? sql`AND status = ${q.status}::event_status` : sql``}
          ${q.severity ? sql`AND severity = ${q.severity}::alert_severity` : sql``}
          ${q.province ? sql`AND (location_pcode = ${q.province} OR ${q.province} = ANY(affected_pcodes))` : sql``}
          ${q.within ? sql`AND location_pcode LIKE ${q.within + '%'}` : sql``}
          ${q.dateFrom ? sql`AND start_date >= ${q.dateFrom}::timestamptz` : sql``}
          ${q.dateTo ? sql`AND start_date <= ${q.dateTo}::timestamptz` : sql``}
          ${q.search ? sql`AND (title ILIKE ${'%' + q.search + '%'} OR description ILIKE ${'%' + q.search + '%'})` : sql``}
      `,
    ]);

    return reply.send({
      success: true,
      data: rows,
      pagination: { page: q.page, limit: q.limit, total: count, totalPages: Math.ceil(count / q.limit) },
    });
  });

  // GET /events/:id
  fastify.get('/events/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [event] = await sql`
      SELECT e.*,
        ST_AsGeoJSON(e.location_point)::json AS location_point,
        u.display_name AS reported_by_name,
        v.display_name AS validated_by_name,
        COALESCE(
          json_agg(DISTINCT jsonb_build_object(
            'id', m.id, 'type', m.media_type, 'url', m.url, 'thumbnailUrl', m.thumbnail_url
          )) FILTER (WHERE m.id IS NOT NULL), '[]'
        ) AS media
      FROM disaster_events e
      LEFT JOIN users u ON u.id = e.reported_by_id
      LEFT JOIN users v ON v.id = e.validated_by_id
      LEFT JOIN event_media m ON m.event_id = e.id
      WHERE e.id = ${id} AND e.deleted_at IS NULL
      GROUP BY e.id, u.display_name, v.display_name
    `;
    if (!event) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Événement introuvable' } });
    return reply.send({ success: true, data: event });
  });

  // POST /events — créer un événement (authentification requise)
  fastify.post('/events', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = createEventSchema.parse(request.body);
    const userId = request.jwtUser.sub;

    // Déduplication : détection de doublons sur la fenêtre 24h
    const dedupHash = buildDedupHash({ hazardType: body.hazardType, locationPcode: body.locationPcode });
    const existingId = await isDuplicate(dedupHash);
    if (existingId) {
      return reply.status(409).send({
        success: false,
        error: { code: 'DUPLICATE_EVENT', message: 'Un événement similaire a déjà été signalé dans cette zone aujourd\'hui', details: { existingId } },
      });
    }

    const pointSql = body.locationLat !== undefined && body.locationLng !== undefined
      ? sql`ST_SetSRID(ST_MakePoint(${body.locationLng}, ${body.locationLat}), 4326)`
      : sql`NULL`;

    const [event] = await sql`
      INSERT INTO disaster_events (
        title, description, hazard_type, status, severity, confidence,
        source, location_pcode, location_name, location_level, location_accuracy,
        location_point, estimated_affected, start_date, tags,
        is_flagged_sensitive, reported_by_id, client_created_at, sync_status
      ) VALUES (
        ${body.title}, ${body.description}, ${body.hazardType}::hazard_type,
        'reported', ${body.severity}::alert_severity, 'low',
        ${body.source}::event_source,
        ${body.locationPcode}, ${body.locationName}, ${body.locationLevel},
        ${body.locationAccuracy}, ${pointSql},
        ${body.estimatedAffected ?? null}, ${body.startDate ?? sql`NOW()`},
        ${body.tags}, ${body.isFlaggedSensitive}, ${userId},
        ${body.clientCreatedAt ?? null}, 'synced'
      )
      RETURNING id, title, hazard_type, status, location_pcode, created_at
    `;

    // Enregistrer l'empreinte et mettre en file de modération
    await Promise.all([
      registerHash(dedupHash, event.id),
      enqueueModeration(event.id, body.source === 'citizen' ? 3 : 5, `Source: ${body.source}`),
    ]);

    // Diffusion WebSocket aux décideurs en périmètre
    broadcastNewEvent(event, [body.locationPcode]);

    // Accusé de réception SMS si numéro de téléphone connu
    const [reporter] = await sql`SELECT phone FROM users WHERE id = ${userId} AND phone IS NOT NULL`;
    if (reporter?.phone) {
      await sendAcknowledgment(reporter.phone, body.title).catch(() => {});
    }

    await writeAuditLog(userId, 'CREATE_EVENT', 'disaster_events', event.id, request, { hazardType: body.hazardType });
    return reply.status(201).send({ success: true, data: event });
  });

  // GET /events/map — GeoJSON FeatureCollection pour la carte (public, cache 30s)
  fastify.get('/events/map', async (request, reply) => {
    const q = z.object({
      hazardType: z.string().optional(),
      status:     z.string().optional(),
      province:   z.string().optional(),
      dateFrom:   z.string().optional(),
      dateTo:     z.string().optional(),
      bbox:       z.string().optional(), // "minLng,minLat,maxLng,maxLat"
      limit:      z.coerce.number().int().min(1).max(500).default(200),
    }).parse(request.query);

    let bboxFilter = sql``;
    if (q.bbox) {
      const parts = q.bbox.split(',').map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        const [minLng, minLat, maxLng, maxLat] = parts;
        bboxFilter = sql`AND e.location_point && ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)`;
      }
    }

    const rows = await sql`
      SELECT
        e.id, e.title, e.hazard_type, e.status, e.severity,
        e.location_pcode, e.location_name, e.estimated_affected,
        e.start_date, e.source,
        ST_X(e.location_point) AS lng,
        ST_Y(e.location_point) AS lat
      FROM disaster_events e
      WHERE e.deleted_at IS NULL
        AND e.location_point IS NOT NULL
        AND e.status NOT IN ('rejected')
        ${q.status    ? sql`AND e.status       = ${q.status}::event_status`      : sql``}
        ${q.hazardType ? sql`AND e.hazard_type = ${q.hazardType}::hazard_type`   : sql``}
        ${q.province  ? sql`AND (e.location_pcode = ${q.province} OR ${q.province} = ANY(e.affected_pcodes))` : sql``}
        ${q.dateFrom  ? sql`AND e.start_date   >= ${q.dateFrom}::timestamptz`    : sql``}
        ${q.dateTo    ? sql`AND e.start_date   <= ${q.dateTo}::timestamptz`      : sql``}
        ${bboxFilter}
      ORDER BY e.start_date DESC
      LIMIT ${q.limit}
    `;

    const geojson = {
      type: 'FeatureCollection',
      features: rows.map(r => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: {
          id:               r.id,
          title:            r.title,
          hazardType:       r.hazardType,
          severity:         r.severity,
          status:           r.status,
          locationPcode:    r.locationPcode,
          locationName:     r.locationName,
          estimatedAffected: r.estimatedAffected ?? 0,
          startDate:        r.startDate,
          source:           r.source,
        },
      })),
    };

    return reply
      .header('Cache-Control', 'public, max-age=30')
      .send(geojson);
  });

  // PATCH /events/:id/validate — validation par un validateur ou admin
  fastify.patch(
    '/events/:id/validate',
    { preHandler: [requireAuth, requireRole('local_validator', 'provincial_coordinator', 'territory_admin', 'national_decision_maker', 'system_admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { status, notes } = z.object({
        status: z.enum(['validated', 'rejected', 'active']),
        notes: z.string().optional(),
      }).parse(request.body);

      const [updated] = await sql`
        UPDATE disaster_events
        SET status = ${status}::event_status,
            validated_by_id = ${request.jwtUser.sub},
            validated_at = NOW()
        WHERE id = ${id} AND deleted_at IS NULL
        RETURNING id, status, validated_at
      `;

      if (!updated) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Événement introuvable' } });
      await writeAuditLog(request.jwtUser.sub, 'VALIDATE_EVENT', 'disaster_events', id, request, { status, notes });
      return reply.send({ success: true, data: updated });
    },
  );
}
