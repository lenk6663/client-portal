import fs   from 'fs';
import path  from 'path';
import { internalPool } from '../config/database';

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
}

// Прямой запуск: ts-node src/db/migrate.ts
if (require.main === module) {
  runMigrations()
    .then(() => { console.log('Done'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
