import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Erro na conversão do áudio gravado. */
export class AudioError extends Error {}

/**
 * Converte o áudio gravado no navegador (WebM/Opus, MP4/AAC ou Ogg) para o
 * formato de cada canal, com o ffmpeg da imagem:
 * - "ogg": Ogg/Opus mono (mensagem de voz do WhatsApp);
 * - "m4a": AAC em M4A (o Instagram não aceita Ogg nem WebM).
 */
export async function convertVoice(data: Buffer, target: 'ogg' | 'm4a', timeoutMs = 60_000): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'crm-voz-'));
  try {
    const input = path.join(dir, 'entrada');
    const output = path.join(dir, target === 'ogg' ? 'saida.ogg' : 'saida.m4a');
    await writeFile(input, data);
    const codec = target === 'ogg'
      ? ['-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-application', 'voip', '-f', 'ogg']
      : ['-c:a', 'aac', '-b:a', '64k', '-ar', '44100', '-movflags', '+faststart', '-f', 'ipod'];
    await new Promise<void>((resolve, reject) => {
      const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input, '-vn', '-ac', '1', ...codec, output], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      const t = setTimeout(() => { p.kill('SIGKILL'); reject(new AudioError('A conversão do áudio demorou demais.')); }, timeoutMs);
      p.stderr.on('data', (c: Buffer) => { if (err.length < 2000) err += c.toString(); });
      p.on('error', (e: NodeJS.ErrnoException) => { clearTimeout(t); reject(new AudioError(e.code === 'ENOENT' ? 'O conversor de áudio (ffmpeg) não está instalado no servidor.' : 'Não foi possível converter o áudio.')); });
      p.on('close', (code) => { clearTimeout(t); if (code === 0) resolve(); else reject(new AudioError(`Não foi possível converter o áudio${err ? `: ${err.trim().split('\n').at(-1)}` : '.'}`)); });
    });
    const out = await readFile(output);
    if (!out.length) throw new AudioError('O áudio gravado está vazio.');
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Áudio para ligação telefônica: MP3 mono (operadoras) ou WAV 8 kHz 16 bits
 * (centrais Asterisk). Corta em 3 minutos.
 */
export async function convertForPhone(data: Buffer, target: 'mp3' | 'wav', timeoutMs = 60_000): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'crm-ligacao-'));
  try {
    const input = path.join(dir, 'entrada');
    const output = path.join(dir, `saida.${target}`);
    await writeFile(input, data);
    const codec = target === 'mp3'
      ? ['-c:a', 'libmp3lame', '-b:a', '48k', '-ar', '22050', '-f', 'mp3']
      : ['-c:a', 'pcm_s16le', '-ar', '8000', '-f', 'wav'];
    await new Promise<void>((resolve, reject) => {
      const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input, '-vn', '-ac', '1', '-t', '180', ...codec, output], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      const t = setTimeout(() => { p.kill('SIGKILL'); reject(new AudioError('A conversão do áudio demorou demais.')); }, timeoutMs);
      p.stderr.on('data', (c: Buffer) => { if (err.length < 2000) err += c.toString(); });
      p.on('error', (e: NodeJS.ErrnoException) => { clearTimeout(t); reject(new AudioError(e.code === 'ENOENT' ? 'O conversor de áudio (ffmpeg) não está instalado no servidor.' : 'Não foi possível converter o áudio.')); });
      p.on('close', (code) => { clearTimeout(t); if (code === 0) resolve(); else reject(new AudioError(`Não foi possível converter o áudio${err ? `: ${err.trim().split('\n').at(-1)}` : '.'}`)); });
    });
    const out = await readFile(output);
    if (out.length < 200) throw new AudioError('O áudio está vazio.');
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
