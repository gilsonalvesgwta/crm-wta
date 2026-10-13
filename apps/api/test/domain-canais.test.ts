import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { jidToE164, phoneVariants, readEvolutionEvent, statusAdvances, toEvolutionNumber } from '../src/domain/whatsapp.js';
import { isPrivateAddress, resolvePublicHost } from '../src/domain/net-guard.js';
import { textToHtml } from '../src/infra/tenant-mail.js';

describe('números do WhatsApp', () => {
  test('JID de pessoa vira E.164; grupo, lista e canal não', () => {
    assert.equal(jidToE164('5511999998888@s.whatsapp.net'), '+5511999998888');
    assert.equal(jidToE164('5511999998888:12@s.whatsapp.net'), '+5511999998888');
    assert.equal(jidToE164('120363000000@g.us'), null);
    assert.equal(jidToE164('status@broadcast'), null);
    assert.equal(jidToE164('123456789@lid'), null);
    assert.equal(toEvolutionNumber('+55 (11) 99999-8888'), '5511999998888');
  });

  test('celular brasileiro com e sem o nono dígito', () => {
    assert.deepEqual(phoneVariants('+551187654321'), ['+551187654321', '+5511987654321']);
    assert.deepEqual(phoneVariants('+5511987654321'), ['+5511987654321', '+551187654321']);
    assert.deepEqual(phoneVariants('+551133334444'), ['+551133334444'], 'fixo não muda');
    assert.deepEqual(phoneVariants('+14155550100'), ['+14155550100'], 'outro país não muda');
  });
});

describe('avisos da Evolution', () => {
  test('mensagem de texto, legenda, localização e o número alternativo (LID)', () => {
    const t = readEvolutionEvent({ event: 'MESSAGES_UPSERT', instance: 'crmwta-a', data: {
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'A1' }, pushName: 'Ana', message: { conversation: 'oi' }, messageType: 'conversation', messageTimestamp: 1760000000,
    } });
    assert.equal(t.instance, 'crmwta-a');
    const m = t.events[0]!;
    assert.equal(m.type, 'message');
    if (m.type === 'message') {
      assert.deepEqual([m.id, m.e164, m.text, m.kind, m.fromMe, m.pushName], ['A1', '+5511999998888', 'oi', 'text', false, 'Ana']);
      assert.equal(m.at.toISOString(), new Date(1760000000 * 1000).toISOString());
    }
    const img = readEvolutionEvent({ event: 'messages.upsert', data: { key: { remoteJid: '5511999998888@s.whatsapp.net', id: 'A2' }, message: { imageMessage: { caption: 'foto', mimetype: 'image/jpeg' }, base64: 'QUJD' }, messageType: 'imageMessage' } }).events[0]!;
    assert.ok(img.type === 'message' && img.kind === 'image' && img.text === 'foto' && img.media?.mimetype === 'image/jpeg' && img.media.base64 === 'QUJD');
    const loc = readEvolutionEvent({ event: 'messages.upsert', data: { key: { remoteJid: '5511999998888@s.whatsapp.net', id: 'A3' }, message: { locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6 } } } }).events[0]!;
    assert.ok(loc.type === 'message' && loc.kind === 'location' && loc.text!.includes('-23.5,-46.6'));
    const lid = readEvolutionEvent({ event: 'messages.upsert', data: { key: { remoteJid: '99999@lid', remoteJidAlt: '5511988887777@s.whatsapp.net', id: 'A4' }, message: { conversation: 'x' } } }).events[0]!;
    assert.ok(lid.type === 'message' && lid.e164 === '+5511988887777');
  });

  test('reação, grupo e evento desconhecido são ignorados', () => {
    const r = readEvolutionEvent({ event: 'messages.upsert', data: { key: { remoteJid: '5511999998888@s.whatsapp.net', id: 'R' }, message: { reactionMessage: { text: '👍' } }, messageType: 'reactionMessage' } });
    assert.equal(r.events[0]!.type, 'ignored');
    assert.equal(readEvolutionEvent({ event: 'messages.upsert', data: { key: { remoteJid: '1203@g.us', id: 'G' }, message: { conversation: 'x' } } }).events[0]!.type, 'ignored');
    assert.equal(readEvolutionEvent({ event: 'chats.update', data: {} }).events[0]!.type, 'ignored');
    assert.equal(readEvolutionEvent('lixo').events[0]!.type, 'ignored');
  });

  test('estado de entrega e de conexão', () => {
    assert.deepEqual(readEvolutionEvent({ event: 'messages.update', data: { keyId: 'K', status: 'DELIVERY_ACK' } }).events, [{ type: 'status', id: 'K', status: 'delivered' }]);
    assert.deepEqual(readEvolutionEvent({ event: 'messages.update', data: { key: { id: 'K' }, update: { status: 4 } } }).events, [{ type: 'status', id: 'K', status: 'read' }]);
    assert.deepEqual(readEvolutionEvent({ event: 'connection.update', data: { state: 'open', wuid: '5511988887777@s.whatsapp.net' } }).events,
      [{ type: 'connection', state: 'open', e164: '+5511988887777' }]);
    assert.equal(statusAdvances('sent', 'delivered'), true);
    assert.equal(statusAdvances('read', 'delivered'), false);
    assert.equal(statusAdvances('read', 'failed'), false);
    assert.equal(statusAdvances('queued', 'failed'), true);
  });
});

describe('proteção de rede do SMTP da empresa', () => {
  test('endereços internos são recusados', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1', '0.0.0.0']) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '2a00:1450:4001::1', '191.252.1.1']) assert.equal(isPrivateAddress(ip), false, ip);
    await assert.rejects(resolvePublicHost('127.0.0.1'), /interno/);
    assert.equal(await resolvePublicHost('127.0.0.1', true), '127.0.0.1');
  });

  test('texto do e-mail não vira HTML', () => {
    assert.equal(textToHtml('<script>x</script>\nlinha').includes('<script>'), false);
    assert.match(textToHtml('a\nb'), /a<br>b/);
  });
});
