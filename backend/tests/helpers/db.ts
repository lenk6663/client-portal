import { internalPool, externalPool } from "../../src/config/database";

export async function clearDatabase() {
  const tables = ["users", "tickets", "messages", "files", "outbox", "refresh_tokens", "otp_codes", "ticket_history", "ticket_services"];
  for (const table of tables) {
    await internalPool.query(`TRUNCATE ${table} RESTART IDENTITY CASCADE`);
  }
  await externalPool.query(`TRUNCATE "неоОбращенияКлиента", "неоИсторияОбращения", "неоЧатСКлиентом" CASCADE`);
}

export async function closePools() {
  await internalPool.end();
  await externalPool.end();
}
