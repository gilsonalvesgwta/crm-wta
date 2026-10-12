// Tema por empresa. A empresa escolhe a cor da marca; o sistema deriva as cores
// de texto que garantem contraste (WCAG 2.2 AA) e recusa o que não tem conserto.

export type ThemeInput = { primary: string; mode?: 'light' | 'dark' };

export type Theme = {
  primary: string;
  primaryForeground: string;
  /** Cor da marca para links e destaques sobre fundo claro. */
  accentOnLight: string;
  /** Cor da marca para links e destaques sobre fundo escuro. */
  accentOnDark: string;
  mode: 'light' | 'dark';
};

export const DEFAULT_THEME: Theme = {
  primary: '#FF6600',
  primaryForeground: '#051628',
  accentOnLight: '#B84300',
  accentOnDark: '#FF8A3D',
  mode: 'light',
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const INK = '#051628';
const WHITE = '#FFFFFF';
const SURFACE_LIGHT = '#FFFFFF';
const SURFACE_DARK = '#0B2038';

export function isHex(v: string): boolean {
  return HEX.test(v);
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mistura a cor com preto (t<0) ou branco (t>0), t em [-1, 1]. */
function shade(hex: string, t: number): string {
  const target = t < 0 ? 0 : 255;
  const k = Math.abs(t);
  return toHex(rgb(hex).map((c) => c + (target - c) * k) as [number, number, number]);
}

/** Primeiro tom da cor que alcança o contraste pedido sobre o fundo. */
function adjustFor(hex: string, background: string, min: number, direction: -1 | 1): string | null {
  for (let i = 0; i <= 100; i++) {
    const c = shade(hex, (direction * i) / 100);
    if (contrast(c, background) >= min) return c;
  }
  return null;
}

export type ThemeProblem = { field: string; message: string };

export function buildTheme(input: ThemeInput): { theme: Theme } | { problems: ThemeProblem[] } {
  const problems: ThemeProblem[] = [];
  if (!isHex(input.primary)) {
    return { problems: [{ field: 'primary', message: 'Use uma cor no formato #RRGGBB.' }] };
  }
  const primary = input.primary.toUpperCase();
  // Texto sobre o botão principal: o que der mais contraste, desde que passe de 4,5:1.
  const fg = [INK, WHITE].sort((a, b) => contrast(b, primary) - contrast(a, primary))[0]!;
  if (contrast(fg, primary) < 4.5) {
    problems.push({
      field: 'primary',
      message: 'Nenhum texto fica legível sobre essa cor. Escolha um tom mais claro ou mais escuro.',
    });
  }
  // Controles (bordas de foco, ícones) precisam de 3:1 contra a superfície clara ou escura.
  if (contrast(primary, SURFACE_LIGHT) < 3 && contrast(primary, SURFACE_DARK) < 3) {
    problems.push({ field: 'primary', message: 'Essa cor some contra o fundo. Escolha um tom com mais contraste.' });
  }
  if (problems.length) return { problems };
  const accentOnLight = adjustFor(primary, SURFACE_LIGHT, 4.5, -1)!;
  const accentOnDark = adjustFor(primary, SURFACE_DARK, 4.5, 1)!;
  return {
    theme: { primary, primaryForeground: fg, accentOnLight, accentOnDark, mode: input.mode ?? 'light' },
  };
}
