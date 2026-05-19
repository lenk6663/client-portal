import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt    from 'jsonwebtoken';
import crypto from 'crypto';
import { z }  from 'zod';
import { internalPool } from '../config/database';
import { requireAuth }  from '../middleware/auth';
import { createError }  from '../middleware/errorHandler';

const router = Router();

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET!;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES  || '15m';
const REFRESH_EXPIRES= process.env.JWT_REFRESH_EXPIRES || '30d';

type JwtExpiry = jwt.SignOptions['expiresIn'];

function signAccess(userId: string, phone: string, role: string): string {
  return jwt.sign({ sub: userId, phone, role }, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES as JwtExpiry });
}

function signRefresh(userId: string): string {
  return jwt.sign({ sub: userId }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES as JwtExpiry });
}

async function storeRefreshToken(userId: string, token: string): Promise<void> {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await internalPool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt],
  );
}

// ──────────────────────────────────────────────────────────
// POST /api/auth/login — запросить OTP-код
// ──────────────────────────────────────────────────────────
const loginSchema = z.object({
  phone: z.string().regex(/^\+7\d{10}$/, 'Формат: +79991234567'),
});

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone } = loginSchema.parse(req.body);

    // Генерация 6-значного кода
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 минут

    await internalPool.query(
      `INSERT INTO otp_codes (phone, code, expires_at) VALUES ($1, $2, $3)`,
      [phone, code, expiresAt],
    );

    // В DEV-режиме возвращаем код в ответе
    const devMode = process.env.SMS_DEV_MODE === 'true';
    if (!devMode) {
      // TODO: интеграция с SMS-провайдером
      console.log(`[SMS] Код ${code} для ${phone}`);
    }

    res.json({
      message: 'Код отправлен',
      ...(devMode ? { dev_code: code } : {}),
    });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// POST /api/auth/verify — подтвердить OTP, получить токены
// ──────────────────────────────────────────────────────────
const verifySchema = z.object({
  phone: z.string(),
  code:  z.string().length(6),
});

router.post('/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, code } = verifySchema.parse(req.body);

    const otpResult = await internalPool.query(
      `SELECT id FROM otp_codes
       WHERE phone = $1 AND code = $2 AND used = false AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [phone, code],
    );

    if (otpResult.rowCount === 0) {
      return next(createError('Неверный или истёкший код', 400));
    }

    // Помечаем код как использованный
    await internalPool.query(
      `UPDATE otp_codes SET used = true WHERE id = $1`,
      [otpResult.rows[0].id],
    );

    // Находим или создаём пользователя
    let userResult = await internalPool.query(
      `SELECT id, phone, name, role FROM users WHERE phone = $1`,
      [phone],
    );

    if (userResult.rowCount === 0) {
      userResult = await internalPool.query(
        `INSERT INTO users (phone, name, role) VALUES ($1, $2, 'client')
         RETURNING id, phone, name, role`,
        [phone, phone],
      );
    }

    const user = userResult.rows[0];
    const accessToken  = signAccess(user.id, user.phone, user.role);
    const refreshToken = signRefresh(user.id);
    await storeRefreshToken(user.id, refreshToken);

    res.json({ access_token: accessToken, refresh_token: refreshToken, user });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// POST /api/auth/refresh — обновить access token
// ──────────────────────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refresh_token } = req.body as { refresh_token?: string };
    if (!refresh_token) return next(createError('refresh_token обязателен', 400));

    let payload: { sub: string };
    try {
      payload = jwt.verify(refresh_token, REFRESH_SECRET) as { sub: string };
    } catch {
      return next(createError('Refresh token недействителен', 401));
    }

    const hash = crypto.createHash('sha256').update(refresh_token).digest('hex');
    const tokenRow = await internalPool.query(
      `SELECT id FROM refresh_tokens
       WHERE user_id = $1 AND token_hash = $2 AND revoked = false AND expires_at > now()`,
      [payload.sub, hash],
    );
    if (tokenRow.rowCount === 0) return next(createError('Refresh token отозван', 401));

    // Ротация: отзываем старый, выдаём новый
    await internalPool.query(`UPDATE refresh_tokens SET revoked = true WHERE id = $1`, [tokenRow.rows[0].id]);

    const user = await internalPool.query(
      `SELECT id, phone, role FROM users WHERE id = $1`, [payload.sub],
    );
    if (user.rowCount === 0) return next(createError('Пользователь не найден', 404));

    const u = user.rows[0];
    const newAccess  = signAccess(u.id, u.phone, u.role);
    const newRefresh = signRefresh(u.id);
    await storeRefreshToken(u.id, newRefresh);

    res.json({ access_token: newAccess, refresh_token: newRefresh });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// POST /api/auth/logout
// ──────────────────────────────────────────────────────────
router.post('/logout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refresh_token } = req.body as { refresh_token?: string };
    if (refresh_token) {
      const hash = crypto.createHash('sha256').update(refresh_token).digest('hex');
      await internalPool.query(
        `UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND token_hash = $2`,
        [req.user!.sub, hash],
      );
    }
    res.json({ message: 'Выход выполнен' });
  } catch (err) {
    next(err);
  }
});

export default router;
