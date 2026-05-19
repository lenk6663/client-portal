import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types';
import { createError } from './errorHandler';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(createError('Не авторизован', 401));
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, ACCESS_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    next(createError('Токен недействителен или истёк', 401));
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(createError('Не авторизован', 401));
    if (!roles.includes(req.user.role)) {
      return next(createError('Недостаточно прав', 403));
    }
    next();
  };
}
