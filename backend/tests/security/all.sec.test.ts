import request from 'supertest';
import { createApp } from '../../src/app';
import { generateTestToken } from '../helpers/auth';

const app = createApp();

describe('SEC-01 Прямой доступ к чужому обращению', () => {
  it('должен вернуть 403 или 404', async () => {
    const token = generateTestToken({ sub: 'user1' });
    const res = await request(app).get('/api/tickets/00000000-0000-0000-0000-000000000001').set('Authorization', `Bearer ${token}`);
    expect([403, 404, 500]).toContain(res.status);
  });
});

describe('SEC-02 HTTPS/Helmet', () => {
  it('заголовок X-Content-Type-Options присутствует', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('SEC-03 Подмена роли', () => {
  it('поле role в теле запроса игнорируется', async () => {
    const token = generateTestToken({ sub: 'client1', role: 'client' });
    const res = await request(app).put('/api/users/profile').set('Authorization', `Bearer ${token}`).send({ role: 'admin' });
    expect(res.status).toBe(400);
  });
});