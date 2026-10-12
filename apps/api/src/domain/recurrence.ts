// Recorrência de atividades no fuso da empresa. O horário de parede se mantém
// nas mudanças de horário de verão: uma reunião às 9h continua às 9h.

export type Recurrence = {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  /** Semanal: dias da semana, 0 = domingo. Vazio usa o dia do início. */
  byWeekday?: number[];
  /** Último dia possível (AAAA-MM-DD), inclusive. */
  until?: string | null;
  /** Total de ocorrências, contando a primeira. */
  count?: number | null;
};

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Data e hora de parede de um instante no fuso. */
export function toZoned(date: Date, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(date)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return { y: out.year!, m: out.month!, d: out.day!, h: out.hour! % 24, mi: out.minute!, s: out.second! };
}

/**
 * Instante de uma hora de parede no fuso. Num horário que não existe (o salto
 * do horário de verão), avança para o primeiro que existe.
 */
export function fromZoned(p: Parts, tz: string): Date {
  const guess = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  let t = guess;
  for (let i = 0; i < 3; i++) {
    const z = toZoned(new Date(t), tz);
    const asUtc = Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s);
    const diff = guess - asUtc;
    if (diff === 0) return new Date(t);
    t += diff;
  }
  return new Date(t);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDays(y: number, m: number, d: number, n: number): { y: number; m: number; d: number } {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function weekday(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function validateRecurrence(r: Recurrence): string | null {
  if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 99) return 'O intervalo vai de 1 a 99.';
  if (r.byWeekday && (r.byWeekday.some((x) => !Number.isInteger(x) || x < 0 || x > 6) || r.freq !== 'weekly')) {
    return 'Dias da semana só valem para repetição semanal.';
  }
  if (r.count != null && (!Number.isInteger(r.count) || r.count < 1 || r.count > 500)) return 'O número de repetições vai de 1 a 500.';
  if (r.until && !/^\d{4}-\d{2}-\d{2}$/.test(r.until)) return 'Data final inválida.';
  return null;
}

/**
 * Ocorrências a partir do início (incluído), até `horizon` (exclusive), no
 * máximo `max`. Devolve os inícios e se a série terminou (pelo fim ou pela
 * contagem) dentro do horizonte.
 * Mensal no dia 31 cai no último dia dos meses mais curtos; anual em 29/02
 * cai em 28/02 nos anos não bissextos.
 */
export function occurrences(start: Date, tz: string, rule: Recurrence, horizon: Date, opts: { skip?: number; max?: number } = {}): { starts: Date[]; ended: boolean } {
  const base = toZoned(start, tz);
  const max = opts.max ?? 500;
  const skip = opts.skip ?? 0;
  const untilKey = rule.until ? Number(rule.until.replaceAll('-', '')) : Infinity;
  const out: Date[] = [];
  let index = 0;
  const emit = (y: number, m: number, d: number): 'ok' | 'stop' | 'horizon' => {
    if (y * 10000 + m * 100 + d > untilKey) return 'stop';
    if (rule.count != null && index >= rule.count) return 'stop';
    const at = fromZoned({ y, m, d, h: base.h, mi: base.mi, s: base.s }, tz);
    if (at.getTime() < start.getTime()) return 'ok';
    if (at.getTime() >= horizon.getTime()) return 'horizon';
    if (index >= skip) out.push(at);
    index++;
    return out.length >= max ? 'horizon' : 'ok';
  };

  if (rule.freq === 'daily') {
    for (let k = 0; ; k++) {
      const { y, m, d } = addDays(base.y, base.m, base.d, k * rule.interval);
      const r = emit(y, m, d);
      if (r !== 'ok') return { starts: out, ended: r === 'stop' };
    }
  }
  if (rule.freq === 'weekly') {
    const days = (rule.byWeekday?.length ? [...new Set(rule.byWeekday)] : [weekday(base.y, base.m, base.d)]).sort((a, b) => a - b);
    // Domingo da semana do início.
    const sunday = addDays(base.y, base.m, base.d, -weekday(base.y, base.m, base.d));
    for (let w = 0; ; w++) {
      for (const wd of days) {
        const { y, m, d } = addDays(sunday.y, sunday.m, sunday.d, w * 7 * rule.interval + wd);
        const r = emit(y, m, d);
        if (r !== 'ok') return { starts: out, ended: r === 'stop' };
      }
    }
  }
  if (rule.freq === 'monthly') {
    for (let k = 0; ; k++) {
      const total = base.m - 1 + k * rule.interval;
      const y = base.y + Math.floor(total / 12);
      const m = (total % 12) + 1;
      const r = emit(y, m, Math.min(base.d, daysInMonth(y, m)));
      if (r !== 'ok') return { starts: out, ended: r === 'stop' };
    }
  }
  for (let k = 0; ; k++) {
    const y = base.y + k * rule.interval;
    const r = emit(y, base.m, Math.min(base.d, daysInMonth(y, base.m)));
    if (r !== 'ok') return { starts: out, ended: r === 'stop' };
  }
}
