// Cópias de segurança: formato dos arquivos e da fila de trabalhos, comum à
// API (que pede) e ao agente do serviço "backup" (que executa). A API nunca
// tem a senha de superusuário do banco: ela só escreve pedidos na pasta das
// cópias, e o agente, que tem, executa.
import path from 'node:path';

export type BackupKind = 'diaria' | 'manual' | 'antes-de-restaurar' | 'enviada' | 'antiga' | 'empresa';

export type Manifest = {
  name: string;
  createdAt: string;
  kind: BackupKind;
  format: 'tar' | 'dump';
  includesFiles: boolean;
  sizeBytes: number;
  migrations: string[];
  tenants: { id: string; name: string; slug: string; status: string }[];
  /** Cópia de uma empresa só (feita pela própria empresa). */
  tenantId?: string;
  tables?: { t: string; cols: string[] }[];
};

export type JobType = 'backup' | 'restore_full' | 'restore_tenant' | 'inspect' | 'backup_tenant' | 'restore_tenant_backup';
export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export type Job = {
  id: string;
  type: JobType;
  file?: string;
  tenantId?: string;
  requestedBy: string;
  requestedAt: string;
  status: JobStatus;
  startedAt?: string;
  finishedAt?: string;
  log: string[];
  error?: string;
  result?: string;
};

export type AgentBeat = { at: string; version: string; nextDaily: string | null; busy: string | null };

/** Nomes aceitos: crm-AAAAMMDD-HHMMSS[-tipo].tar|.dump (nada de caminho). */
export const BACKUP_NAME = /^crm-\d{8}-\d{6}(-[a-z-]{3,30})?\.(tar|dump)$/;
export const JOB_ID = /^[0-9a-f-]{36}$/;

export const jobsDir = (dir: string) => path.join(dir, '.trabalhos');
export const uploadsDir = (dir: string) => path.join(dir, '.envios');
export const beatFile = (dir: string) => path.join(jobsDir(dir), 'agente.json');
export const manifestFile = (dir: string, name: string) => path.join(dir, `${name}.json`);

export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
