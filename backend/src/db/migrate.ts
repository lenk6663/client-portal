import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { internalPool } from '../config/database';

const DEFAULT_TEST_PASSWORD = 'test1234';
const SEEDED_PHONES = [
  '+79991234567',  // Александрова (client)
  '+79009876543',  // Петров      (client)
  '+79990000001',  // Иванов      (operator)
  '+79990000002',  // Админ       (admin)
];

export async function runMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`▶  Applying migration: ${file}`);
    await internalPool.query(sql);
    console.log(`✅  Migration applied: ${file}`);
  }

  // Сидим тестовые пароли (только для тех юзеров, у кого их ещё нет)
  await seedPasswords();
}

async function seedPasswords(): Promise<void> {
  const hash = await bcrypt.hash(DEFAULT_TEST_PASSWORD, 10);
  const result = await internalPool.query(
    `UPDATE users
       SET password_hash = $1
     WHERE phone = ANY($2::text[])
       AND password_hash IS NULL`,
    [hash, SEEDED_PHONES],
  );
  if (result.rowCount && result.rowCount > 0) {
    console.log(
      `🔐  Seeded passwords for ${result.rowCount} users (default password: ${DEFAULT_TEST_PASSWORD})`,
    );
  } else {
    console.log('🔐  Passwords already set (или нет тестовых юзеров) — skip seed');
  }
}

// Прямой запуск: ts-node src/db/migrate.ts
if (require.main === module) {
  // dotenv нужен только при запуске вне Docker (локально)
  // В Docker env приходят через docker-compose
  try { require('dotenv').config(); } catch (_) { /* ignore */ }

  runMigrations()
    .then(() => { console.log('Done'); process.exit(0); })
    .catch((e) => { console.error('❌  Migration failed:', e); process.exit(1); });
}
