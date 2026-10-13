import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrences, toZoned, validateRecurrence } from '../src/domain/recurrence.js';
import { domainOf, normalizeEmail, normalizePhone, validBirthday } from '../src/domain/contact-data.js';
import { applyCustomFields, type FieldDef } from '../src/domain/custom-fields.js';
import { decodeCsv, parseCsvText, suggestMapping } from '../src/crm/import-export.service.js';

const far = new Date('2100-01-01T00:00:00Z');
const days = (r: { starts: Date[] }, tz: string) => r.starts.map((d) => { const z = toZoned(d, tz); return `${z.y}-${String(z.m).padStart(2, '0')}-${String(z.d).padStart(2, '0')} ${String(z.h).padStart(2, '0')}:${String(z.mi).padStart(2, '0')}`; });

describe('recorrência', () => {
  test('mantém o horário de parede na mudança de horário de verão', () => {
    const r = occurrences(new Date('2030-03-08T14:00:00Z'), 'America/New_York', { freq: 'daily', interval: 1, count: 4 }, far);
    assert.deepEqual(days(r, 'America/New_York'), ['2030-03-08 09:00', '2030-03-09 09:00', '2030-03-10 09:00', '2030-03-11 09:00']);
    assert.equal(r.starts[3]!.getTime() - r.starts[2]!.getTime(), 24 * 3600_000);
    assert.equal(r.starts[2]!.getTime() - r.starts[1]!.getTime(), 23 * 3600_000, 'o dia da mudança tem 23 horas');
    assert.equal(r.ended, true);
  });

  test('mensal no dia 31 cai no último dia dos meses curtos', () => {
    const r = occurrences(new Date('2030-01-31T12:00:00Z'), 'America/Sao_Paulo', { freq: 'monthly', interval: 1, count: 4 }, far);
    assert.deepEqual(days(r, 'America/Sao_Paulo').map((d) => d.slice(0, 10)), ['2030-01-31', '2030-02-28', '2030-03-31', '2030-04-30']);
  });

  test('anual em 29 de fevereiro cai em 28 nos anos comuns', () => {
    const r = occurrences(new Date('2028-02-29T12:00:00Z'), 'UTC', { freq: 'yearly', interval: 1, count: 5 }, far);
    assert.deepEqual(days(r, 'UTC').map((d) => d.slice(0, 10)), ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });

  test('semanal em vários dias, a cada duas semanas, até uma data', () => {
    const r = occurrences(new Date('2030-01-07T12:00:00Z'), 'UTC', { freq: 'weekly', interval: 2, byWeekday: [1, 5], until: '2030-02-04' }, far);
    assert.deepEqual(days(r, 'UTC').map((d) => d.slice(0, 10)), ['2030-01-07', '2030-01-11', '2030-01-21', '2030-01-25', '2030-02-04']);
    assert.equal(r.ended, true);
  });

  test('sem fim para no horizonte e retoma de onde parou', () => {
    const start = new Date('2030-01-01T10:00:00Z');
    const a = occurrences(start, 'UTC', { freq: 'daily', interval: 1 }, new Date('2030-01-11T00:00:00Z'));
    assert.equal(a.starts.length, 10);
    assert.equal(a.ended, false);
    const b = occurrences(start, 'UTC', { freq: 'daily', interval: 1 }, new Date('2030-01-21T00:00:00Z'), { skip: 10 });
    assert.equal(days(b, 'UTC')[0], '2030-01-11 10:00');
    assert.equal(b.starts.length, 10);
  });

  test('regras inválidas são recusadas', () => {
    assert.ok(validateRecurrence({ freq: 'daily', interval: 0 }));
    assert.ok(validateRecurrence({ freq: 'daily', interval: 1, byWeekday: [1] }));
    assert.ok(validateRecurrence({ freq: 'weekly', interval: 1, count: 501 }));
    assert.equal(validateRecurrence({ freq: 'weekly', interval: 1, byWeekday: [0, 6] }), null);
  });
});

describe('dados de contato', () => {
  test('telefone em E.164, com DDD do Brasil por padrão', () => {
    assert.equal(normalizePhone('(11) 98765-4321'), '+5511987654321');
    assert.equal(normalizePhone('11 3456-7890'), '+551134567890');
    assert.equal(normalizePhone('005511987654321'), '+5511987654321');
    assert.equal(normalizePhone('+1 202 555 0143'), '+12025550143');
    assert.equal(normalizePhone('98765-4321'), null, 'sem DDD não dá para saber');
    assert.equal(normalizePhone('abc'), null);
  });

  test('e-mail, domínio e aniversário', () => {
    assert.equal(normalizeEmail('  Ana@Exemplo.COM '), 'ana@exemplo.com');
    assert.equal(normalizeEmail('ana@exemplo'), null);
    assert.equal(domainOf('https://www.Exemplo.com.br/contato?x=1'), 'exemplo.com.br');
    assert.equal(domainOf('joao@empresa.com'), 'empresa.com');
    assert.equal(validBirthday(29, 2), true);
    assert.equal(validBirthday(29, 2, 2023), false);
    assert.equal(validBirthday(31, 4), false);
  });
});

describe('campos personalizados', () => {
  const defs: FieldDef[] = [
    { key: 'plano', label: 'Plano', type: 'select', options: [{ value: 'ouro', label: 'Ouro' }], required: true, archived: false },
    { key: 'valor', label: 'Valor', type: 'currency', options: [], required: false, archived: false },
    { key: 'ativo', label: 'Ativo', type: 'boolean', options: [], required: false, archived: false },
    { key: 'inicio', label: 'Início', type: 'date', options: [], required: false, archived: false },
    { key: 'velho', label: 'Velho', type: 'text', options: [], required: false, archived: true },
  ];

  test('converte e valida cada tipo', () => {
    const r = applyCustomFields(defs, { plano: 'Ouro', valor: 1990, ativo: 'sim', inicio: '2030-02-28' }, {}, { partial: false });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.value, { plano: 'ouro', valor: 1990, ativo: true, inicio: '2030-02-28' });
    const bad = applyCustomFields(defs, { plano: 'prata', inicio: '2030-02-30', velho: 'x', outro: 1 }, {}, { partial: true });
    assert.deepEqual(bad.errors.map((e) => e.field).sort(), ['custom.inicio', 'custom.outro', 'custom.plano', 'custom.velho']);
  });

  test('obrigatório na criação e ao limpar; vazio remove', () => {
    assert.equal(applyCustomFields(defs, {}, {}, { partial: false }).errors[0]!.field, 'custom.plano');
    assert.equal(applyCustomFields(defs, { plano: '' }, { plano: 'ouro' }, { partial: true }).errors.length, 1);
    const r = applyCustomFields(defs, { valor: null }, { plano: 'ouro', valor: 5 }, { partial: true });
    assert.deepEqual(r.value, { plano: 'ouro' });
  });
});

describe('CSV', () => {
  test('lê UTF-8 com BOM e Windows-1252, com ; ou ,', () => {
    const latin = Buffer.from([0x4e, 0x6f, 0x6d, 0x65, 0x3b, 0x43, 0x69, 0x64, 0x61, 0x64, 0x65, 0x0a, 0x4a, 0x6f, 0xe3, 0x6f, 0x3b, 0x53, 0xe3, 0x6f, 0x20, 0x50, 0x61, 0x75, 0x6c, 0x6f]);
    assert.deepEqual(parseCsvText(decodeCsv(latin)), [['Nome', 'Cidade'], ['João', 'São Paulo']]);
    const utf = Buffer.concat([Buffer.from('﻿'), Buffer.from('nome,email\n"Silva, Ana",ana@x.com\n')]);
    assert.deepEqual(parseCsvText(decodeCsv(utf)), [['nome', 'email'], ['Silva, Ana', 'ana@x.com']]);
  });

  test('sugere o destino pelo cabeçalho', () => {
    assert.deepEqual(suggestMapping(['Nome', 'E-mail', 'Celular', 'CPF', 'Plano'], 'contacts', [{ key: 'plano', label: 'Plano' }]),
      { Nome: 'fullName', 'E-mail': 'email', Celular: 'phone', CPF: 'taxId', Plano: 'custom.plano' });
    assert.deepEqual(suggestMapping(['Empresa', 'CNPJ'], 'organizations', []), { Empresa: 'name', CNPJ: 'taxId' });
  });
});
