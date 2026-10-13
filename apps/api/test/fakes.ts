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
          const b = JSON.parse(raw || '{}') as { instance: string; state?: string; owner?: string };
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
