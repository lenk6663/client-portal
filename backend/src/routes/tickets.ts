import { Router, Request, Response, NextFunction } from 'express';
import { z }    from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { internalPool } from '../config/database';
import { requireAuth }  from '../middleware/auth';
import { createError }  from '../middleware/errorHandler';
import { broadcastToTicket } from '../services/websocketService';

const router = Router();
router.use(requireAuth);

// ── Схемы валидации ───────────────────────────────────────
const createTicketSchema = z.object({
  subject:     z.string().min(3).max(500),
  description: z.string().optional(),
  type:        z.enum(['ticket', 'consultation', 'complaint', 'request', 'callback']).default('ticket'),
  urgency:     z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  services:    z.array(z.string()).optional(),
});

const updateTicketSchema = z.object({
  subject:             z.string().min(3).max(500).optional(),
  description:         z.string().optional(),
  urgency:             z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status_code:         z.string().optional(),
  assigned_department: z.string().optional(),
  services:            z.array(z.string()).optional(),
  approval:            z.record(z.unknown()).nullable().optional(),
  review:              z.record(z.unknown()).nullable().optional(),
  version:             z.number().int().positive(),  // для optimistic locking
});

// ──────────────────────────────────────────────────────────
// GET /api/tickets
// ──────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.sub;
    const role   = req.user!.role;

    const { status, type, urgency, page = '1', limit = '20' } = req.query as Record<string, string>;
    const offset = (Number(page) - 1) * Number(limit);

    const conditions: string[] = [];
    const params: unknown[]    = [];
    let p = 1;

    // Клиент видит только свои обращения
    if (role === 'client') {
      conditions.push(`t.client_id = $${p++}`);
      params.push(userId);
    }

    if (status) { conditions.push(`t.status_code = $${p++}`); params.push(status); }
    if (type)   { conditions.push(`t.type = $${p++}`);        params.push(type);   }
    if (urgency){ conditions.push(`t.urgency = $${p++}`);     params.push(urgency);}
    if (req.query.dateFrom) conditions.push(`t.created_at >= $${p++}`), params.push(req.query.dateFrom);
    if (req.query.dateTo) conditions.push(`t.created_at <= $${p++}`), params.push(req.query.dateTo);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await internalPool.query(
      `SELECT COUNT(*) FROM tickets t ${where}`, params,
    );
    const total = Number(countRes.rows[0].count);

    const result = await internalPool.query(
      `SELECT t.*,
              u.name  AS client_name,
              u.phone AS client_phone,
              COALESCE(
                (SELECT json_agg(COALESCE(s.name, ts.service_code) ORDER BY ts.sort_order)
                 FROM ticket_services ts
                 LEFT JOIN services s ON s.code = ts.service_code
                 WHERE ts.ticket_id = t.id), '[]'
              ) AS services
       FROM tickets t
       JOIN users u ON u.id = t.client_id
       ${where}
       ORDER BY t.updated_at DESC
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, Number(limit), offset],
    );

    res.json({
      data:  result.rows,
      total,
      page:  Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// POST /api/tickets
// ──────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createTicketSchema.parse(req.body);
    const userId = req.user!.sub;

    // Получаем organization_id пользователя
    const userRow = await internalPool.query(
      `SELECT organization_id FROM users WHERE id = $1`, [userId],
    );
    if (!userRow.rows[0]?.organization_id) {
      return next(createError('Пользователь не привязан к организации', 422));
    }
    const orgId = userRow.rows[0].organization_id;

    const client = await internalPool.connect();
    try {
      await client.query('BEGIN');

      const ticketId = uuidv4();
      const { rows } = await client.query(
        `INSERT INTO tickets (id, client_id, organization_id, subject, description, type, urgency, status_code, sync_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', 'pending')
         RETURNING *`,
        [ticketId, userId, orgId, data.subject, data.description, data.type, data.urgency],
      );

      // Услуги — принимаем как названия (рус.), так и коды
      if (data.services && data.services.length > 0) {
        for (let i = 0; i < data.services.length; i++) {
          const svcInput = data.services[i];
          const svcLookup = await client.query(
            `SELECT code FROM services WHERE name = $1 OR code = $1 LIMIT 1`,
            [svcInput],
          );
          const svcCode = svcLookup.rows[0]?.code ?? svcInput;
          await client.query(
            `INSERT INTO ticket_services (ticket_id, service_code, sort_order) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [ticketId, svcCode, i],
          );
        }
      }

      // История: создание
      await client.query(
        `INSERT INTO ticket_history (ticket_id, changed_by_user_id, field_name, new_value, source)
         VALUES ($1, $2, 'status', 'new', 'client')`,
        [ticketId, userId],
      );

      // Outbox: отправим в 1С
      await client.query(
        `INSERT INTO outbox (event_type, aggregate_id, aggregate_type, payload)
         VALUES ('ticket.created', $1, 'ticket', $2)`,
        [ticketId, JSON.stringify(rows[0])],
      );

      await client.query('COMMIT');

      res.status(201).json({ ...rows[0], services: data.services ?? [] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// GET /api/tickets/:id
// ──────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId  = req.user!.sub;
    const role    = req.user!.role;

    const result = await internalPool.query(
      `SELECT t.*,
              u.name  AS client_name,
              u.phone AS client_phone,
              COALESCE(
                (SELECT json_agg(COALESCE(s.name, ts.service_code) ORDER BY ts.sort_order)
                 FROM ticket_services ts
                 LEFT JOIN services s ON s.code = ts.service_code
                 WHERE ts.ticket_id = t.id), '[]'
              ) AS services
       FROM tickets t
       JOIN users u ON u.id = t.client_id
       WHERE t.id = $1`,
      [id],
    );

    if (!result.rows[0]) return next(createError('Обращение не найдено', 404));
    const ticket = result.rows[0];

    if (role === 'client' && ticket.client_id !== userId) {
      return next(createError('Нет доступа', 403));
    }

    res.json(ticket);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// PUT /api/tickets/:id
// ──────────────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id }  = req.params;
    const userId  = req.user!.sub;
    const role    = req.user!.role;
    const data    = updateTicketSchema.parse(req.body);

    const existing = await internalPool.query(
      `SELECT * FROM tickets WHERE id = $1`, [id],
    );
    if (!existing.rows[0]) return next(createError('Обращение не найдено', 404));

    const ticket = existing.rows[0];
    if (role === 'client' && ticket.client_id !== userId) {
      return next(createError('Нет доступа', 403));
    }

    // Optimistic locking
    if (ticket.version !== data.version) {
      // Сохраняем конфликт
      await internalPool.query(
        `INSERT INTO conflicts (ticket_id, client_version, c1_version, resolution)
         VALUES ($1, $2, $3, 'pending')`,
        [id, JSON.stringify(data), JSON.stringify(ticket)],
      );
      return next(createError('Конфликт версий. Обновите данные и повторите.', 409));
    }

    const client = await internalPool.connect();
    try {
      await client.query('BEGIN');

      const fields: string[] = [];
      const vals:   unknown[]= [];
      let p = 1;

      const trackFields = ['subject', 'description', 'urgency', 'status_code', 'assigned_department'] as const;
      for (const f of trackFields) {
        if (data[f] !== undefined && data[f] !== ticket[f]) {
          await client.query(
            `INSERT INTO ticket_history (ticket_id, changed_by_user_id, field_name, old_value, new_value, source)
             VALUES ($1, $2, $3, $4, $5, 'client')`,
            [id, userId, f, String(ticket[f] ?? ''), String(data[f])],
          );
          fields.push(`${f} = $${p++}`); vals.push(data[f]);
        }
      }

      // approval / review — отдельная обработка (JSONB)
      if (data.approval !== undefined) {
        await client.query(
          `INSERT INTO ticket_history (ticket_id, changed_by_user_id, field_name, old_value, new_value, source)
           VALUES ($1, $2, 'approval', $3, $4, 'client')`,
          [id, userId,
           ticket.approval ? JSON.stringify(ticket.approval) : '',
           JSON.stringify(data.approval)],
        );
        fields.push(`approval = $${p++}`);
        vals.push(data.approval === null ? null : JSON.stringify(data.approval));
      }
      if (data.review !== undefined) {
        await client.query(
          `INSERT INTO ticket_history (ticket_id, changed_by_user_id, field_name, old_value, new_value, source)
           VALUES ($1, $2, 'review', $3, $4, 'client')`,
          [id, userId,
           ticket.review ? JSON.stringify(ticket.review) : '',
           JSON.stringify(data.review)],
        );
        fields.push(`review = $${p++}`);
        vals.push(data.review === null ? null : JSON.stringify(data.review));
        // Если есть review, статус → done
        if (data.review && ticket.status_code !== 'done') {
          fields.push(`status_code = $${p++}`); vals.push('done');
        }
      }

      fields.push(`version = $${p++}`); vals.push(ticket.version + 1);
      fields.push(`sync_status = 'pending'`);
      vals.push(id);

      const updated = await client.query(
        `UPDATE tickets SET ${fields.join(', ')} WHERE id = $${p} RETURNING *`,
        vals,
      );

      // Обновляем услуги — принимаем как названия, так и коды
      if (data.services !== undefined) {
        await client.query(`DELETE FROM ticket_services WHERE ticket_id = $1`, [id]);
        for (let i = 0; i < data.services.length; i++) {
          const svcInput = data.services[i];
          // Находим service_code либо по name либо по code
          const svcLookup = await client.query(
            `SELECT code FROM services WHERE name = $1 OR code = $1 LIMIT 1`,
            [svcInput],
          );
          const svcCode = svcLookup.rows[0]?.code ?? svcInput;
          await client.query(
            `INSERT INTO ticket_services (ticket_id, service_code, sort_order) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [id, svcCode, i],
          );
        }
      }

      // Outbox
      await client.query(
        `INSERT INTO outbox (event_type, aggregate_id, aggregate_type, payload)
         VALUES ('ticket.updated', $1, 'ticket', $2)`,
        [id, JSON.stringify(updated.rows[0])],
      );

      await client.query('COMMIT');

      // WebSocket push
      broadcastToTicket(id, { type: 'ticket.updated', payload: updated.rows[0] });

      res.json(updated.rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// GET /api/tickets/:id/history
// ──────────────────────────────────────────────────────────
router.get('/:id/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId  = req.user!.sub;
    const role    = req.user!.role;

    const ticket = await internalPool.query(`SELECT client_id FROM tickets WHERE id = $1`, [id]);
    if (!ticket.rows[0]) return next(createError('Обращение не найдено', 404));
    if (role === 'client' && ticket.rows[0].client_id !== userId) {
      return next(createError('Нет доступа', 403));
    }

    const result = await internalPool.query(
      `SELECT h.*, u.name AS changed_by_name
       FROM ticket_history h
       LEFT JOIN users u ON u.id = h.changed_by_user_id
       WHERE h.ticket_id = $1
       ORDER BY h.changed_at DESC`,
      [id],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// GET /api/tickets/:id/sync-status
// ──────────────────────────────────────────────────────────
router.get('/:id/sync-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const row = await internalPool.query(
      `SELECT sync_status, last_sync_at, ticket_number_1c FROM tickets WHERE id = $1`, [id],
    );
    if (!row.rows[0]) return next(createError('Обращение не найдено', 404));
    res.json(row.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
