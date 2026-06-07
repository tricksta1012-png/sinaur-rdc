import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';

const listSchema = z.object({
  level: z.coerce.number().int().min(0).max(6).optional(),
  parentPcode: z.string().optional(),
  search: z.string().optional(),
  withGeometry: z.coerce.boolean().default(false),
});

export async function geoRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /geo/divisions — liste les divisions administratives
  fastify.get('/geo/divisions', async (request, reply) => {
    const query = listSchema.parse(request.query);
    const rows = await sql`
      SELECT
        id, pcode, name_fr AS name, name_local,
        level, parent_pcode,
        population,
        ST_AsGeoJSON(centroid)::json AS centroid,
        ${query.withGeometry ? sql`ST_AsGeoJSON(geometry)::json AS geometry,` : sql``}
        is_active
      FROM admin_divisions
      WHERE deleted_at IS NULL
        AND is_active = TRUE
        ${query.level !== undefined ? sql`AND level = ${query.level}` : sql``}
        ${query.parentPcode ? sql`AND parent_pcode = ${query.parentPcode}` : sql``}
        ${query.search ? sql`AND name_fr ILIKE ${'%' + query.search + '%'}` : sql``}
      ORDER BY level, name_fr
      LIMIT 500
    `;
    return reply.send({ success: true, data: rows });
  });

  // GET /geo/divisions/:pcode — détail d'une division avec ses enfants
  fastify.get('/geo/divisions/:pcode', async (request, reply) => {
    const { pcode } = request.params as { pcode: string };
    const [division] = await sql`
      SELECT
        id, pcode, name_fr AS name, name_local,
        level, parent_pcode, population, area_km2,
        ST_AsGeoJSON(centroid)::json AS centroid,
        ST_AsGeoJSON(geometry)::json AS geometry,
        is_active
      FROM admin_divisions WHERE pcode = ${pcode}
    `;
    if (!division) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Division introuvable' } });

    const children = await sql`
      SELECT id, pcode, name_fr AS name, level, population,
             ST_AsGeoJSON(centroid)::json AS centroid
      FROM admin_divisions
      WHERE parent_pcode = ${pcode} AND is_active = TRUE
      ORDER BY name_fr
    `;

    return reply.send({ success: true, data: { ...division, children } });
  });

  // GET /geo/search — recherche par coordonnées GPS (reverse geocode via PostGIS)
  fastify.get('/geo/reverse', async (request, reply) => {
    const { lat, lng, level } = z.object({
      lat: z.coerce.number().min(-13).max(6),
      lng: z.coerce.number().min(11).max(32),
      level: z.coerce.number().int().min(0).max(6).default(3),
    }).parse(request.query);

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
}
