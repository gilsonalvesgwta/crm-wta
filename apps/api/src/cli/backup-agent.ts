// Serviço "backup" da stack: cópia diária no horário BACKUP_HORA (fuso TZ) e
// os pedidos da Plataforma (cópia agora, restaurar). Uso: node dist/cli/backup-agent.js
import { readFileSync } from 'node:fs';
import { BackupAgent } from '../backup/agent.js';

if (process.env.PGPASSWORD_FILE && !process.env.PGPASSWORD) process.env.PGPASSWORD = readFileSync(process.env.PGPASSWORD_FILE, 'utf8').trim();

const hora = /^(\d{2}):(\d{2})$/.exec(process.env.BACKUP_HORA ?? '03:30') ?? ['', '03', '30'];
const agent = new BackupAgent({
  backupDir: process.env.BACKUP_DIR ?? '/backups',
  filesDir: process.env.FILES_DIR ?? '/data/files',
  database: process.env.PGDATABASE ?? 'crm',
  migrateScript: process.env.MIGRATE_SCRIPT ?? '/app/db/migrate.sh',
  ownerUid: Number(process.env.OWNER_UID ?? 1000),
  tenantBackupDays: Number(process.env.DIAS_COPIAS_EMPRESA ?? 7),
});

function nextDaily(from = new Date()): Date {
  const d = new Date(from);
  d.setHours(Number(hora[1]), Number(hora[2]), 0, 0);
  if (d <= from) d.setDate(d.getDate() + 1);
  return d;
}

let next = nextDaily();
console.log(`backup: cópia diária às ${hora[1]}:${hora[2]} (${process.env.TZ ?? 'UTC'}); próxima em ${next.toString()}`);
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });

for (;;) {
  if (stopping) break;
  try {
    if (new Date() >= next) {
      next = nextDaily(new Date(Date.now() + 60_000));
      await agent.backupNow('diaria').catch((e: Error) => console.error(`backup: cópia diária FALHOU: ${e.message}`));
    }
    await agent.tick(next);
  } catch (e) {
    console.error(`backup: ${(e as Error).message}`);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
