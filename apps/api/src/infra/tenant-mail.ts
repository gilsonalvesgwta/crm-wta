import nodemailer from 'nodemailer';
import { resolvePublicHost, SMTP_PORTS } from '../domain/net-guard.js';

export type SmtpAccount = { host: string; port: number; secure: boolean; user: string; pass: string; fromName: string; address: string };
export type TenantMail = {
  to: string; subject: string; text: string; html: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
};

export class SmtpError extends Error {}

/** Mensagem curta e sem segredo a partir do erro do nodemailer. */
function explain(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string };
  if (e.code === 'EAUTH') return 'Usuário ou senha recusados pelo servidor de e-mail.';
  if (e.code === 'ETIMEDOUT' || e.code === 'ESOCKET' || e.code === 'ECONNECTION') {
    return 'Sem conexão com o servidor de e-mail. Confira o servidor e a porta (a 587 costuma passar onde a 465 é bloqueada).';
  }
  if (e.code === 'EENVELOPE') return `Destinatário ou remetente recusado: ${(e.response ?? e.message ?? '').slice(0, 200)}`;
  if (e.responseCode) return `O servidor de e-mail recusou (${e.responseCode}): ${(e.response ?? '').slice(0, 200)}`;
  return (e.message ?? 'Falha no envio.').slice(0, 300);
}

async function transportFor(acc: SmtpAccount, allowPrivate: boolean) {
  if (!allowPrivate && !SMTP_PORTS.has(acc.port)) throw new SmtpError('Use a porta 465, 587, 25 ou 2525.');
  let ip: string;
  try {
    ip = await resolvePublicHost(acc.host, allowPrivate);
  } catch (err) {
    throw new SmtpError((err as Error).message === 'endereço interno não permitido'
      ? 'Esse servidor fica em endereço interno e não pode ser usado.'
      : 'Servidor de e-mail não encontrado. Confira o endereço.');
  }
  return nodemailer.createTransport({
    host: ip,
    port: acc.port,
    secure: acc.secure,
    auth: { user: acc.user, pass: acc.pass },
    // Certificado conferido contra o nome do servidor, não contra o IP.
    tls: { servername: acc.host },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

/** Envia pelo SMTP da empresa. Devolve o Message-ID. */
export async function sendTenantMail(acc: SmtpAccount, mail: TenantMail, allowPrivate: boolean): Promise<string> {
  const t = await transportFor(acc, allowPrivate);
  try {
    const info = await t.sendMail({ from: { name: acc.fromName, address: acc.address }, ...mail });
    return String(info.messageId ?? '').slice(0, 300);
  } catch (err) {
    throw new SmtpError(explain(err));
  } finally {
    t.close();
  }
}

/** Confere servidor, porta e senha sem enviar nada. */
export async function verifyTenantSmtp(acc: SmtpAccount, allowPrivate: boolean): Promise<void> {
  const t = await transportFor(acc, allowPrivate);
  try {
    await t.verify();
  } catch (err) {
    throw new SmtpError(explain(err));
  } finally {
    t.close();
  }
}

/** Texto simples em HTML seguro (quebras de linha e links preservados, nada interpretado). */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${esc.replace(/\r?\n/g, '<br>')}</div>`;
}
