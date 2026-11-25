import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';

/** Erro na transcrição do áudio. */
export class TranscribeError extends Error {}

export type WhisperOptions = { bin: string; model: string; lang: string; threads: number; timeoutMs?: number };

/** O transcritor (whisper.cpp) e o modelo estão na imagem? */
export async function whisperAvailable(o: WhisperOptions): Promise<boolean> {
  try {
    await access(o.bin, constants.X_OK);
    await access(o.model, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Quantas linhas de execução usar: metade dos núcleos (entre 1 e 4), para não travar o resto do CRM. */
export function defaultThreads(): number {
  return Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
}

function run(cmd: string, args: string[], timeoutMs: number, what: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new TranscribeError(`${what} demorou demais.`)); }, timeoutMs);
    p.stdout.on('data', (c: Buffer) => { if (out.length < 200_000) out += c.toString(); });
    p.stderr.on('data', (c: Buffer) => { if (err.length < 4000) err += c.toString(); });
    p.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(t);
      reject(new TranscribeError(e.code === 'ENOENT' ? `${what}: programa não instalado no servidor.` : `${what} falhou.`));
    });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new TranscribeError(`${what} falhou${err ? `: ${err.trim().split('\n').at(-1)}` : '.'}`));
    });
  });
}

/** Junta as linhas que o Whisper devolve num texto corrido, sem marcas como [Música] ou (risos). */
export function cleanTranscript(raw: string): string {
  return raw
    .split('\n')
    .map((l) => l.replace(/\[[^\]]*\]|\([^)\d]*\)/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim()
    .slice(0, 20000);
}

/**
 * Transcreve o áudio no próprio servidor, sem serviço pago: o ffmpeg converte
 * para WAV 16 kHz mono e o whisper.cpp (modelo Whisper "small") escreve o texto.
 */
export async function transcribeAudio(data: Buffer, o: WhisperOptions): Promise<string> {
  const timeoutMs = o.timeoutMs ?? 15 * 60_000;
  const dir = await mkdtemp(path.join(tmpdir(), 'crm-transcricao-'));
  try {
    const input = path.join(dir, 'entrada');
    const wav = path.join(dir, 'audio.wav');
    await writeFile(input, data);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav],
      120_000, 'A conversão do áudio');
    const out = await run(o.bin, ['-m', o.model, '-l', o.lang, '-t', String(o.threads), '-nt', '-np', '-f', wav], timeoutMs, 'A transcrição');
    return cleanTranscript(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type OpenAiOptions = { baseUrl: string; key: string; model: string; lang: string; timeoutMs?: number };

/** Mensagem curta e sem segredos para um erro da OpenAI. */
function openAiError(status: number, body: string): string {
  if (status === 401) return 'A chave da OpenAI foi recusada (confira se está ativa).';
  if (status === 429) return 'A OpenAI recusou por limite ou falta de crédito na conta.';
  let msg = '';
  try { msg = String((JSON.parse(body) as { error?: { message?: string } }).error?.message ?? ''); } catch { /* corpo não é JSON */ }
  return `A OpenAI respondeu ${status}${msg ? `: ${msg.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-…').slice(0, 200)}` : '.'}`;
}

/** Confere a chave da OpenAI sem gastar nada (lista os modelos). */
export async function checkOpenAiKey(baseUrl: string, key: string): Promise<void> {
  let r: Response;
  try {
    r = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new TranscribeError('Não foi possível falar com a OpenAI agora.');
  }
  if (!r.ok) throw new TranscribeError(openAiError(r.status, await r.text().catch(() => '')));
}

/**
 * Transcreve pela OpenAI, com a chave da empresa: o ffmpeg converte para MP3
 * mono (arquivo pequeno, aceito pela API) e a resposta volta em texto.
 */
export async function transcribeOpenAi(data: Buffer, o: OpenAiOptions): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'crm-transcricao-'));
  try {
    const input = path.join(dir, 'entrada');
    const mp3 = path.join(dir, 'audio.mp3');
    await writeFile(input, data);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', mp3],
      120_000, 'A conversão do áudio');
    const form = new FormData();
    form.append('file', new Blob([await readFile(mp3)], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', o.model);
    if (o.lang !== 'auto') form.append('language', o.lang);
    form.append('response_format', 'json');
    let r: Response;
    try {
      r = await fetch(`${o.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
        method: 'POST', headers: { authorization: `Bearer ${o.key}` }, body: form, signal: AbortSignal.timeout(o.timeoutMs ?? 5 * 60_000),
      });
    } catch {
      throw new TranscribeError('Não foi possível falar com a OpenAI agora.');
    }
    const body = await r.text();
    if (!r.ok) throw new TranscribeError(openAiError(r.status, body));
    let text = '';
    try { text = String((JSON.parse(body) as { text?: string }).text ?? ''); } catch { text = body; }
    return text.replace(/\s+/g, ' ').trim().slice(0, 20000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
