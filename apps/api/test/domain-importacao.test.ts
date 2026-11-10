import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPhone, cleanPhones, isPlaceholderEmail, moneyToCents, parseSheetDate } from '../src/domain/import-normalize.js';

test('telefones do Pipedrive e do Excel viram +DDI', () => {
  const cases: [string, string | null][] = [
    ['41997810298', '+5541997810298'], ['55 91 8965-1413', '+5591989651413'], ['55 11 93364-3764', '+5511933643764'],
    ["'+55 83 9983-7655", '+5583999837655'], ['(47) 3333-4444', '+554733334444'], ['047 99999-0000', '+5547999990000'],
    ['1 (774) 606-6570', '+17746066570'], ['1 407 808-4660', '+14078084660'], ['351 960 480 788', '+351960480788'],
    ['44 7519 339111', '+447519339111'], ['81 80-4542-1082', '+818045421082'], ['41 77 258 28 79', '+41772582879'],
    ['33 7 62 54 55 48', '+33762545548'], ['61 481 192 458', '+61481192458'], ['598 95 864 491', '+59895864491'],
    ['0055 11 98888-7777', '+5511988887777'], ['55 11 92454-190955 11 92454-1909', '+5511924541909'], ['123', null], ['abc', null],
  ];
  for (const [raw, want] of cases) assert.equal(cleanPhone(raw), want, raw);
  assert.deepEqual(cleanPhones('55 47 9778-7001, 55 34 9712-2243'), { phones: ['+5547997787001', '+5534997122243'], invalid: [] });
});

test('e-mails de preenchimento, valores e datas', () => {
  for (const e of ['naopossuo@gmail.com', 'nao.possuo@hotmail.com', 'sem@email.com', 'teste@teste.com', 'x@x.com', 'naotem@gmail.com']) assert.equal(isPlaceholderEmail(e), true, e);
  for (const e of ['edilsonmoreira@gmail.com', 'nattylotos@hotmail.com', 'lucas.franco@ambev.com.br']) assert.equal(isPlaceholderEmail(e), false, e);
  assert.equal(moneyToCents('547812.9'), 54_781_290);
  assert.equal(moneyToCents('861007.35'), 86_100_735);
  assert.equal(moneyToCents('1.200.000,50'), 120_000_050);
  assert.equal(moneyToCents('R$ 1.500'), 150_000);
  assert.equal(moneyToCents('1,500.00'), 150_000);
  assert.equal(moneyToCents('200000'), 20_000_000);
  assert.equal(moneyToCents('abc'), null);
  assert.equal(parseSheetDate('2026-10-12'), '2026-10-12');
  assert.equal(parseSheetDate('12/10/2026'), '2026-10-12');
  assert.equal(parseSheetDate('31/02/2026'), null);
});
