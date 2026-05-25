import request from 'supertest';
import { createApp } from '../../src/app';
import bcrypt from 'bcryptjs';

// Мокаем весь модуль database.ts
jest.mock('../../src/config/database', () => ({
  internalPool: {
    query: jest.fn(),
  },
  externalPool: {
    query: jest.fn(),
  },
}));

import { internalPool, externalPool } from '../../src/config/database';

const app = createApp();

describe('Auth API (mocked DB)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /api/auth/login – успешно возвращает dev_code', async () => {
    // Мокаем поиск пользователя
    (internalPool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 'user1', password_hash: await bcrypt.hash('test1234', 10) }],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ phone: '+79991234567', password: 'test1234' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dev_code');
    expect(res.body.dev_code).toMatch(/^\d{6}$/);

    // Проверяем, что OTP был сохранён в БД
    expect(internalPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO otp_codes'),
      expect.arrayContaining(['+79991234567', expect.any(String)])
    );
  });

  it('POST /api/auth/login – ошибка при неверном пароле', async () => {
    (internalPool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 'user1', password_hash: await bcrypt.hash('realpass', 10) }],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ phone: '+79991234567', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Неверный телефон или пароль');
  });
});
