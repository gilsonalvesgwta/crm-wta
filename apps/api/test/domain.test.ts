import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, hotp, otpauthUri, totpAt, verifyTotp } from '../src/domain/totp.js';
import { SecretBox, newRecoveryCodes, normalizeRecoveryCode, newToken, tokenHash } from '../src/domain/secrets.js';
import { passwordProblem } from '../src/domain/password-policy.js';
import { lockoutSeconds, remainingLockout } from '../src/domain/lockout.js';
import {
  ALL_PERMISSIONS, PERMISSIONS, REQUIRES_MFA, ROLE_TEMPLATES, mergeGrants, scopeAllowed, scopeCovers,
  type Permission,
} from '../src/domain/permissions.js';

// Vetores do apêndice D da RFC 4226 e do apêndice B da RFC 6238 (SHA-1).
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

test('HOTP confere com os vetores da RFC 4226', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  expected.forEach((code, counter) => assert.equal(hotp(RFC_SECRET, counter), code));
});

test('TOTP confere com os vetores da RFC 6238', () => {
  const cases: [number, string][] = [
    [59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'],
    [2000000000, '279037'], [20000000000, '353130'],
  ];
  for (const [t, code] of cases) assert.equal(totpAt(RFC_SECRET, t * 1000), code);
});

test('verifyTotp aceita um passo de diferença e recusa dois', () => {
  const now = 1_700_000_000_000;
  assert.notEqual(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 30_000), now), null);
  assert.notEqual(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now + 30_000), now), null);
  assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 60_000), now), null);
  assert.equal(verifyTotp(RFC_SECRET, 'abcdef', now), null);
  assert.equal(verifyTotp(RFC_SECRET, '12345', now), null);
});

test('base32 vai e volta, e o otpauth leva o segredo', () => {
  const s = Buffer.from('segredo de teste!!!!');
  assert.deepEqual(base32Decode(base32Encode(s)), s);
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
  const uri = otpauthUri(s, 'ana@wta.com.br', 'CRM WTA');
  assert.match(uri, /^otpauth:\/\/totp\/CRM%20WTA%3Aana%40wta\.com\.br\?/);
  assert.match(uri, new RegExp(`secret=${base32Encode(s)}`));
});

test('SecretBox cifra, decifra, recusa adulteração e troca de contexto', () => {
  const k1 = Buffer.alloc(32, 1);
  const k2 = Buffer.alloc(32, 2);
  const box = new SecretBox({ 1: k1 }, 1);
  const sealed = box.seal(Buffer.from('chave da evolution'), 'tenant-a');
  assert.equal(box.open(sealed, 'tenant-a').toString(), 'chave da evolution');
  assert.throws(() => box.open(sealed, 'tenant-b'));
  const bad = Buffer.from(sealed);
  bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
  assert.throws(() => box.open(bad, 'tenant-a'));
  const rotated = new SecretBox({ 1: k1, 2: k2 }, 2);
  assert.equal(rotated.open(sealed, 'tenant-a').toString(), 'chave da evolution');
  assert.equal(rotated.seal(Buffer.from('x'))[0], 2);
  assert.throws(() => new SecretBox({ 1: Buffer.alloc(16) }, 1));
});

test('tokens e códigos de recuperação', () => {
  const a = newToken();
  assert.equal(Buffer.from(a, 'base64url').length, 32);
  assert.notEqual(a, newToken());
  assert.equal(tokenHash(a).length, 32);
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
  assert.equal(normalizeRecoveryCode(' ABCDE FGHJK '), 'abcde-fghjk');
});

test('regra de senha', () => {
  assert.match(passwordProblem('curta')!, /10 caracteres/);
  assert.match(passwordProblem('1234567890')!, /comum/);
  assert.match(passwordProblem('aaaaaaaaaaaa')!, /repetido/);
  assert.match(passwordProblem('marina.duarte2026', 'marina.duarte@wta.com.br')!, /e-mail/);
  assert.equal(passwordProblem('cavalo correto bateria grampo'), null);
});

test('bloqueio progressivo', () => {
  assert.equal(lockoutSeconds(4, 0), 0);
  assert.equal(lockoutSeconds(5, 0), 60);
  assert.equal(lockoutSeconds(8, 0), 900);
  assert.equal(lockoutSeconds(0, 30), 900);
  const now = new Date('2026-10-12T10:00:00Z');
  assert.equal(remainingLockout(5, 0, new Date('2026-10-12T09:59:30Z'), now), 30);
  assert.equal(remainingLockout(5, 0, new Date('2026-10-12T09:58:00Z'), now), 0);
});

test('perfis padrão respeitam o alcance de cada permissão', () => {
  for (const t of ROLE_TEMPLATES) {
    for (const [p, s] of Object.entries(t.grants)) {
      assert.ok(p in PERMISSIONS, `${t.key}: permissão desconhecida ${p}`);
      assert.ok(scopeAllowed(p as Permission, s), `${t.key}: ${p} com alcance ${s}`);
    }
  }
  assert.deepEqual(ROLE_TEMPLATES.map((t) => t.key), ['admin', 'manager', 'team_lead', 'sales', 'support', 'marketing', 'finance', 'viewer']);
});

test('só o administrador tem as permissões que exigem 2FA', () => {
  for (const t of ROLE_TEMPLATES) {
    const has = [...REQUIRES_MFA].filter((p) => p in t.grants);
    if (t.key === 'admin') assert.equal(has.length, REQUIRES_MFA.size);
    else assert.deepEqual(has, [], t.key);
  }
});

test('linhas da matriz conferidas uma a uma', () => {
  const g = (key: string) => ROLE_TEMPLATES.find((t) => t.key === key)!.grants;
  assert.equal(g('sales')['deals:view'], 'own');
  assert.equal(g('sales')['deals:assign'], undefined);
  assert.equal(g('sales')['conversations:take'], 'team');
  assert.equal(g('team_lead')['deals:assign'], 'team');
  assert.equal(g('support')['contacts:view'], 'team');
  assert.equal(g('support')['contacts:edit'], 'own');
  assert.equal(g('finance')['deals:export'], 'tenant');
  assert.equal(g('finance')['deals:edit'], undefined);
  assert.equal(g('viewer')['leads:work'], undefined);
  assert.equal(g('manager')['users:admin'], undefined);
  assert.equal(g('manager')['audit:view'], 'tenant');
  assert.equal(g('marketing')['automations:admin'], undefined);
  assert.equal(Object.keys(g('admin')).length, ALL_PERMISSIONS.length - 3);
});

test('união de perfis fica com o maior alcance', () => {
  const m = mergeGrants([
    { permission: 'deals:view', scope: 'own' },
    { permission: 'deals:view', scope: 'team' },
    { permission: 'inexistente:x', scope: 'tenant' },
  ]);
  assert.equal(m.get('deals:view'), 'team');
  assert.equal(m.size, 1);
  assert.ok(scopeCovers('tenant', 'own'));
  assert.ok(!scopeCovers('own', 'team'));
  assert.ok(!scopeCovers(undefined, 'own'));
});
