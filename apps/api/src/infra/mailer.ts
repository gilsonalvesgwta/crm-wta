import { Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { CONFIG, type Config } from '../config.js';

export type Mail = { to: string; subject: string; text: string; html: string };

export const MAILER = Symbol('MAILER');

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Envio real por SMTP (e-mails do sistema: convites, nova senha). */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  constructor(private readonly cfg: Config) {
    this.transport = nodemailer.createTransport({
      host: cfg.SMTP_HOST,
      port: cfg.SMTP_PORT,
      secure: cfg.SMTP_PORT === 465,
      auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS ?? '' } : undefined,
    });
  }
  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.cfg.SMTP_FROM, ...mail });
  }
}

/** Para testes: guarda as mensagens em memória. */
export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
  }
}

/** Para desenvolvimento: registra o destinatário e o assunto, nunca o corpo. */
export class LogMailer implements Mailer {
  private readonly log = new Logger('mail');
  async send(mail: Mail): Promise<void> {
    this.log.warn(`e-mail não enviado (MAIL_MODE=log): "${mail.subject}" para ${mail.to}`);
  }
}

export function createMailer(cfg: Config): Mailer {
  if (cfg.MAIL_MODE === 'smtp') return new SmtpMailer(cfg);
  if (cfg.MAIL_MODE === 'memory') return new MemoryMailer();
  return new LogMailer();
}

export const mailerProvider = {
  provide: MAILER,
  inject: [CONFIG],
  useFactory: (cfg: Config) => createMailer(cfg),
};
