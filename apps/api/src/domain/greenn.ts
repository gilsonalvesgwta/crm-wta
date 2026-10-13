// Leitura dos avisos (webhooks) da Greenn. Mesma regra usada na plataforma
// Português com João Paulo, que está em produção:
// - venda avulsa paga: libera (soma a duração da oferta);
// - venda reembolsada ou contestada: encerra na hora;
// - contrato (assinatura) pago ou em teste: libera até o fim do período do contrato;
// - contrato não pago ou cancelado: vale até o fim do período já pago;
// - o resto (aguardando pagamento, recusado, carrinho abandonado) só fica registrado.
// Os campos seguem a documentação pública da Greenn; a confirmação com um aviso
// real fica registrada em docs/INTEGRATIONS.md.

import { createHash, timingSafeEqual } from 'node:crypto';

export type GreennEventType = 'sale' | 'contract' | 'lead';

export type GreennEvent = {
  type: GreennEventType;
  status: string | null;
  productId: string | null;
  productName: string | null;
  subscription: boolean;
  saleId: string | null;
  contractId: string | null;
  periodEnd: string | null;
  customer: { email: string; name: string; phone: string | null } | null;
};

export type GreennRead = { ok: true; event: GreennEvent } | { ok: false; reason: string };

/** liberar | encerrar (na hora) | ate_fim (vale até o fim do período) | nenhuma */
export type GreennAction = 'grant' | 'revoke' | 'until_period_end' | 'none';

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function id(v: unknown): string | null {
  const s = str(v);
  return s && /^[0-9A-Za-z_-]{1,40}$/.test(s) ? s : null;
}

export function readGreennEvent(body: unknown): GreennRead {
  const root = obj(body);
  if (!root) return { ok: false, reason: 'corpo_invalido' };
  const type = str(root.type);
  if (type !== 'sale' && type !== 'contract' && type !== 'lead') return { ok: false, reason: 'tipo_desconhecido' };
  const product = obj(root.product);
  const sale = obj(root.sale) ?? obj(root.currentSale);
  const contract = obj(root.contract);
  const person = obj(root.client) ?? obj(root.lead);

  let customer: GreennEvent['customer'] = null;
  const rawEmail = person ? str(person.email) : null;
  if (rawEmail) {
    const email = rawEmail.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: 'email_invalido' };
    customer = { email, name: (person && str(person.name)) ?? '', phone: person ? str(person.cellphone) : null };
  }
  const event: GreennEvent = {
    type,
    status: str(root.currentStatus),
    productId: product ? id(product.id) : null,
    productName: product ? str(product.name) : null,
    subscription: (product ? str(product.type) ?? '' : '').toUpperCase() === 'SUBSCRIPTION',
    saleId: sale ? id(sale.id) : null,
    contractId: contract ? id(contract.id) : null,
    periodEnd: contract ? str(contract.current_period_end) : null,
    customer,
  };
  if (type !== 'lead') {
    if (!event.productId) return { ok: false, reason: 'produto_ausente' };
    if (!event.customer) return { ok: false, reason: 'cliente_ausente' };
    if (type === 'sale' && !event.saleId) return { ok: false, reason: 'venda_ausente' };
    if (type === 'contract' && !event.contractId) return { ok: false, reason: 'contrato_ausente' };
  }
  return { ok: true, event };
}

export function greennAction(e: GreennEvent): GreennAction {
  if (e.type === 'sale') {
    if (e.status === 'paid' && !e.subscription) return 'grant';
    if (e.status === 'refunded' || e.status === 'chargedback') return 'revoke';
    return 'none';
  }
  if (e.type === 'contract') {
    if (e.status === 'paid' || e.status === 'trialing') return 'grant';
    if (e.status === 'unpaid' || e.status === 'canceled') return 'until_period_end';
    return 'none';
  }
  return 'none';
}

/** Data do fim do período ("2026-11-08 12:00:00", horário de Brasília) como instante. */
export function parsePeriodEnd(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '23'}:${m[5] ?? '59'}:${m[6] ?? '59'}-03:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Impressão digital do aviso: o mesmo aviso reenviado não é aplicado de novo. */
export function fingerprint(e: GreennEvent): string {
  return createHash('sha256')
    .update([e.type, e.status, e.productId, e.saleId, e.contractId, e.periodEnd, e.customer?.email].join('|'))
    .digest('hex');
}

/** Compara o segredo do endereço sem revelar, pelo tempo de resposta, quanto acertou. */
export function secretMatches(received: string, expected: string): boolean {
  if (!expected) return false;
  const a = createHash('sha256').update(received).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
