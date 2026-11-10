// Dados de contato achados no texto de uma mensagem (e-mail e telefone) e nome
// do perfil. Usado para completar o contato que veio do Instagram.

const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}/g;
// Sequências que parecem telefone: dígitos com espaços, pontos, traços e parênteses.
const PHONE = /(?:\+?\d[\d\s().-]{8,20}\d)/g;

/** E-mails e telefones (formato +DDI...) escritos na mensagem. */
export function extractContactInfo(text: string | null | undefined): { emails: string[]; phones: string[] } {
  const s = (text ?? '').slice(0, 4000);
  const emails = [...new Set((s.match(EMAIL) ?? []).map((e) => e.toLowerCase().replace(/\.+$/, '')))].slice(0, 3);
  const phones: string[] = [];
  for (const raw of s.match(PHONE) ?? []) {
    // CPF (000.000.000-00) e CNPJ não são telefone.
    if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(raw.trim()) || /^\d{2}\.\d{3}\.\d{3}\/?\d{4}-?\d{2}$/.test(raw.trim())) continue;
    const plus = raw.trim().startsWith('+');
    let d = raw.replace(/\D/g, '');
    if (plus && !d.startsWith('55')) {
      if (d.length >= 8 && d.length <= 15) phones.push(`+${d}`);
      continue;
    }
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
    else if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);
    const ddd = Number(d.slice(0, 2));
    if (ddd < 11 || ddd > 99 || d[1] === '0') continue;
    // Celular: 11 dígitos com 9 depois do DDD; fixo: 10 dígitos começando com 2 a 5.
    const ok = (d.length === 11 && d[2] === '9') || (d.length === 10 && /[2-5]/.test(d[2]!));
    if (ok) phones.push(`+55${d}`);
  }
  return { emails, phones: [...new Set(phones)].slice(0, 3) };
}

/** Nome do contato ainda é o provisório ("@usuario" ou "Instagram 123456")? */
export function isPlaceholderName(first: string | null | undefined, last?: string | null): boolean {
  const f = (first ?? '').trim();
  return !f || ((/^@[A-Za-z0-9._]+$/.test(f) || /^Instagram \d{1,6}$/.test(f)) && !(last ?? '').trim());
}

/** Divide o nome do perfil em nome e sobrenome. */
export function splitName(full: string): { first: string; last: string | null } {
  const parts = full.replace(/\s+/g, ' ').trim().slice(0, 200).split(' ');
  const first = parts.shift()!.slice(0, 100);
  const last = parts.join(' ').slice(0, 100) || null;
  return { first, last };
}
