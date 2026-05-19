import { Router, Request, Response, NextFunction } from 'express';
import { z }    from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { internalPool } from '../config/database';
import { requireAuth }  from '../middleware/auth';
import { createError }  from '../middleware/errorHandler';

const router = Router();
router.use(requireAuth);

const s3 = new S3Client({
  endpoint:         process.env.S3_ENDPOINT || 'http://localhost:9000',
  region:           process.env.S3_REGION   || 'us-east-1',
  credentials: {
    accessKeyId:     process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  },
  forcePathStyle: true,   // необходимо для MinIO
});

const BUCKET = process.env.S3_BUCKET || 'tppo-files';

const uploadRequestSchema = z.object({
  ticket_id:     z.string().uuid(),
  original_name: z.string().min(1).max(512),
  mime_type:     z.string().optional(),
  size:          z.number().int().min(0).max(100 * 1024 * 1024),   // max 100 MB
});

const confirmSchema = z.object({
  file_id:  z.string().uuid(),
  checksum: z.string().optional(),
});

// ──────────────────────────────────────────────────────────
// POST /api/files/upload-request
//   → presigned PUT URL + file record в БД
// ──────────────────────────────────────────────────────────
router.post('/upload-request', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data   = uploadRequestSchema.parse(req.body);
    const userId = req.user!.sub;

    // Проверяем доступ к обращению
    const ticket = await internalPool.query(
      `SELECT client_id FROM tickets WHERE id = $1`, [data.ticket_id],
    );
    if (!ticket.rows[0]) return next(createError('Обращение не найдено', 404));
    if (req.user!.role === 'client' && ticket.rows[0].client_id !== userId) {
      return next(createError('Нет доступа', 403));
    }

    const fileId      = uuidv4();
    const storagePath = `tickets/${data.ticket_id}/${fileId}/${data.original_name}`;

    // Создаём запись в БД (не подтверждённую)
    await internalPool.query(
      `INSERT INTO files (id, ticket_id, author_id, original_name, mime_type, size, storage_path, upload_confirmed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false)`,
      [fileId, data.ticket_id, userId, data.original_name, data.mime_type, data.size, storagePath],
    );

    // Генерируем presigned PUT URL (15 минут)
    const command   = new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         storagePath,
      ContentType: data.mime_type,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

    res.json({
      file_id:    fileId,
      upload_url: uploadUrl,
      expires_in: 900,
    });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// POST /api/files/confirm
//   → подтверждаем, что файл загружен
// ──────────────────────────────────────────────────────────
router.post('/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { file_id, checksum } = confirmSchema.parse(req.body);
    const userId = req.user!.sub;

    const result = await internalPool.query(
      `UPDATE files
       SET upload_confirmed = true, checksum = $1, sync_status = 'pending'
       WHERE id = $2 AND author_id = $3
       RETURNING *`,
      [checksum ?? null, file_id, userId],
    );
    if (!result.rows[0]) return next(createError('Файл не найден', 404));

    // Outbox
    await internalPool.query(
      `INSERT INTO outbox (event_type, aggregate_id, aggregate_type, payload)
       VALUES ('file.uploaded', $1, 'file', $2)`,
      [file_id, JSON.stringify(result.rows[0])],
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// GET /api/files/:id/download-url
// ──────────────────────────────────────────────────────────
router.get('/:id/download-url', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const file = await internalPool.query(
      `SELECT f.*, t.client_id FROM files f
       LEFT JOIN tickets t ON t.id = f.ticket_id
       WHERE f.id = $1`,
      [id],
    );
    if (!file.rows[0]) return next(createError('Файл не найден', 404));
    if (!file.rows[0].upload_confirmed) return next(createError('Файл ещё не загружен', 422));

    if (req.user!.role === 'client' && file.rows[0].client_id !== req.user!.sub) {
      return next(createError('Нет доступа', 403));
    }

    const command   = new GetObjectCommand({
      Bucket: BUCKET,
      Key:    file.rows[0].storage_path,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 час

    res.json({ download_url: url, expires_in: 3600 });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// GET /api/files/:id/metadata
// ──────────────────────────────────────────────────────────
router.get('/:id/metadata', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const file = await internalPool.query(
      `SELECT f.id, f.ticket_id, f.original_name, f.mime_type, f.size,
              f.uploaded_at, f.checksum, f.upload_confirmed, f.sync_status,
              u.name AS author_name
       FROM files f
       JOIN users u ON u.id = f.author_id
       WHERE f.id = $1`,
      [id],
    );
    if (!file.rows[0]) return next(createError('Файл не найден', 404));
    res.json(file.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
