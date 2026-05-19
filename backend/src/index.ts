import 'dotenv/config';
import http from 'http';
import { createApp }        from './app';
import { testConnections }  from './config/database';
import { initWebSocket }    from './services/websocketService';
import { startSyncService } from './services/syncService';
import { runMigrations }    from './db/migrate';

const PORT = Number(process.env.PORT) || 3000;

async function main(): Promise<void> {
  try {
    // 1. Соединение с БД
    await testConnections();

    // 2. Применяем миграции внутренней БД
    await runMigrations();

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
