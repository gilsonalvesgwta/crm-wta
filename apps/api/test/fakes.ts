// Servidores falsos para os testes: Evolution API v2 e SMTP. Seguem as
// respostas documentadas; não substituem o teste com o servidor real.
import { createServer as httpServer, type Server } from 'node:http';
import { createServer as netServer, type Server as NetServer } from 'node:net';
import type { AddressInfo } from 'node:net';

export type FakeInstance = { name: string; webhook: string; state: string; owner: string | null; deleted?: boolean };
export type FakeSend = { instance: string; type: 'text' | 'media'; body: Record<string, unknown> };

export class FakeEvolution {
  readonly instances = new Map<string, FakeInstance>();
  readonly sent: FakeSend[] = [];
  failNext: { status: number; body: unknown } | null = null;
  private server!: Server;
  private n = 0;
  url = '';
  /** Mídias que a Evolution devolve em getBase64FromMediaMessage, pelo id da mensagem. */
  readonly media = new Map<string, { base64: string; mimetype: string }>();
  readonly key: string;

  constructor(key: string) {
    this.key = key;
  }

  async start(port = 0): Promise<void> {
    this.server = httpServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const send = (status: number, body: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        // Controle dos testes de ponta a ponta: ver e mudar o estado das instâncias.
        if (req.url === '/__fake/state' && req.method === 'GET') return send(200, { instances: [...this.instances.values()], sent: this.sent });
        if (req.url === '/__fake/state' && req.method === 'POST') {
          const b = JSON.parse(raw || '{}') as { instance: string; state?: string; owner?: string; media?: Record<string, { base64: string; mimetype: string }> };
          for (const [k, v] of Object.entries(b.media ?? {})) this.media.set(k, v);
          if (b.media) return send(200, {});
          const i = this.instances.get(b.instance);
          if (!i) return send(404, {});
          if (b.state) i.state = b.state;
          if (b.owner) i.owner = b.owner;
          return send(200, i);
        }
        if (req.headers.apikey !== this.key) return send(401, { status: 401, error: 'Unauthorized', response: { message: 'Unauthorized' } });
        if (this.failNext) {
          const f = this.failNext;
          this.failNext = null;
          return send(f.status, f.body);
        }
        const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
        const u = new URL(req.url ?? '/', 'http://x');
        const parts = u.pathname.split('/').filter(Boolean);
        const name = parts[2] ?? '';
        const inst = this.instances.get(name);
        const key = `${req.method} /${parts[0]}/${parts[1]}`;
        switch (key) {
          case 'POST /instance/create': {
            const n = String(body.instanceName);
            if (this.instances.has(n)) return send(403, { status: 403, error: 'Forbidden', response: { message: [`This name "${n}" is already in use.`] } });
            const wh = body.webhook as { url: string };
            this.instances.set(n, { name: n, webhook: wh.url, state: 'connecting', owner: null });
            return send(201, { instance: { instanceName: n, status: 'created' }, hash: 'token-da-instancia', qrcode: { base64: 'data:image/png;base64,UVIx', pairingCode: 'ABCD1234' } });
          }
          case 'GET /instance/fetchInstances': {
            const i = this.instances.get(u.searchParams.get('instanceName') ?? '');
            return send(200, i ? [{ name: i.name, ownerJid: i.owner, connectionStatus: i.state }] : []);
          }
        }
        if (!inst || inst.deleted) return send(404, { status: 404, error: 'Not Found', response: { message: [`The "${name}" instance does not exist`] } });
        switch (key) {
          case 'GET /instance/connect': return send(200, { base64: 'data:image/png;base64,UVIy', pairingCode: 'WXYZ9876', count: 1 });
          case 'GET /instance/connectionState': return send(200, { instance: { instanceName: name, state: inst.state } });
          case 'DELETE /instance/logout': inst.state = 'close'; return send(200, { status: 'SUCCESS', error: false, response: { message: 'Instance logged out' } });
          case 'DELETE /instance/delete': inst.deleted = true; return send(200, { status: 'SUCCESS', error: false, response: { message: 'Instance deleted' } });
          case 'POST /chat/getBase64FromMediaMessage': {
            const m = this.media.get(String((body.message as { key?: { id?: string } } | undefined)?.key?.id));
            return m ? send(201, { mediaType: 'audioMessage', fileName: null, mimetype: m.mimetype, base64: m.base64 })
              : send(400, { status: 400, error: 'Bad Request', response: { message: ['Message not found'] } });
          }
          case 'POST /webhook/set': inst.webhook = (body.webhook as { url: string }).url; return send(201, { webhook: body.webhook });
          case 'POST /message/sendText':
          case 'POST /message/sendMedia': {
            this.sent.push({ instance: name, type: key.endsWith('sendText') ? 'text' : 'media', body });
            const id = `3EB0FAKE${++this.n}`;
            return send(201, { key: { remoteJid: `${String(body.number)}@s.whatsapp.net`, fromMe: true, id }, status: 'PENDING', messageTimestamp: Math.floor(Date.now() / 1000) });
          }
        }
        return send(404, { status: 404, error: 'Not Found', response: { message: ['rota desconhecida'] } });
      });
    });
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

export type FakeMail = { from: string; to: string[]; data: string; user: string };

/** SMTP mínimo, com AUTH PLAIN e LOGIN, sem TLS. */
export class FakeSmtp {
  readonly mails: FakeMail[] = [];
  private server!: NetServer;
  port = 0;
  readonly user: string;
  readonly pass: string;

  constructor(user: string, pass: string) {
    this.user = user;
    this.pass = pass;
  }

  async start(port = 0): Promise<void> {
    this.server = netServer((sock) => {
      let buf = '';
      let inData = false;
      let authLogin: 'user' | 'pass' | null = null;
      let loginUser = '';
      let authed = '';
      let cur: FakeMail = { from: '', to: [], data: '', user: '' };
      const w = (s: string) => sock.write(`${s}\r\n`);
      w('220 fake.smtp ESMTP');
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        for (;;) {
          if (inData) {
            const end = buf.indexOf('\r\n.\r\n');
            if (end < 0) return;
            cur.data = buf.slice(0, end);
            buf = buf.slice(end + 5);
            inData = false;
            this.mails.push({ ...cur, user: authed });
            cur = { from: '', to: [], data: '', user: '' };
            w('250 2.0.0 OK queued');
            continue;
          }
          const nl = buf.indexOf('\r\n');
          if (nl < 0) return;
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          if (authLogin === 'user') { loginUser = Buffer.from(line, 'base64').toString(); authLogin = 'pass'; w('334 UGFzc3dvcmQ6'); continue; }
          if (authLogin === 'pass') {
            authLogin = null;
            const p = Buffer.from(line, 'base64').toString();
            if (loginUser === this.user && p === this.pass) { authed = loginUser; w('235 2.7.0 Authentication successful'); } else w('535 5.7.8 Authentication failed');
            continue;
          }
          const cmd = line.split(' ')[0]!.toUpperCase();
          if (cmd === 'EHLO' || cmd === 'HELO') { sock.write('250-fake.smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n'); }
          else if (cmd === 'AUTH') {
            const [, mech, arg] = line.split(' ');
            if (mech?.toUpperCase() === 'PLAIN') {
              const decode = (s: string) => Buffer.from(s, 'base64').toString().split('\u0000');
              const done = (s: string) => {
                const [, u, p] = decode(s);
                if (u === this.user && p === this.pass) { authed = u!; w('235 2.7.0 Authentication successful'); } else w('535 5.7.8 Authentication failed');
              };
              if (arg) done(arg); else { w('334 '); authLogin = null; }
            } else if (mech?.toUpperCase() === 'LOGIN') { authLogin = 'user'; w('334 VXNlcm5hbWU6'); }
            else w('504 mechanism');
          } else if (cmd === 'MAIL') { if (!authed) { w('530 5.7.0 Authentication required'); continue; } cur.from = line; w('250 OK'); }
          else if (cmd === 'RCPT') { cur.to.push(line.replace(/^RCPT TO:\s*/i, '').replace(/[<>]/g, '')); w('250 OK'); }
          else if (cmd === 'DATA') { inData = true; w('354 End data with <CR><LF>.<CR><LF>'); }
          else if (cmd === 'RSET' || cmd === 'NOOP') w('250 OK');
          else if (cmd === 'QUIT') { w('221 Bye'); sock.end(); }
          else w('502 Command not implemented');
        }
      });
      sock.on('error', () => undefined);
    });
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', r));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

export type FakeMetaSend = { path: string; body: Record<string, unknown> };
export type FakeTemplate = { id: string; name: string; language: string; category: string; status: string; components: unknown[]; rejected_reason?: string };

/**
 * Graph API falsa (WhatsApp Cloud API e Instagram), com as respostas
 * documentadas pela Meta. Não substitui o teste com a Meta de verdade.
 */
export class FakeMeta {
  readonly sent: FakeMetaSend[] = [];
  readonly templates: FakeTemplate[] = [];
  readonly tokens = new Set<string>();
  readonly media = new Map<string, { data: Buffer; type: string }>();
  readonly calls: FakeMetaSend[] = [];
  readonly refreshed: string[] = [];
  failNext: { status: number; body: unknown } | null = null;
  private server!: Server;
  private n = 0;
  url = '';

  constructor(tokens: string[]) {
    for (const t of tokens) this.tokens.add(t);
  }

  async start(port = 0): Promise<void> {
    this.server = httpServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        const send = (status: number, body: unknown, type = 'application/json') => {
          res.writeHead(status, { 'content-type': type });
          res.end(type === 'application/json' ? JSON.stringify(body) : body as Buffer);
        };
        const u = new URL(req.url ?? '/', 'http://x');
        if (u.pathname === '/__fake/state') return send(200, { sent: this.sent, templates: this.templates });
        if (u.pathname === '/__fake/approve' && req.method === 'POST') {
          for (const t of this.templates) if (t.status === 'PENDING') t.status = 'APPROVED';
          return send(200, { ok: true });
        }
        const file = /^\/media-file\/(.+)$/.exec(u.pathname);
        if (file) {
          const m = this.media.get(file[1]!);
          return m ? send(200, m.data, m.type) : send(404, { error: { message: 'not found' } });
        }
        if (u.pathname === '/refresh_access_token') {
          const t = u.searchParams.get('access_token') ?? '';
          if (!this.tokens.has(t)) return send(400, { error: { message: 'Error validating access token', code: 190 } });
          const next = `${t}-renovado`;
          this.tokens.add(next);
          this.refreshed.push(t);
          return send(200, { access_token: next, token_type: 'bearer', expires_in: 5183944 });
        }
        const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (!this.tokens.has(token)) return send(401, { error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 } });
        if (this.failNext) { const f = this.failNext; this.failNext = null; return send(f.status, f.body); }
        const path = u.pathname.replace(/^\/v\d+\.\d+\//, '');
        const json = (): Record<string, unknown> => { try { return JSON.parse(raw.toString('utf8') || '{}') as Record<string, unknown>; } catch { return {}; } };
        const [id, edge] = path.split('/');
        if (req.method === 'GET' && !edge && id!.startsWith('1000')) {
          return send(200, { id, display_phone_number: '+55 11 3333-4444', verified_name: 'Empresa Teste', quality_rating: 'GREEN' });
        }
        if (req.method === 'GET' && !edge && id!.startsWith('1784')) return send(200, { id, username: 'empresa.teste', name: 'Empresa Teste' });
        if (req.method === 'GET' && !edge && id!.startsWith('9')) return send(200, { name: 'Cliente Insta', username: 'cliente.insta' });
        if (req.method === 'GET' && !edge && id!.startsWith('media-')) {
          const m = this.media.get(id!);
          return m ? send(200, { url: `${this.url}/media-file/${id}`, mime_type: m.type, id }) : send(404, { error: { message: 'Unsupported get request', code: 100 } });
        }
        if (req.method === 'POST' && edge === 'messages') {
          const body = json();
          this.sent.push({ path, body });
          if (id!.startsWith('1784')) return send(200, { recipient_id: (body.recipient as { id: string }).id, message_id: `mid.${++this.n}` });
          return send(200, { messaging_product: 'whatsapp', contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: `wamid.${++this.n}` }] });
        }
        if (req.method === 'POST' && (edge === 'subscribed_apps' || edge === 'register')) {
          this.calls.push({ path, body: json() });
          if (edge === 'register' && (json().pin as string) !== '123456') {
            return send(400, { error: { message: 'Two step verification PIN Mismatch', code: 133005, error_user_msg: 'PIN incorreto.' } });
          }
          return send(200, { success: true });
        }
        if (req.method === 'POST' && edge === 'media') {
          const mid = `media-up-${++this.n}`;
          this.media.set(mid, { data: raw, type: 'application/octet-stream' });
          return send(200, { id: mid });
        }
        if (edge === 'message_templates') {
          if (req.method === 'GET') return send(200, { data: this.templates });
          if (req.method === 'POST') {
            const b = json();
            if (this.templates.some((t) => t.name === b.name && t.language === b.language)) {
              return send(400, { error: { message: 'Invalid parameter', code: 100, error_user_msg: 'Já existe um conteúdo neste idioma.' } });
            }
            const t = { id: String(9000000 + ++this.n), name: String(b.name), language: String(b.language), category: String(b.category), status: 'PENDING', components: b.components as unknown[] };
            this.templates.push(t);
            return send(200, { id: t.id, status: t.status, category: t.category });
          }
          if (req.method === 'DELETE') {
            const name = u.searchParams.get('name');
            const i = this.templates.findIndex((t) => t.name === name);
            if (i < 0) return send(404, { error: { message: 'not found', code: 100 } });
            this.templates.splice(i, 1);
            return send(200, { success: true });
          }
        }
        send(404, { error: { message: `rota falsa desconhecida: ${req.method} ${path}` } });
      });
    });
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
