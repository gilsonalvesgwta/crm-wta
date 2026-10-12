// Bloqueio progressivo de login. As falhas vêm do banco (auth_events), então o
// bloqueio vale para todas as instâncias da API e sobrevive a reinícios.

export const LOCKOUT_WINDOW_MINUTES = 15;

/** Espera exigida, em segundos, conforme as falhas recentes do e-mail e do IP. */
export function lockoutSeconds(byEmail: number, byIp: number): number {
  let wait = 0;
  if (byEmail >= 5) wait = 60;
  if (byEmail >= 8) wait = 15 * 60;
  if (byIp >= 30) wait = Math.max(wait, 15 * 60);
  return wait;
}

/** Segundos que ainda faltam, a partir da última falha. */
export function remainingLockout(byEmail: number, byIp: number, lastFailureAt: Date | null, now: Date): number {
  const wait = lockoutSeconds(byEmail, byIp);
  if (wait === 0 || !lastFailureAt) return wait;
  const elapsed = Math.floor((now.getTime() - lastFailureAt.getTime()) / 1000);
  return Math.max(0, wait - elapsed);
}
