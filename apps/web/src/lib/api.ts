// Cliente da API. Mesmo domínio, cookie de sessão e o cabeçalho anti-CSRF que
// a API exige em toda mutação.

export type FieldError = { field: string; message: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    readonly title: string,
    readonly errors: FieldError[] = [],
    readonly retryAfter?: number,
  ) {
    super(title);
  }
  fieldError(field: string): string | undefined {
    return this.errors.find((e) => e.field === field)?.message;
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-crm-request': '1' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const p = (data ?? {}) as { type?: string; title?: string; errors?: FieldError[] };
    const retry = Number(res.headers.get('retry-after'));
    throw new ApiError(res.status, p.type ?? 'error', p.title ?? 'Algo deu errado. Tente de novo.', p.errors ?? [],
      Number.isFinite(retry) && retry > 0 ? retry : undefined);
  }
  return data as T;
}

export type Me = {
  user: { id: string; email: string; name: string; isPlatformAdmin: boolean };
  mfa: { enabled: boolean; verified: boolean; pending: boolean };
  tenantId: string | null;
  tenants: { id: string; name: string; slug: string }[];
  permissions: Record<string, 'own' | 'team' | 'tenant'>;
};

export type LoginResponse = {
  mfaRequired: boolean;
  tenantId: string | null;
  tenants: { id: string; name: string; slug: string }[];
};

/** Para onde ir depois do login, conforme o que falta. */
export function nextStep(r: { mfaRequired?: boolean; mfa?: { pending: boolean }; tenantId: string | null }, back?: string | null): string {
  if (r.mfaRequired || r.mfa?.pending) return '/entrar/verificacao' + (back ? `?voltar=${encodeURIComponent(back)}` : '');
  if (!r.tenantId) return '/entrar/empresa' + (back ? `?voltar=${encodeURIComponent(back)}` : '');
  return safeBack(back) ?? '/inicio';
}

/** Só aceita voltar para um caminho interno. */
export function safeBack(back: string | null | undefined): string | null {
  if (!back || !back.startsWith('/') || back.startsWith('//') || back.startsWith('/api')) return null;
  return back;
}
