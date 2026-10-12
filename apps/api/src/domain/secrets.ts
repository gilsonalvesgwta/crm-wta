// Tokens aleatórios, hashes de token e cifragem de segredos em repouso.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Token opaco para cookie, convite ou link de nova senha: 32 bytes. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** O banco guarda só o SHA-256 do token. */
export function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Códigos de recuperação legíveis: 10 caracteres em dois blocos (xxxxx-xxxxx). */
export function newRecoveryCodes(count = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(10);
    let s = '';
    for (const b of bytes) s += alphabet[b % alphabet.length];
    codes.push(`${s.slice(0, 5)}-${s.slice(5)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  const c = code.toLowerCase().replace(/[^a-z0-9]/g, '');
  return c.length === 10 ? `${c.slice(0, 5)}-${c.slice(5)}` : c;
}

/**
 * Cifra AES-256-GCM. Formato: versão (1 byte) | nonce (12) | tag (16) | dados.
 * A versão identifica a chave, para permitir rotação.
 */
export class SecretBox {
  private readonly keys: Map<number, Buffer>;
  private readonly current: number;

  constructor(keys: Record<number, Buffer>, current: number) {
    this.keys = new Map(Object.entries(keys).map(([k, v]) => [Number(k), v]));
    for (const [id, key] of this.keys) {
      if (key.length !== 32) throw new Error(`chave ${id} precisa de 32 bytes`);
      if (id < 1 || id > 255) throw new Error('identificador de chave fora de 1..255');
    }
    if (!this.keys.has(current)) throw new Error('chave atual ausente');
    this.current = current;
  }

  seal(plain: Buffer, aad = ''): Buffer {
    const key = this.keys.get(this.current)!;
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([Buffer.from([this.current]), nonce, cipher.getAuthTag(), data]);
  }

  open(sealed: Buffer, aad = ''): Buffer {
    if (sealed.length < 1 + 12 + 16) throw new Error('segredo cifrado inválido');
    const key = this.keys.get(sealed[0]!);
    if (!key) throw new Error('chave do segredo não encontrada');
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(1, 13));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(sealed.subarray(13, 29));
    return Buffer.concat([decipher.update(sealed.subarray(29)), decipher.final()]);
  }
}
