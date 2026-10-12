import type { Mail } from './mailer.js';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(product: string, title: string, paragraphs: string[], action: { label: string; url: string }): string {
  const ps = paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#051628">${esc(p)}</p>`).join('');
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F3F5F8;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #DCE2EA;border-radius:10px">
<tr><td style="padding:28px 32px 8px;font-size:13px;color:#55657A">${esc(product)}</td></tr>
<tr><td style="padding:0 32px 8px"><h1 style="margin:0 0 16px;font-size:22px;color:#051628">${esc(title)}</h1>${ps}
<p style="margin:24px 0"><a href="${esc(action.url)}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#FF6600;color:#051628;font-weight:bold;text-decoration:none">${esc(action.label)}</a></p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#55657A">Se o botão não funcionar, copie este endereço no navegador:<br>${esc(action.url)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

export function passwordResetEmail(product: string, to: string, url: string): Mail {
  const paragraphs = [
    'Recebemos um pedido para criar uma nova senha para a sua conta.',
    'O link vale por 1 hora e pode ser usado uma vez. Se você não fez o pedido, ignore este e-mail: a sua senha continua a mesma.',
  ];
  return {
    to,
    subject: `${product}: crie uma nova senha`,
    text: `${paragraphs.join('\n\n')}\n\nCriar nova senha: ${url}\n`,
    html: layout(product, 'Crie uma nova senha', paragraphs, { label: 'Criar nova senha', url }),
  };
}

export function invitationEmail(product: string, to: string, tenantName: string, inviter: string, url: string): Mail {
  const paragraphs = [
    `${inviter} convidou você para usar o ${product} na empresa ${tenantName}.`,
    'O convite vale por 7 dias.',
  ];
  return {
    to,
    subject: `${product}: convite de ${tenantName}`,
    text: `${paragraphs.join('\n\n')}\n\nAceitar o convite: ${url}\n`,
    html: layout(product, `Convite de ${tenantName}`, paragraphs, { label: 'Aceitar o convite', url }),
  };
}
