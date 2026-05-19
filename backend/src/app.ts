import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import authRouter        from './routes/auth';
import ticketsRouter     from './routes/tickets';
import messagesRouter    from './routes/messages';
import filesRouter       from './routes/files';
import usersRouter       from './routes/users';
import dictionariesRouter from './routes/dictionaries';
import { errorHandler }  from './middleware/errorHandler';

export function createApp(): Application {
  const app = express();

  // ── Security headers ──────────────────────────────────────
  app.use(helmet());

  // ── CORS ─────────────────────────────────────────────────
  app.use(cors({
    origin: process.env.NODE_ENV === 'production'
      ? process.env.ALLOWED_ORIGINS?.split(',') ?? []
      : '*',
    credentials: true,
  }));

  // ── Body parsing ──────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));

  // ── Logging ───────────────────────────────────────────────
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  // ── Rate limiting ─────────────────────────────────────────
  app.use('/api/auth', rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 min
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много запросов, повторите через 15 минут' },
  }));

  app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много запросов' },
  }));

  // ── Routes ────────────────────────────────────────────────
  app.use('/api/auth',         authRouter);
  app.use('/api/tickets',      ticketsRouter);
  app.use('/api/tickets',      messagesRouter);   // /tickets/:id/messages
  app.use('/api/files',        filesRouter);
  app.use('/api/users',        usersRouter);
  app.use('/api/dictionaries', dictionariesRouter);

  // ── Health check ──────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  // ── Error handler (must be last) ─────────────────────────
  app.use(errorHandler);

  return app;
}
