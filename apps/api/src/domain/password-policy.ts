// Regra de senha: comprimento é o que mais pesa. Sem exigências de símbolo,
// que só levam a senhas previsíveis. Recusa as senhas mais comuns e as que
// repetem o e-mail.

const COMMON = new Set([
  '12345678', '123456789', '1234567890', '12345678910', 'password', 'password1', 'senha123',
  'senha1234', 'qwertyui', 'qwerty123', '11111111', '00000000', 'abc12345', 'iloveyou',
  'admin123', 'administrador', 'brasil123', 'mudar123', 'trocar123', 'senhasenha',
]);

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`;
  if (password.length > PASSWORD_MAX) return `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'Essa senha é muito comum. Escolha outra.';
  if (/^(.)\1+$/.test(password)) return 'A senha não pode ser um caractere repetido.';
  if (email) {
    const local = email.toLowerCase().split('@')[0] ?? '';
    if (local.length >= 4 && lower.includes(local)) return 'A senha não pode conter o seu e-mail.';
  }
  return null;
}
