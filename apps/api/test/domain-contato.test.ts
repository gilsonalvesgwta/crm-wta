import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractContactInfo, isPlaceholderName, splitName } from '../src/domain/contact-info.js';

test('acha e-mail e telefone no texto da mensagem', () => {
  assert.deepEqual(extractContactInfo('Meu email é Ana.Souza@Exemplo.com.br. Cel (11) 98888-7777'), { emails: ['ana.souza@exemplo.com.br'], phones: ['+5511988887777'] });
  assert.deepEqual(extractContactInfo('whats +55 47 92001-1193 ou fixo 47 3333-4444').phones, ['+5547920011193', '+554733334444']);
  assert.deepEqual(extractContactInfo('+1 (415) 555-0100').phones, ['+14155550100']);
  assert.deepEqual(extractContactInfo('CPF 123.456.789-09, CEP 89010-000, pedido 2026110912').phones, [], 'CPF, CEP e números soltos não são telefone');
  assert.deepEqual(extractContactInfo(null), { emails: [], phones: [] });
});

test('nome provisório do Instagram e divisão do nome', () => {
  assert.equal(isPlaceholderName('@maria.silva'), true);
  assert.equal(isPlaceholderName('Instagram 392111'), true);
  assert.equal(isPlaceholderName('Maria'), false);
  assert.equal(isPlaceholderName('@maria', 'Silva'), false);
  assert.deepEqual(splitName('  Carol   Santos Maroni '), { first: 'Carol', last: 'Santos Maroni' });
  assert.deepEqual(splitName('Moreira'), { first: 'Moreira', last: null });
});
