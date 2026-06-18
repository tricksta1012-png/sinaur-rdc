import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';

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
        ${postgis ? sql`ST_AsGeoJSON(ad.geometry)::json AS geometry,` : sql`ad.geometry,`}
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
      const geom = r.geometry ?? null;
      if (!geom) continue; // skip features without geometry

      features.push({
        type: 'Feature',
        geometry: geom,
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
          nb_incidents:        Number(r.nbIncidents ?? r.nb_incidents ?? 0),
        },
      });
    }

    const featureCollection = {
      type: 'FeatureCollection' as const,
      features,
      _meta: { total: rows.length, withGeometry: features.length },
    };

    return reply
      .header('Cache-Control', 'public, max-age=300')
      .send(featureCollection);
  });

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
      .header('Cache-Control', 'public, max-age=300')
      .send({ success: true, data });
  });
}
