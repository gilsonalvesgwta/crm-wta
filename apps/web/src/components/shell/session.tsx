'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ApiError, api, type Me } from '@/lib/api';
import { applyTheme, type Branding } from '@/lib/theme';
import { Spinner } from '@/components/ui/spinner';

type Session = {
  me: Me;
  branding: Branding | null;
  reload: () => Promise<void>;
  setBranding: (b: Branding) => void;
  can: (permission: string) => boolean;
};

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession fora do SessionProvider');
  return s;
}

/** Carrega a sessão e manda para o passo que falta (login, código, empresa). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [branding, setBrandingState] = useState<Branding | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await api<Me>('GET', '/api/v1/auth/me');
      const back = encodeURIComponent(pathname);
      if (m.mfa.pending) return router.replace(`/entrar/verificacao?voltar=${back}`);
      if (!m.tenantId && !m.user.isPlatformAdmin) return router.replace(`/entrar/empresa?voltar=${back}`);
      if (m.tenantId) {
        const b = await api<Branding>('GET', '/api/v1/branding').catch(() => null);
        if (b) {
          applyTheme(b);
          setBrandingState(b);
        }
      }
      setMe(m);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace(`/entrar?motivo=sessao&voltar=${encodeURIComponent(pathname)}`);
        return;
      }
      setFailed(e instanceof ApiError ? e.title : 'Não foi possível carregar a sessão.');
    }
  }, [pathname, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-medium">{failed}</p>
        <button type="button" className="h-10 rounded-[6px] border border-line bg-surface px-4 font-medium" onClick={() => { setFailed(null); void load(); }}>
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!me) {
    return <div className="flex min-h-screen items-center justify-center text-muted"><Spinner label="Carregando" /></div>;
  }
  const can = (p: string) => p in me.permissions;
  const setBranding = (b: Branding) => {
    applyTheme(b);
    setBrandingState(b);
  };
  return <Ctx.Provider value={{ me, branding, reload: load, setBranding, can }}>{children}</Ctx.Provider>;
}
