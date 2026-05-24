import 'dotenv/config';
import http from 'http';
import { createApp }        from './app';
import { testConnections, internalPool }  from './config/database';
import { initWebSocket }    from './services/websocketService';
import { startSyncService } from './services/syncService';

const PORT = Number(process.env.PORT) || 3000;

async function checkSchema(): Promise<void> {
  // Проверяем, что миграции были применены — без таблицы users работать нельзя
  const result = await internalPool.query(
    `SELECT to_regclass('public.users') AS users,
            to_regclass('public.tickets') AS tickets`,
  );
  const row = result.rows[0];
  if (!row.users || !row.tickets) {
    throw new Error(
      'Схема БД не инициализирована. ' +
      'Запустите миграции отдельно: `docker compose run --rm migrate` ' +
      'или локально: `npx ts-node src/db/migrate.ts`',
    );
  }
}

async function main(): Promise<void> {
  try {
    // 1. Соединение с БД
    await testConnections();

    // 2. Проверка, что миграции были применены (но НЕ применяем их здесь —
    //    миграции теперь выполняются отдельным сервисом `migrate` в docker-compose)
    await checkSchema();

    // 3. Express app
    const app    = createApp();
    const server = http.createServer(app);

    // 4. WebSocket
    initWebSocket(server);

    // 5. Сервис синхронизации с 1С
    startSyncService();

    // 6. Запуск
    server.listen(PORT, () => {
      console.log(`\n🚀  API запущен на http://localhost:${PORT}`);
      console.log(`🔌  WebSocket доступен на ws://localhost:${PORT}/ws`);
    });
  } catch (err) {
    console.error('❌  Ошибка при запуске:', err);
    process.exit(1);
  }
}

main();
