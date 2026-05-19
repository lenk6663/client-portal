import { Router, Request, Response, NextFunction } from 'express';
import { z }    from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { internalPool } from '../config/database';
import { requireAuth }  from '../middleware/auth';
import { createError }  from '../middleware/errorHandler';
import { broadcastToTicket } from '../services/websocketService';

const router = Router({ mergeParams: true });
router.use(requireAuth);

const sendMessageSchema = z.object({
  text:       z.string().min(1),
  type:       z.enum(['text', 'system', 'file']).default('text'),
  metadata:   z.record(z.unknown()).optional(),
  message_id: z.string().uuid().optional(), // клиентский идемпотентный ID
});

// ──────────────────────────────────────────────────────────
// GET /api/tickets/:id/messages
// ──────────────────────────────────────────────────────────
router.get('/:id/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id }  = req.params;
    const userId  = req.user!.sub;
    const role    = req.user!.role;

    const ticket = await internalPool.query(
      `SELECT client_id FROM tickets WHERE id = $1`, [id],
    );
    if (!ticket.rows[0]) return next(createError('Обращение не найдено', 404));
    if (role === 'client' && ticket.rows[0].client_id !== userId) {
      return next(createError('Нет доступа', 403));
    }

    const result = await internalPool.query(
      `SELECT m.*, u.name AS author_name, u.role AS author_role
       FROM messages m
       JOIN users u ON u.id = m.author_id
       WHERE m.ticket_id = $1
       ORDER BY m.sent_at ASC`,
      [id],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// POST /api/tickets/:id/messages
// ──────────────────────────────────────────────────────────
router.post('/:id/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id }  = req.params;
    const userId  = req.user!.sub;
    const role    = req.user!.role;
    const data    = sendMessageSchema.parse(req.body);

    const ticket = await internalPool.query(
      `SELECT client_id, status_code FROM tickets WHERE id = $1`, [id],
    );
    if (!ticket.rows[0]) return next(createError('Обращение не найдено', 404));
    if (role === 'client' && ticket.rows[0].client_id !== userId) {
      return next(createError('Нет доступа', 403));
    }

    const msgId = data.message_id ?? uuidv4();

    // Идемпотентность: не создаём дубль
    const exists = await internalPool.query(
      `SELECT id FROM messages WHERE id = $1`, [msgId],
    );
    if (exists.rows[0]) {
      return res.status(200).json(exists.rows[0]);
    }

    const { rows } = await internalPool.query(
      `INSERT INTO messages (id, ticket_id, author_id, text, type, metadata, sync_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [msgId, id, userId, data.text, data.type, data.metadata ? JSON.stringify(data.metadata) : null],
    );

    // Добавляем в outbox
    await internalPool.query(
      `INSERT INTO outbox (event_type, aggregate_id, aggregate_type, payload)
       VALUES ('message.created', $1, 'message', $2)`,
      [msgId, JSON.stringify({ ticket_id: id, ...rows[0] })],
    );

    // WebSocket push
    broadcastToTicket(id, {
      type:    'message.new',
      payload: { ...rows[0], author_name: req.user!.phone },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
