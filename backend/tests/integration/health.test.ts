import request from 'supertest';
import { createApp } from '../../src/app';

const app = createApp();

describe('Health check', () => {
  it('GET /health should return 200 and status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('ts');
  });
});
