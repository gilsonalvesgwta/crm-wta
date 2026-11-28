// Nome do contato nas mensagens em massa: cadastros como "sem nome", "Deus é
// fiel", números ou emojis não viram "Olá, sem nome". Nome suspeito fica vazio
// e a mensagem usa a alternativa escrita em {{primeiro_nome|cliente}}.

const PLACEHOLDERS = /^(sem ?nome|sem-nome|s\/ ?nome|nome|desconhecido|nao informado|não informado|cliente|contato|teste|test|null|undefined|n\/a|na|usuario|usuário|whatsapp|wpp|zap|lead|novo contato|\.+|-+|_+|\?+)$/i;
const PHRASE_WORDS = /\b(deus|jesus|cristo|senhor|fiel|gloria|glória|amem|amém|aben[cç]oad[oa]s?|gratid[aã]o|vendas|loja|empresa|oficial|atendimento|suporte|comercial|delivery|store|shop|ltda|eireli)\b/i;

const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Primeira letra maiúscula quando o cadastro está todo em maiúsculas ou minúsculas. */
function fixCase(s: string): string {
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (w) => w.toLowerCase());
}

/** Por que o nome parece não ser um nome (ou null se parece um nome). */
export function nameProblem(raw: string | null | undefined): string | null {
  const s = (raw ?? '').replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, '').replace(/\s+/g, ' ').trim();
  if (!s) return 'vazio';
  if (PLACEHOLDERS.test(s) || /^sem ?nome\b/i.test(strip(s))) return 'sem nome';
  if (/\d/.test(s)) return 'tem números';
  if (!/\p{L}/u.test(s)) return 'sem letras';
  const letters = s.match(/\p{L}/gu)?.length ?? 0;
  if ((strip(s).match(/[a-z]/gi)?.length ?? 0) < letters / 2) return 'não é do nosso alfabeto';
  if (PHRASE_WORDS.test(strip(s))) return 'parece frase ou empresa';
  if (s.split(' ').length > 5 || s.length > 50) return 'longo demais';
  if (/[@#$%&*=+<>{}[\]\\/|]/.test(s)) return 'tem símbolos';
  return null;
}

/** Nome para a mensagem: limpo, ou vazio se o cadastro não parece um nome. */
export function cleanName(raw: string | null | undefined): string {
  if (nameProblem(raw)) return '';
  return fixCase((raw ?? '').replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, '').replace(/\s+/g, ' ').trim());
}

/** Primeiro nome para a mensagem (vazio se o cadastro não parece um nome). */
export function cleanFirstName(first: string | null | undefined, full: string | null | undefined): string {
  const n = cleanName(full) || cleanName(first);
  return n.split(' ')[0] ?? '';
}
