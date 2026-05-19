import { Router, Request, Response, NextFunction } from 'express';
import { internalPool } from '../config/database';

const router = Router();

// ──────────────────────────────────────────────────────────
// GET /api/dictionaries/services
// ──────────────────────────────────────────────────────────
router.get('/services', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await internalPool.query(
      `SELECT code, name, description, is_active, valid_from, valid_to
       FROM services
       WHERE is_active = true AND (valid_to IS NULL OR valid_to > now())
       ORDER BY name`,
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// GET /api/dictionaries/departments
// ──────────────────────────────────────────────────────────
router.get('/departments', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await internalPool.query(
      `SELECT code, name, description, is_active
       FROM departments
       WHERE is_active = true
       ORDER BY name`,
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// GET /api/dictionaries/statuses
// ──────────────────────────────────────────────────────────
router.get('/statuses', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await internalPool.query(
      `SELECT code, name, description, is_active
       FROM statuses
       WHERE is_active = true
       ORDER BY name`,
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

export default router;
