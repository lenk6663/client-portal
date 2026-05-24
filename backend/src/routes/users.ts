import { Router, Request, Response, NextFunction } from 'express';
import { z }  from 'zod';
import bcrypt from 'bcryptjs';
import { internalPool } from '../config/database';
import { requireAuth }  from '../middleware/auth';
import { createError }  from '../middleware/errorHandler';

const router = Router();
router.use(requireAuth);

const profileUpdateSchema = z.object({
  name:  z.string().min(2).max(255).optional(),
  email: z.string().email().optional().or(z.literal('')),
});

const notifSettingsSchema = z.object({
  email:     z.boolean().optional(),
  push:      z.boolean().optional(),
  sms:       z.boolean().optional(),
  on_status: z.boolean().optional(),
  on_message:z.boolean().optional(),
});

const passwordChangeSchema = z.object({
  old_password: z.string().optional(),  // не требуется, если пароля ещё нет
  new_password: z.string().min(6, 'Пароль должен быть минимум 6 символов'),
});

// ──────────────────────────────────────────────────────────
// GET /api/users/profile
// ──────────────────────────────────────────────────────────
router.get('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await internalPool.query(
      `SELECT u.id, u.phone, u.name, u.email, u.role, u.can_approve,
              u.notification_settings, u.created_at, u.updated_at,
              o.name AS organization_name, o.inn AS organization_inn
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE u.id = $1`,
      [req.user!.sub],
    );
    if (!result.rows[0]) return next(createError('Пользователь не найден', 404));
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// PUT /api/users/profile
// ──────────────────────────────────────────────────────────
router.put('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = profileUpdateSchema.parse(req.body);
    const fields: string[] = [];
    const vals:   unknown[]= [];
    let p = 1;

    if (data.name  !== undefined) { fields.push(`name = $${p++}`);  vals.push(data.name);  }
    if (data.email !== undefined) { fields.push(`email = $${p++}`); vals.push(data.email || null); }

    if (!fields.length) return next(createError('Нет полей для обновления', 400));

    vals.push(req.user!.sub);
    const result = await internalPool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${p} RETURNING id, phone, name, email, role, updated_at`,
      vals,
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// GET /api/users/notification-settings
// ──────────────────────────────────────────────────────────
router.get('/notification-settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await internalPool.query(
      `SELECT notification_settings FROM users WHERE id = $1`, [req.user!.sub],
    );
    res.json(result.rows[0]?.notification_settings ?? {});
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// PUT /api/users/notification-settings
// ──────────────────────────────────────────────────────────
router.put('/notification-settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = notifSettingsSchema.parse(req.body);
    const result = await internalPool.query(
      `UPDATE users
       SET notification_settings = COALESCE(notification_settings, '{}') || $1::jsonb
       WHERE id = $2
       RETURNING notification_settings`,
      [JSON.stringify(data), req.user!.sub],
    );
    res.json(result.rows[0]?.notification_settings ?? {});
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// PUT /api/users/password — сменить пароль
// Если у пользователя ещё нет пароля — old_password можно опустить
// ──────────────────────────────────────────────────────────
router.put('/password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { old_password, new_password } = passwordChangeSchema.parse(req.body);
    const userId = req.user!.sub;

    const userRes = await internalPool.query(
      `SELECT password_hash FROM users WHERE id = $1`, [userId],
    );
    if (userRes.rowCount === 0) return next(createError('Пользователь не найден', 404));
    const currentHash = userRes.rows[0].password_hash as string | null;

    // Если есть текущий пароль — проверяем old_password
    if (currentHash) {
      if (!old_password) {
        return next(createError('Введите текущий пароль', 400));
      }
      const ok = await bcrypt.compare(old_password, currentHash);
      if (!ok) {
        return next(createError('Текущий пароль введён неверно', 401));
      }
    }

    const newHash = await bcrypt.hash(new_password, 10);
    await internalPool.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [newHash, userId],
    );

    res.json({ message: 'Пароль обновлён' });
  } catch (err) {
    next(err);
  }
});

export default router;
