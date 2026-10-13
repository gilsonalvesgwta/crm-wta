import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';

/**
 * Armazenamento de arquivos. Hoje em disco (volume da stack); o provedor S3
 * entra quando for escolhido (ADR 012), sem mudar quem usa esta classe.
 * A chave sempre começa pela empresa: <tenant_id>/<ano>/<mês>/<id>.
 */
@Injectable()
export class Storage {
  private readonly root: string;

  constructor(@Inject(CONFIG) cfg: Config) {
    this.root = path.resolve(cfg.STORAGE_DIR);
  }

  private file(key: string): string {
    if (!/^[0-9a-f-]{36}\/\d{4}\/\d{2}\/[0-9a-f-]{36}$/.test(key)) throw new Error(`chave de arquivo inválida: ${key}`);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('chave fora da pasta de arquivos');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.file(key);
    await mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.tmp-${process.pid}`;
    await writeFile(tmp, data, { mode: 0o640 });
    await rename(tmp, full);
  }

  async open(key: string): Promise<{ stream: Readable; size: number } | null> {
    const full = this.file(key);
    try {
      const s = await stat(full);
      return { stream: createReadStream(full), size: s.size };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }

  /** O armazenamento está gravável (verificação de prontidão). */
  async check(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const probe = path.join(this.root, `.probe-${process.pid}`);
    await writeFile(probe, 'ok');
    await rm(probe, { force: true });
  }
}
