import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { base32Decode, totpAt } from '../src/domain/totp.js';
import { TranscriptionService } from '../src/crm/transcription.service.js';
import { cleanTranscript } from '../src/infra/transcribe.js';
import { Browser, createDatabase, createUser, dropDatabase, startApi, type Fixture } from './helpers.js';

const GOOD_KEY = 'sk-teste-chave-valida-0000000000000000wxyz';

/** OpenAI de mentira: confere a chave e devolve um texto fixo. */
class FakeOpenAi {
  server: Server | null = null;
  url = '';
  calls: { path: string; body: string }[] = [];
  failNext = 0;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('latin1');
        this.calls.push({ path: req.url ?? '', body });
        if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) {
          res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
          return;
        }
        if (req.method === 'GET' && req.url === '/v1/models') {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [] }));
          return;
        }
        if (req.method === 'POST' && req.url === '/v1/audio/transcriptions') {
          if (this.failNext > 0) {
            this.failNext--;
            res.writeHead(429, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'quota' } }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: 'Cliente quer carta de 300 mil, retorno na sexta.' }));
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}

let f: Fixture;
let app: NestFastifyApplication;
let openai: FakeOpenAi;
let admin: Browser;
let sales: Browser;
let adminB: Browser;
let deal: string;
let audio: Buffer;
let ip = 0;

async function login(email: string, mfa: boolean): Promise<Browser> {
  const b = new Browser(app, `10.70.0.${++ip}`);
  assert.equal((await b.login(email)).status, 200);
  if (mfa) {
    const s = await b.post('/api/v1/auth/mfa/setup');
    assert.equal((await b.post('/api/v1/auth/mfa/enable', { code: totpAt(base32Decode(s.body.secret), Date.now()) })).status, 200);
  }
  return b;
}

const idle = () => app.get(TranscriptionService).idle();
const notesOf = async (b: Browser) => (await b.get(`/api/v1/records/deal/${deal}/notes`)).body as {
  id: string; transcript: string | null; transcriptStatus: string | null; transcriptBy: string | null; audio: unknown;
}[];

before(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-whisper-'));
  // Transcritor de mentira: confere que recebeu um WAV e escreve como o whisper.cpp.
  const bin = path.join(dir, 'whisper-cli');
  writeFileSync(bin, [
    '#!/bin/sh',
    'for a in "$@"; do last="$a"; done',
    'head -c 4 "$last" | grep -q RIFF || { echo "não é wav" >&2; exit 3; }',
    'echo " [Música]"',
    'echo " Olá, isto é um teste de transcrição ."',
    'echo " Segunda linha (risos) do áudio."',
  ].join('\n'));
  chmodSync(bin, 0o755);
  const model = path.join(dir, 'modelo.bin');
  writeFileSync(model, 'modelo');
  // Um segundo de áudio Opus de verdade, como o gravador do navegador.
  const ogg = path.join(dir, 'nota.ogg');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', ogg]);
  audio = readFileSync(ogg);

  f = await createDatabase();
  openai = new FakeOpenAi();
  await openai.start();
  ({ app } = await startApi(f, { WHISPER_BIN: bin, WHISPER_MODEL: model, OPENAI_BASE_URL: openai.url }));
  await createUser(f, 'admin@a.test', [{ tenant: f.tenantA, role: 'admin' }]);
  await createUser(f, 'vendas@a.test', [{ tenant: f.tenantA, role: 'sales' }]);
  await createUser(f, 'admin@b.test', [{ tenant: f.tenantB, role: 'admin' }]);
  admin = await login('admin@a.test', true);
  sales = await login('vendas@a.test', false);
  adminB = await login('admin@b.test', true);
  const pl = (await admin.get('/api/v1/pipelines')).body[0];
  deal = (await admin.post('/api/v1/deals', { pipelineId: pl.id, title: 'Consórcio imóvel' })).body.id;
});

after(async () => {
  await app?.close();
  await openai?.stop();
  if (f) await dropDatabase(f);
});

describe('Transcrição das notas de áudio', () => {
  test('texto do whisper fica limpo, sem marcas como [Música] ou (risos)', () => {
    assert.equal(cleanTranscript(' [Música]\n Olá, isto é um teste .\n Segunda (risos) linha.\n'), 'Olá, isto é um teste. Segunda linha.');
  });

  test('no próprio servidor: a nota nasce "transcrevendo" e ganha o texto', async () => {
    const s = await admin.get('/api/v1/integrations/transcription');
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.deepEqual(s.body, { provider: 'local', localAvailable: true, openai: { configured: false, hint: null, model: 'gpt-4o-mini-transcribe' } });
    const up = await admin.upload(`/api/v1/records/deal/${deal}/notes/audio`, 'gravacao.ogg', audio, 'audio/ogg');
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.transcriptStatus, 'pending');
    await idle();
    const n = (await notesOf(admin)).find((x) => x.id === up.body.id)!;
    assert.equal(n.transcriptStatus, 'done');
    assert.equal(n.transcript, 'Olá, isto é um teste de transcrição. Segunda linha do áudio.');
    assert.equal(n.transcriptBy, 'local');
    // Quem vê o negócio vê a transcrição; outra empresa não acha a nota.
    assert.equal((await adminB.post(`/api/v1/notes/${up.body.id}/transcribe`, {})).status, 404);
  });

  test('chave da OpenAI: só o administrador configura, é conferida e fica cifrada', async () => {
    assert.equal((await sales.get('/api/v1/integrations/transcription')).status, 403);
    assert.equal((await sales.put('/api/v1/integrations/transcription', { provider: 'local' })).status, 403);
    assert.equal((await admin.put('/api/v1/integrations/transcription', { provider: 'openai' })).status, 422, 'precisa da chave');
    const bad = await admin.put('/api/v1/integrations/transcription', { provider: 'openai', openaiKey: 'sk-chave-errada-000000000000000000' });
    assert.equal(bad.status, 422);
    assert.match(bad.body.title, /recusada/);
    assert.equal((await admin.put('/api/v1/integrations/transcription', { provider: 'openai', openaiKey: 'não-é-chave' })).status, 422);
    const ok = await admin.put('/api/v1/integrations/transcription', { provider: 'openai', openaiKey: GOOD_KEY, model: 'gpt-4o-transcribe' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.openai, { configured: true, hint: 'wxyz', model: 'gpt-4o-transcribe' });
    assert.equal(ok.body.provider, 'openai');
    assert.ok(!JSON.stringify((await admin.get('/api/v1/integrations/transcription')).body).includes(GOOD_KEY), 'a chave não volta para a tela');
    const row = await f.admin.query('select openai_key from transcription_settings where tenant_id = $1', [f.tenantA]);
    assert.ok(!row.rows[0].openai_key.toString('latin1').includes('sk-teste'), 'o banco guarda a chave cifrada');
    assert.equal((await adminB.get('/api/v1/integrations/transcription')).body.provider, 'local', 'outra empresa não é afetada');
  });

  test('pela OpenAI: transcrever de novo uma nota antiga usa a chave da empresa', async () => {
    const n0 = (await notesOf(admin)).find((x) => x.audio)!;
    const r = await admin.post(`/api/v1/notes/${n0.id}/transcribe`, {});
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(r.body.transcriptStatus, 'pending');
    await idle();
    const n = (await notesOf(admin)).find((x) => x.id === n0.id)!;
    assert.equal(n.transcript, 'Cliente quer carta de 300 mil, retorno na sexta.');
    assert.equal(n.transcriptBy, 'openai');
    const call = openai.calls.filter((c) => c.path === '/v1/audio/transcriptions').at(-1)!;
    assert.match(call.body, /name="model"\r\n\r\ngpt-4o-transcribe/);
    assert.match(call.body, /name="language"\r\n\r\npt/);
    assert.match(call.body, /filename="audio\.mp3"/);
  });

  test('falha na OpenAI marca "não foi possível" e dá para tentar de novo', async () => {
    openai.failNext = 1;
    const up = await admin.upload(`/api/v1/records/deal/${deal}/notes/audio`, 'outra.ogg', audio, 'audio/ogg');
    await idle();
    assert.equal((await notesOf(admin)).find((x) => x.id === up.body.id)!.transcriptStatus, 'failed');
    assert.equal((await admin.post(`/api/v1/notes/${up.body.id}/transcribe`, {})).status, 202);
    await idle();
    assert.equal((await notesOf(admin)).find((x) => x.id === up.body.id)!.transcriptStatus, 'done');
    // Nota só de texto não tem o que transcrever.
    const t = await admin.post(`/api/v1/records/deal/${deal}/notes`, { body: 'Só texto' });
    assert.equal((await admin.post(`/api/v1/notes/${t.body.id}/transcribe`, {})).status, 422);
  });

  test('remover a chave volta para o servidor', async () => {
    const r = await admin.put('/api/v1/integrations/transcription', { provider: 'local', openaiKey: null });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.openai, { configured: false, hint: null, model: 'gpt-4o-transcribe' });
    assert.equal(r.body.provider, 'local');
  });
});
