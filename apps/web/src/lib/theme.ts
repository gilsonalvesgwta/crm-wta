// Converte o tema da empresa (vindo da API, já validado) em variáveis CSS.

export type Theme = {
  primary: string;
  primaryForeground: string;
  accentOnLight: string;
  accentOnDark: string;
  mode: 'light' | 'dark';
  sidebar?: string;
  sidebarAccent?: string;
};
export type Branding = {
  productName: string; theme: Theme; customized: boolean;
  logoUrl?: string | null; iconUrl?: string | null; tenantName?: string;
};

/** Mistura a cor com branco (para os tons do menu lateral). */
function lighten(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.round(x + (255 - x) * t));
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

function soft(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${alpha})`;
}

export function themeVars(b: Branding): Record<string, string> {
  const t = b.theme;
  if (![t.primary, t.primaryForeground, t.accentOnLight, t.accentOnDark].every((c) => HEX.test(c))) return {};
  const dark = t.mode === 'dark';
  const vars: Record<string, string> = {
    '--primary': t.primary,
    '--primary-fg': t.primaryForeground,
    '--focus': dark ? t.accentOnDark : t.accentOnLight,
    '--accent': dark ? t.accentOnDark : t.accentOnLight,
    '--accent-soft': soft(t.primary, dark ? 0.16 : 0.1),
  };
  if (t.sidebar && HEX.test(t.sidebar)) {
    // Menu na cor escolhida pela empresa (escura, conferida pela API).
    Object.assign(vars, {
      '--side': t.sidebar,
      '--side-active': lighten(t.sidebar, 0.1),
      '--side-border': lighten(t.sidebar, 0.1),
      '--side-mark': t.sidebarAccent && HEX.test(t.sidebarAccent) ? t.sidebarAccent : t.accentOnDark,
    });
  } else if (b.customized) {
    // Empresa com marca própria: menu lateral neutro, marca só nos destaques.
    Object.assign(vars, {
      '--side': '#101828',
      '--side-active': '#1D2939',
      '--side-border': '#1D2939',
      '--side-mark': t.accentOnDark,
    });
  }
  return vars;
}

export function themeCss(b: Branding): string {
  const vars = themeVars(b);
  const body = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
  return body ? `:root{${body}}` : '';
}

export function applyTheme(b: Branding): void {
  const root = document.documentElement;
  root.dataset.theme = b.theme.mode;
  // Recomeça do zero: o tema anterior pode ter definido variáveis que este não define.
  root.removeAttribute('style');
  document.getElementById('tema-da-empresa')?.remove();
  for (const [k, v] of Object.entries(themeVars(b))) root.style.setProperty(k, v);
}
