import type { FastifyInstance } from 'fastify';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sql } from '../db.js';
import { requireAuth } from '../auth/jwt.js';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/ogg', 'audio/webm',
  'application/pdf',
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const UPLOAD_DIR = process.env['UPLOAD_DIR'] ?? join(process.cwd(), 'uploads');

mkdirSync(UPLOAD_DIR, { recursive: true });

export async function mediaRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/media/upload',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const data = await request.file({ limits: { fileSize: MAX_FILE_SIZE } });

      if (!data) {
        return reply.status(400).send({ success: false, error: { code: 'NO_FILE', message: 'Aucun fichier reçu' } });
      }

      if (!ALLOWED_MIME_TYPES.has(data.mimetype)) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_MIME', message: 'Type de fichier non autorisé' } });
      }

      const ext = extname(data.filename) || '.bin';
      const filename = `${randomUUID()}${ext}`;
      const filepath = join(UPLOAD_DIR, filename);

      const mediaType = data.mimetype.startsWith('image') ? 'photo'
        : data.mimetype.startsWith('video') ? 'video'
        : data.mimetype.startsWith('audio') ? 'audio'
        : 'document';

      let fileSize = 0;
      await new Promise<void>((resolve, reject) => {
        const ws = createWriteStream(filepath);
        data.file.on('data', (chunk: Buffer) => { fileSize += chunk.length; });
        data.file.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
      });

      // En production : uploader vers un stockage objet (S3, GCS) et stocker l'URL
      const url = `/uploads/${filename}`;

      const [record] = await sql`
        INSERT INTO event_media (event_id, media_type, url, uploaded_by, file_size_bytes, mime_type)
        VALUES (
          ${data.fields['eventId']?.value ?? null},
          ${mediaType},
          ${url},
          ${request.jwtUser.sub},
          ${fileSize},
          ${data.mimetype}
        )
        RETURNING id, url, media_type, file_size_bytes
      `.catch(() => {
        // Si pas d'eventId valide, retourner juste l'URL (associé après)
        return [{ id: randomUUID(), url, mediaType, fileSizeBytes: fileSize }];
      });

      return reply.status(201).send({ success: true, data: record });
    },
  );
}
