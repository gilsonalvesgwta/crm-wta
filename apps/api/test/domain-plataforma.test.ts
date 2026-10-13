import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greennAction, parsePeriodEnd, readGreennEvent, secretMatches } from '../src/domain/greenn.js';
import { allows, within } from '../src/domain/plans.js';
import { PALETTES, buildTheme } from '../src/domain/theme.js';

const sale = {
  type: 'sale', currentStatus: 'paid', product: { id: 5001, type: 'TRANSACTION' }, sale: { id: 777 },
  client: { name: ' Ana ', email: ' Ana@Ex.COM ', cellphone: '+55 11 90000-0000' },
};

test('Greenn: lê venda e contrato, decide a ação e recusa corpo inválido', () => {
  const r = readGreennEvent(sale);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.event.customer?.email, 'ana@ex.com');
  assert.equal(r.event.productId, '5001');
  assert.equal(greennAction(r.event), 'grant');
  const sub = readGreennEvent({ ...sale, product: { id: 5001, type: 'SUBSCRIPTION' } });
  assert.ok(sub.ok && greennAction(sub.event) === 'none', 'venda de assinatura: quem decide é o contrato');
  for (const [status, action] of [['refunded', 'revoke'], ['chargedback', 'revoke'], ['waiting_payment', 'none']] as const) {
    const e = readGreennEvent({ ...sale, currentStatus: status });
    assert.ok(e.ok && greennAction(e.event) === action, status);
  }
  const c = (status: string) => readGreennEvent({ type: 'contract', currentStatus: status, product: { id: 1 }, contract: { id: 2 }, client: { email: 'a@b.co' } });
  for (const [status, action] of [['paid', 'grant'], ['trialing', 'grant'], ['canceled', 'until_period_end'], ['unpaid', 'until_period_end']] as const) {
    const e = c(status);
    assert.ok(e.ok && greennAction(e.event) === action, status);
  }
  assert.deepEqual(readGreennEvent([]), { ok: false, reason: 'corpo_invalido' });
  assert.deepEqual(readGreennEvent({ ...sale, client: { email: 'x' } }), { ok: false, reason: 'email_invalido' });
  assert.deepEqual(readGreennEvent({ ...sale, sale: {} }), { ok: false, reason: 'venda_ausente' });
});

test('Greenn: fim do período no horário de Brasília e segredo comparado por inteiro', () => {
  assert.equal(parsePeriodEnd('2026-11-08 12:00:00')?.toISOString(), '2026-11-08T15:00:00.000Z');
  assert.equal(parsePeriodEnd('2026-11-08')?.toISOString(), '2026-11-09T02:59:59.000Z');
  assert.equal(parsePeriodEnd('ontem'), null);
  assert.equal(secretMatches('abc-segredo', 'abc-segredo'), true);
  assert.equal(secretMatches('abc-segred', 'abc-segredo'), false);
  assert.equal(secretMatches('', ''), false);
});

test('plano: sem plano não há limite; recurso ausente é negado; número nulo é ilimitado', () => {
  assert.equal(allows(null, 'custom_domain'), true);
  assert.equal(allows({}, 'custom_domain'), false);
  assert.equal(within({ max_users: 3 }, 'max_users', 3), true);
  assert.equal(within({ max_users: 3 }, 'max_users', 4), false);
  assert.equal(within({ max_users: null }, 'max_users', 999), true);
});

test('as paletas prontas passam nas regras de contraste', () => {
  for (const p of PALETTES) {
    const r = buildTheme({ primary: p.primary, sidebar: p.sidebar, mode: p.mode });
    assert.ok('theme' in r, `${p.name}: ${JSON.stringify(r)}`);
  }
});
