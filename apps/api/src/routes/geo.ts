import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireAuth, requireRole } from '../auth/jwt.js';

const listSchema = z.object({
  level: z.coerce.number().int().min(0).max(6).optional(),
  parentPcode: z.string().optional(),
  search: z.string().optional(),
  withGeometry: z.coerce.boolean().default(false),
});

// Detect at startup whether geometry columns are PostGIS or JSONB
let geometryIsPostGIS: boolean | null = null;
async function geoMode(): Promise<boolean> {
  if (geometryIsPostGIS !== null) return geometryIsPostGIS;
  const [r] = await sql`
    SELECT udt_name FROM information_schema.columns
    WHERE table_name = 'admin_divisions' AND column_name = 'geometry'
  `;
  geometryIsPostGIS = r?.udtName === 'geometry';
  return geometryIsPostGIS;
}

/** Returns centroid as JSON — works for both PostGIS and JSONB columns */
function centroidExpr(postgis: boolean) {
  return postgis ? sql`ST_AsGeoJSON(centroid)::json AS centroid,` : sql`centroid,`;
}
function geometryExpr(postgis: boolean) {
  return postgis ? sql`ST_AsGeoJSON(geometry)::json AS geometry,` : sql`geometry,`;
}

export async function geoRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /geo/divisions — liste les divisions administratives
  fastify.get('/geo/divisions', async (request, reply) => {
    const query = listSchema.parse(request.query);
    const postgis = await geoMode();
    const rows = await sql`
      SELECT
        id, pcode, name_fr AS name, name_local,
        level, parent_pcode,
        population,
        ${centroidExpr(postgis)}
        ${query.withGeometry ? geometryExpr(postgis) : sql``}
        is_active
      FROM admin_divisions
      WHERE is_active = TRUE
        ${query.level !== undefined ? sql`AND level = ${query.level}` : sql``}
        ${query.parentPcode ? sql`AND parent_pcode = ${query.parentPcode}` : sql``}
        ${query.search ? sql`AND name_fr ILIKE ${'%' + query.search + '%'}` : sql``}
      ORDER BY level, name_fr
      LIMIT 500
    `;
    // Geo data is static — cache aggressively at the CDN/browser layer
    return reply
      .header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
      .send({ success: true, data: rows });
  });

  // GET /geo/divisions/:pcode — détail d'une division avec ses enfants
  fastify.get('/geo/divisions/:pcode', async (request, reply) => {
    const { pcode } = request.params as { pcode: string };
    const postgis = await geoMode();
    const [division] = await sql`
      SELECT
        id, pcode, name_fr AS name, name_local,
        level, parent_pcode, population, area_km2,
        ${centroidExpr(postgis)}
        ${geometryExpr(postgis)}
        is_active
      FROM admin_divisions WHERE pcode = ${pcode}
    `;
    if (!division) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Division introuvable' } });

    const children = await sql`
      SELECT id, pcode, name_fr AS name, level, population,
             ${centroidExpr(postgis)}
             is_active
      FROM admin_divisions
      WHERE parent_pcode = ${pcode} AND is_active = TRUE
      ORDER BY name_fr
    `;

    return reply.send({ success: true, data: { ...division, children } });
  });

  // GET /geo/reverse — reverse geocoding (PostGIS only; JSONB falls back to null)
  fastify.get('/geo/reverse', async (request, reply) => {
    const { lat, lng, level } = z.object({
      lat: z.coerce.number().min(-13).max(6),
      lng: z.coerce.number().min(11).max(32),
      level: z.coerce.number().int().min(0).max(6).default(3),
    }).parse(request.query);

    const postgis = await geoMode();
    if (!postgis) {
      return reply.status(503).send({ success: false, error: { code: 'NOT_AVAILABLE', message: 'Reverse geocoding nécessite PostGIS' } });
    }

    const [found] = await sql`
      SELECT pcode, name_fr AS name, level, parent_pcode
      FROM admin_divisions
      WHERE level = ${level}
        AND ST_Contains(geometry, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
      LIMIT 1
    `;

    if (!found) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Aucune division trouvée pour ces coordonnées' } });
    return reply.send({ success: true, data: found });
  });

  // GET /geo/cartographie — GeoJSON choroplèthe pour la cartographie administrative
  fastify.get('/geo/cartographie', async (request, reply) => {
    const query = z.object({
      level:      z.coerce.number().int().min(0).max(6).default(1),
      parentPcode: z.string().optional(),
    }).parse(request.query);

    const postgis = await geoMode();

    const rows = await sql`
      SELECT
        ad.pcode,
        ad.name_fr,
        ad.level,
        ad.parent_pcode,
        ad.population,
        ad.responsable_nom,
        ad.responsable_titre,
        ad.responsable_contact,
        ad.statut_situation,
        ad.geometry_type,
        ${postgis ? sql`ST_AsGeoJSON(ad.geometry)::json AS geometry,` : sql`ad.geometry,`}
        ${postgis ? sql`ST_AsGeoJSON(ad.centroid)::json AS centroid,` : sql`ad.centroid,`}
        COALESCE((
          SELECT COUNT(*)::int
          FROM disaster_events de
          WHERE de.location_pcode LIKE ad.pcode || '%'
            AND de.created_at >= NOW() - INTERVAL '30 days'
        ), 0) AS nb_incidents
      FROM admin_divisions ad
      WHERE ad.is_active = TRUE
        AND ad.level = ${query.level}
        ${query.parentPcode ? sql`AND ad.parent_pcode = ${query.parentPcode}` : sql``}
      ORDER BY ad.name_fr
      LIMIT 1000
    `;

    type GeoFeature = {
      type: 'Feature';
      geometry: unknown;
      properties: Record<string, unknown>;
    };

    const features: GeoFeature[] = [];
    for (const r of rows) {
      const geom     = r.geometry ?? null;
      const centroid = r.centroid ?? null;
      // Level 4 entries have only a centroid (point from OSM) — use it as fallback
      const effectiveGeom = geom ?? centroid;
      if (!effectiveGeom) continue;

      const centroidCoords: [number, number] | null =
        centroid?.coordinates ?? null;

      features.push({
        type: 'Feature',
        geometry: effectiveGeom,
        properties: {
          pcode:               r.pcode,
          name:                r.nameFr ?? r.name_fr,
          level:               r.level,
          parent_pcode:        r.parentPcode ?? r.parent_pcode,
          population:          r.population,
          responsable_nom:     r.responsableNom ?? r.responsable_nom ?? null,
          responsable_titre:   r.responsableTitre ?? r.responsable_titre ?? null,
          responsable_contact: r.responsableContact ?? r.responsable_contact ?? null,
          statut:              r.statutSituation ?? r.statut_situation ?? 'NORMAL',
          geometry_type:       r.geometryType ?? r.geometry_type ?? null,
          nb_incidents:        Number(r.nbIncidents ?? r.nb_incidents ?? 0),
          _is_point:           !geom && !!centroid,
          centroid:            centroidCoords,
        },
      });
    }

    const featureCollection = {
      type: 'FeatureCollection' as const,
      features,
      _meta: { total: rows.length, withGeometry: features.length },
    };

    return reply
      .header('Cache-Control', 'private, no-store')
      .send(featureCollection);
  });

  // GET /geo/entity/:pcode/bounds — bounding box pour le zoom automatique de la carte
  fastify.get('/geo/entity/:pcode/bounds', async (request, reply) => {
    const { pcode } = request.params as { pcode: string };
    const postgis = await geoMode();

    if (postgis) {
      const rows = await sql`
        SELECT
          name_fr,
          level,
          ARRAY[
            ST_XMin(ST_Envelope(geometry)),
            ST_YMin(ST_Envelope(geometry)),
            ST_XMax(ST_Envelope(geometry)),
            ST_YMax(ST_Envelope(geometry))
          ] AS bounds,
          ARRAY[
            ST_X(ST_Centroid(geometry)),
            ST_Y(ST_Centroid(geometry))
          ] AS center
        FROM admin_divisions
        WHERE pcode = ${pcode}
          AND geometry IS NOT NULL
      ` as unknown as Record<string, unknown>[];

      const r = rows[0];
      if (r?.bounds) {
        const b = r.bounds as number[];
        return reply.header('Cache-Control', 'public, max-age=3600').send({
          success: true,
          data: {
            pcode,
            name:   String(r.nameFr ?? r.name_fr ?? pcode),
            level:  Number(r.level ?? 0),
            bounds: [[b[0], b[1]], [b[2], b[3]]],
            center: r.center as [number, number],
          },
        });
      }
    }

    // Fallback: bbox colonne (pré-calculé à l'import)
    const rows2 = await sql`
      SELECT name_fr, level, bbox FROM admin_divisions WHERE pcode = ${pcode}
    ` as unknown as Record<string, unknown>[];

    const r2 = rows2[0];
    if (!r2) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Entité introuvable' } });
    }

    const bbox = r2.bbox as number[] | null;
    const name  = String((r2 as any).nameFr ?? (r2 as any).name_fr ?? pcode);
    const level = Number(r2.level ?? 0);

    if (bbox && bbox.length >= 4) {
      return reply.header('Cache-Control', 'public, max-age=3600').send({
        success: true,
        data: {
          pcode, name, level,
          bounds: [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
          center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
        },
      });
    }

    // Correction 7 — pas de géométrie directe : centroïde calculé depuis les enfants
    const enfants = await sql`
      SELECT bbox FROM admin_divisions
      WHERE parent_pcode = ${pcode} AND bbox IS NOT NULL
    ` as unknown as Record<string, unknown>[];

    if (enfants.length > 0) {
      let totalLon = 0, totalLat = 0, count = 0;
      for (const e of enfants) {
        const b = e.bbox as number[] | null;
        if (b && b.length >= 4) {
          totalLon += (b[0] + b[2]) / 2;
          totalLat += (b[1] + b[3]) / 2;
          count++;
        }
      }
      if (count > 0) {
        return reply.header('Cache-Control', 'public, max-age=3600').send({
          success: true,
          data: {
            pcode, name, level,
            bounds: null,
            center: [totalLon / count, totalLat / count] as [number, number],
          },
        });
      }
    }

    // Dernier recours : centroïde RDC
    return reply.header('Cache-Control', 'public, max-age=60').send({
      success: true,
      data: {
        pcode, name, level,
        bounds: null,
        center: [24.5, -3.0] as [number, number],
      },
    });
  });

  // POST /geo/refresh-statuts — recalcule statut_situation depuis les incidents des 30 derniers jours
  fastify.post(
    '/geo/refresh-statuts',
    { preHandler: [requireAuth, requireRole('system_admin')] },
    async (_request, reply) => {
      const result = await sql`
        WITH incident_counts AS (
          SELECT
            ad.pcode,
            COUNT(de.id)::int AS nb_incidents
          FROM admin_divisions ad
          LEFT JOIN disaster_events de
            ON de.location_pcode LIKE ad.pcode || '%'
            AND de.created_at >= NOW() - INTERVAL '30 days'
            AND de.deleted_at IS NULL
          WHERE ad.is_active = TRUE
          GROUP BY ad.pcode
        ),
        new_statuts AS (
          SELECT
            pcode,
            CASE
              WHEN nb_incidents = 0  THEN 'NORMAL'
              WHEN nb_incidents <= 5 THEN 'VIGILANCE'
              WHEN nb_incidents <= 15 THEN 'ALERTE'
              ELSE 'CRISE'
            END AS new_statut
          FROM incident_counts
        )
        UPDATE admin_divisions ad
        SET statut_situation = ns.new_statut
        FROM new_statuts ns
        WHERE ad.pcode = ns.pcode
          AND (ad.statut_situation IS DISTINCT FROM ns.new_statut)
        RETURNING ad.pcode, ns.new_statut
      `;
      return reply.send({
        success: true,
        data: { updated: result.length, changes: result },
      });
    },
  );

  // GET /geo/couverture — taux de couverture en responsables par niveau
  fastify.get('/geo/couverture', async (request, reply) => {
    const rows = await sql`
      SELECT
        level,
        COUNT(*)::int                  AS total,
        COUNT(responsable_nom)::int    AS avec_responsable
      FROM admin_divisions
      WHERE is_active = TRUE
      GROUP BY level
      ORDER BY level
    `;

    const data = rows.map(r => ({
      level:            r.level,
      total:            Number(r.total),
      avec_responsable: Number(r.avecResponsable ?? r.avec_responsable ?? 0),
      sans_responsable: Number(r.total) - Number(r.avecResponsable ?? r.avec_responsable ?? 0),
    }));

    return reply
      .header('Cache-Control', 'private, no-store')
      .send({ success: true, data });
  });
}
