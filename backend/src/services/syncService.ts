import { internalPool, externalPool } from '../config/database';
import { broadcastToTicket } from './websocketService';

// ── Маппинг статусов: внешняя БД (1С) → внутренняя ─────────
const STATUS_MAP: Record<string, string> = {
  'Создано':                   'new',
  'В работе':                  'in_progress',
  'На согласовании':           'on_approval',
  'Ожидание ответа клиента':   'pending_client',
  'Выполнено':                 'done',
  'Закрыто':                   'closed',
  'Отклонено':                 'cancelled',
  'На утверждении':            'on_approval',
};

// ── Маппинг срочности ────────────────────────────────────────
const URGENCY_MAP: Record<string, string> = {
  'Высокая':    'high',
  'Средняя':    'medium',
  'Низкая':     'low',
  'Критический':'critical',
  'Высокий':    'high',
  'Средний':    'medium',
  'Низкий':     'low',
};

// ── Маппинг отделов ──────────────────────────────────────────
const DEPT_MAP: Record<string, string> = {
  'Отдел продаж':       'sales',
  'Юридический отдел':  'legal',
  'IT отдел':           'admin',
  'Отдел разработки':   'dev',
  'Отдел качества':     'quality',
  'Техподдержка':       'tech_support',
  'Биллинг':            'billing',
};

function mapDept(raw: string | null): string | null {
  if (!raw) return null;
  return DEPT_MAP[raw] ?? raw.toLowerCase().replace(/\s+/g, '_');
}

// ── Получить или создать пользователя по телефону ────────────
async function ensureUser(phone: string, name: string): Promise<string> {
  const existing = await internalPool.query(
    `SELECT id FROM users WHERE phone = $1`, [phone],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  // Попытаемся привязать к дефолтной организации
  const orgRow = await internalPool.query(
    `SELECT id FROM organizations LIMIT 1`,
  );
  const orgId = orgRow.rows[0]?.id ?? null;

  const { rows } = await internalPool.query(
    `INSERT INTO users (phone, name, role, organization_id)
     VALUES ($1, $2, 'client', $3) RETURNING id`,
    [phone, name || phone, orgId],
  );
  return rows[0].id;
}

// ════════════════════════════════════════════════════════════
// syncFromExternal — тянем обращения из 1С в внутреннюю БД
// ════════════════════════════════════════════════════════════
async function syncFromExternal(): Promise<void> {
  const started = Date.now();
  let synced = 0;
  let errors = 0;

  try {
    // Запрашиваем все обращения из внешней БД с их последним статусом
    const extTickets = await externalPool.query<{
      id: number;
      date: string;
      phone: string;
      email: string | null;
      subject: string;
      urgency: string;
      service: string | null;
      dept: string | null;
      author: string;
      priority: string | null;
      comment: string | null;
      content: string | null;
      edit_date: string | null;
      has_file: boolean;
      status: string | null;
      responsible: string | null;
    }>(
      `SELECT
         t."неоID"                         AS id,
         t."неоДата"                        AS date,
         COALESCE(t."неоТелефон", '')       AS phone,
         t."неоemail"                       AS email,
         COALESCE(t."неоТема", 'Без темы')  AS subject,
         COALESCE(t."неоКатегорияСрочности",'Средняя') AS urgency,
         t."неоУслуга"                      AS service,
         t."неоОтдел"                       AS dept,
         COALESCE(t."неоАвтор", '')         AS author,
         t."неоПриоритет"                   AS priority,
         t."неоКомментарий"                 AS comment,
         t."неоСодержание"                  AS content,
         t."неоДатаРедактирования"          AS edit_date,
         COALESCE(t."неоЕстьВложение", false) AS has_file,
         h."неоСтатусОбращения"             AS status,
         h."неоОтветственный"               AS responsible
       FROM "неоОбращенияКлиента" t
       LEFT JOIN LATERAL (
         SELECT "неоСтатусОбращения", "неоОтветственный"
         FROM "неоИсторияОбращения"
         WHERE "неоОбращениеID" = t."неоID"
         ORDER BY "неоДата" DESC LIMIT 1
       ) h ON true`,
    );

    for (const row of extTickets.rows) {
      try {
        const externalId    = String(row.id);
        const ticketNumber  = `О-${row.id}`;
        const statusCode    = STATUS_MAP[row.status ?? ''] ?? 'new';
        const urgencyCode   = URGENCY_MAP[row.urgency] ?? 'medium';
        const deptCode      = mapDept(row.dept);

        // Найти/создать клиента
        const phone  = row.phone.startsWith('+') ? row.phone : `+${row.phone}`;
        const userId = await ensureUser(phone, row.author);

        // Найти организацию пользователя
        const orgRow = await internalPool.query(
          `SELECT organization_id FROM users WHERE id = $1`, [userId],
        );
        const orgId  = orgRow.rows[0]?.organization_id;
        if (!orgId) continue;   // нет организации — пропускаем

        // Upsert обращения
        const existing = await internalPool.query(
          `SELECT id, version, status_code FROM tickets WHERE ticket_number_1c = $1`,
          [ticketNumber],
        );

        if (existing.rows[0]) {
          const current = existing.rows[0];
          const ticketId = current.id as string;

          // Обновляем только если статус изменился
          if (current.status_code !== statusCode) {
            await internalPool.query(
              `UPDATE tickets
               SET status_code = $1, assigned_department = $2, assigned_operator = $3,
                   updated_at_1c = $4, last_sync_at = now(), sync_status = 'synced',
                   version = version + 1
               WHERE id = $5`,
              [statusCode, deptCode, row.responsible, row.edit_date, ticketId],
            );

            await internalPool.query(
              `INSERT INTO ticket_history (ticket_id, field_name, old_value, new_value, source)
               VALUES ($1, 'status', $2, $3, '1c')`,
              [ticketId, current.status_code, statusCode],
            );

            broadcastToTicket(ticketId, {
              type:    'ticket.sync',
              payload: { status_code: statusCode, assigned_operator: row.responsible },
            });
          } else {
            await internalPool.query(
              `UPDATE tickets SET last_sync_at = now(), sync_status = 'synced' WHERE id = $1`,
              [ticketId],
            );
          }
        } else {
          // Новое обращение из 1С
          const { rows: inserted } = await internalPool.query(
            `INSERT INTO tickets
               (ticket_number_1c, client_id, organization_id, subject, description,
                type, urgency, status_code, assigned_department, assigned_operator,
                created_at_1c, updated_at_1c, last_sync_at, sync_status)
             VALUES ($1,$2,$3,$4,$5,'ticket',$6,$7,$8,$9,$10,$11,now(),'synced')
             RETURNING id`,
            [
              ticketNumber, userId, orgId,
              row.subject, row.content ?? row.comment,
              urgencyCode, statusCode, deptCode, row.responsible,
              row.date, row.edit_date,
            ],
          );

          const ticketId = inserted[0].id as string;

          // Услуга
          if (row.service) {
            const svcCode = row.service.toLowerCase().replace(/\s+/g, '_');
            await internalPool.query(
              `INSERT INTO ticket_services (ticket_id, service_code) VALUES ($1,$2)
               ON CONFLICT DO NOTHING`,
              [ticketId, svcCode],
            );
          }

          // История из внешней БД
          const history = await externalPool.query(
            `SELECT "неоДата","неоСтатусОбращения","неоОтветственный"
             FROM "неоИсторияОбращения"
             WHERE "неоОбращениеID" = $1 ORDER BY "неоДата" ASC`,
            [row.id],
          );
          for (const h of history.rows) {
            const hStatus = STATUS_MAP[h['неоСтатусОбращения']] ?? h['неоСтатусОбращения'];
            await internalPool.query(
              `INSERT INTO ticket_history (ticket_id, changed_at, field_name, new_value, source)
               VALUES ($1, $2, 'status', $3, '1c')`,
              [ticketId, h['неоДата'], hStatus],
            );
          }
        }

        synced++;
      } catch (e) {
        errors++;
        console.error('[SYNC] Ошибка обработки обращения', row.id, e);
      }
    }

    // Синхронизируем чат-сообщения из 1С
    await syncMessages();

    await internalPool.query(
      `INSERT INTO sync_log (direction, entity_type, status, duration_ms)
       VALUES ('inbound', 'tickets', 'success', $1)`,
      [Date.now() - started],
    );

    if (synced > 0 || errors > 0) {
      console.log(`[SYNC] ← Входящая синхронизация: ${synced} обращений, ошибок: ${errors}`);
    }
  } catch (err) {
    await internalPool.query(
      `INSERT INTO sync_log (direction, entity_type, status, error_message, duration_ms)
       VALUES ('inbound', 'tickets', 'error', $1, $2)`,
      [String(err), Date.now() - started],
    );
    console.error('[SYNC] Критическая ошибка синхронизации:', err);
  }
}

// ────────────────────────────────────────────────────────────
// Синхронизация сообщений чата из 1С → внутреннняя БД
// ────────────────────────────────────────────────────────────
async function syncMessages(): Promise<void> {
  const extMessages = await externalPool.query(
    `SELECT "неоID" AS id, "неоОбращениеID" AS ticket_1c_id,
            "неоДата" AS sent_at, "неоТекст" AS text,
            "неоОтправитель" AS sender
     FROM "неоЧатСКлиентом"
     ORDER BY "неоДата" ASC`,
  );

  for (const m of extMessages.rows) {
    const ticketNum = `О-${m.ticket_1c_id}`;
    const ticketRow = await internalPool.query(
      `SELECT id FROM tickets WHERE ticket_number_1c = $1`, [ticketNum],
    );
    if (!ticketRow.rows[0]) continue;

    const ticketId = ticketRow.rows[0].id as string;
    const metaKey  = `1c_msg_${m.id}`;

    // Идемпотентность: проверяем по metadata
    const exists = await internalPool.query(
      `SELECT id FROM messages WHERE ticket_id = $1 AND metadata->>'1c_id' = $2`,
      [ticketId, String(m.id)],
    );
    if (exists.rows[0]) continue;

    // Получаем/создаём пользователя-отправителя
    const authorId = await ensureUser(`+7_1c_${m.id}`, m.sender ?? 'Оператор 1С');

    await internalPool.query(
      `INSERT INTO messages (ticket_id, author_id, text, sent_at, type, metadata, sync_status)
       VALUES ($1, $2, $3, $4, 'text', $5, 'synced')`,
      [ticketId, authorId, m.text, m.sent_at, JSON.stringify({ '1c_id': String(m.id), sender: m.sender })],
    );
  }
}

// ════════════════════════════════════════════════════════════
// processOutbox — отправляем события из outbox во внешнюю БД
// ════════════════════════════════════════════════════════════
async function processOutbox(): Promise<void> {
  const { rows: events } = await internalPool.query(
    `SELECT * FROM outbox
     WHERE status = 'pending' AND scheduled_after <= now()
     ORDER BY created_at ASC
     LIMIT 50`,
  );

  for (const event of events) {
    try {
      await handleOutboxEvent(event);
      await internalPool.query(
        `UPDATE outbox SET status = 'processed' WHERE id = $1`, [event.id],
      );
    } catch (err) {
      const retries = event.retry_count + 1;
      const delay   = Math.min(300, 5 * Math.pow(2, retries)); // экспоненциальная задержка (сек)
      await internalPool.query(
        `UPDATE outbox
         SET status = CASE WHEN retry_count >= 5 THEN 'failed' ELSE 'pending' END,
             retry_count = $1, last_error = $2,
             scheduled_after = now() + ($3 || ' seconds')::interval
         WHERE id = $4`,
        [retries, String(err), delay, event.id],
      );
    }
  }
}

async function handleOutboxEvent(event: {
  id: string;
  event_type: string;
  aggregate_id: string;
  aggregate_type: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (event.event_type === 'ticket.created') {
    // Создаём обращение в 1С
    const t = event.payload;
    const result = await externalPool.query(
      `INSERT INTO "неоОбращенияКлиента"
         ("неоТема","неоСодержание","неоАвтор")
       VALUES ($1,$2,$3)
       RETURNING "неоID"`,
      [t.subject, t.description ?? '', 'Портал клиента'],
    );
    const ext1cId = result.rows[0]?.['неоID'];

    if (ext1cId) {
      const ticketNumber = `О-${ext1cId}`;
      await internalPool.query(
        `UPDATE tickets SET ticket_number_1c = $1, sync_status = 'synced', last_sync_at = now()
         WHERE id = $2`,
        [ticketNumber, event.aggregate_id],
      );
    }
  }

  if (event.event_type === 'message.created') {
    // Записываем сообщение в чат 1С
    const m = event.payload as { ticket_id: string; text: string };
    const ticketRow = await internalPool.query(
      `SELECT ticket_number_1c FROM tickets WHERE id = $1`, [m.ticket_id],
    );
    const num = ticketRow.rows[0]?.ticket_number_1c;
    if (num) {
      const extId = Number(num.replace('О-', ''));
      await externalPool.query(
        `INSERT INTO "неоЧатСКлиентом"
           ("неоОбращениеID","неоТекст","неоОтправитель")
         VALUES ($1,$2,'Клиент (портал)')`,
        [extId, m.text],
      );
    }
    await internalPool.query(
      `UPDATE messages SET sync_status = 'synced' WHERE id = $1`, [event.aggregate_id],
    );
  }

  if (event.event_type === 'file.uploaded') {
    // В 1С пишем путь к файлу
    const f = event.payload as { ticket_id: string; original_name: string; storage_path: string };
    const ticketRow = await internalPool.query(
      `SELECT ticket_number_1c FROM tickets WHERE id = $1`, [f.ticket_id],
    );
    const num = ticketRow.rows[0]?.ticket_number_1c;
    if (num) {
      const extId = Number(num.replace('О-', ''));
      await externalPool.query(
        `INSERT INTO "неоПрикрепленныеФайлы" ("неоОбращениеID","неоПутьКФайлу")
         VALUES ($1,$2)`,
        [extId, f.storage_path],
      );
    }
    await internalPool.query(
      `UPDATE files SET sync_status = 'synced' WHERE id = $1`, [event.aggregate_id],
    );
  }
}

// ════════════════════════════════════════════════════════════
// startSyncService — запуск обоих воркеров
// ════════════════════════════════════════════════════════════
export function startSyncService(): void {
  const syncInterval   = Number(process.env.SYNC_INTERVAL_MS)   || 30000;
  const outboxInterval = Number(process.env.OUTBOX_POLL_INTERVAL_MS) || 5000;

  // Первый запуск сразу
  setTimeout(() => syncFromExternal().catch(console.error), 3000);
  setTimeout(() => processOutbox().catch(console.error),    1000);

  setInterval(() => syncFromExternal().catch(console.error), syncInterval);
  setInterval(() => processOutbox().catch(console.error),    outboxInterval);

  console.log(`🔄  Sync service: входящий каждые ${syncInterval / 1000}s, outbox каждые ${outboxInterval / 1000}s`);
}
