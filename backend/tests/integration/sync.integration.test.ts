// Мокаем зависимости, чтобы тесты не трогали реальную БД
jest.mock('../../src/config/database', () => ({
  internalPool: { query: jest.fn() },
  externalPool: { query: jest.fn() },
}));

import { syncFromExternal, processOutbox } from '../../src/services/syncService';
import { internalPool, externalPool } from '../../src/config/database';

describe('Integration Tests – Sync with 1C', () => {
  beforeEach(() => jest.clearAllMocks());

  it('IT-01: Outbox sends ticket.created to external DB', async () => {
    (internalPool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 'ev1', event_type: 'ticket.created', aggregate_id: 't1', payload: { subject: 'Новое' } }] })
      .mockResolvedValueOnce({ rows: [] }) // update processed
      .mockResolvedValueOnce({ rows: [{ ticket_number_1c: null }] });
    (externalPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ неоID: 999 }] });

    await processOutbox();
    expect(externalPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "неоОбращенияКлиента"'),
      expect.anything()
    );
  });

  it('IT-02: Inbound sync creates services from external DB', async () => {
    (externalPool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 1, phone: '+79990000001', subject: 'Тест', urgency: 'Средняя', author: 'Иванов', status: 'Создано' }],
    });
    (internalPool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] }) // user not exist
      .mockResolvedValueOnce({ rows: [{ organization_id: 'org1' }] })
      .mockResolvedValueOnce({ rows: [] }) // existing ticket
      .mockResolvedValueOnce({ rows: [{ id: 't1' }] });
    await syncFromExternal();
    expect(internalPool.query).toHaveBeenCalled();
  });
});
