'use client';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { themeVars, type Branding } from '@/lib/theme';
import { buildTheme } from '@/lib/theme-build';
import { useSession } from '@/components/shell/session';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Confirm } from '@/components/ui/confirm';
import { LoadError, Loading } from '@/components/ui/states';

const HEX = /^#[0-9A-Fa-f]{6}$/;

export default function BrandingPage() {
  const { setBranding } = useSession();
  const { data, error, loading, reload, setData } = useLoad(() => api<Branding>('GET', '/api/v1/branding'));
  const [name, setName] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [mode, setMode] = useState<'light' | 'dark' | null>(null);
  const [preview, setPreview] = useState<Branding | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [askReset, setAskReset] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <LoadError error={error} retry={reload} />;
  const cur = data!;
  const v = { productName: name ?? cur.productName, primary: color ?? cur.theme.primary, mode: mode ?? cur.theme.mode };
  const dirty = name !== null || color !== null || mode !== null;
  const shown = preview ?? cur;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!HEX.test(v.primary)) {
      setErr(new ApiError(422, 'validation', 'Ajuste as cores.', [{ field: 'primary', message: 'Use uma cor no formato #RRGGBB.' }]));
      return;
    }
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const b = await api<Branding>('PUT', '/api/v1/branding', v);
      setData(b);
      setPreview(null);
      setName(null); setColor(null); setMode(null);
      setBranding(b);
      setMsg('Identidade visual salva. Ela já vale para todos da empresa.');
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setResetting(true);
    try {
      const b = await api<Branding>('POST', '/api/v1/branding/reset');
      setData(b);
      setPreview(null);
      setName(null); setColor(null); setMode(null);
      setBranding(b);
      setMsg('Tema padrão restaurado.');
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível restaurar.'));
    } finally {
      setResetting(false);
      setAskReset(false);
    }
  }

  // Pré-visualização local: cor e modo escolhidos, contraste conferido pela API ao salvar.
  function previewWith(next: { primary: string; mode: 'light' | 'dark' }) {
    const built = buildTheme(next);
    if ('theme' in built) {
      setPreview({ productName: v.productName, customized: true, theme: built.theme });
      setErr(null);
    } else {
      setPreview(null);
      setErr(new ApiError(422, 'validation', 'Ajuste as cores.', built.problems));
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <Panel title="Identidade visual" description="Nome do produto, cor da marca e tema que todos da empresa veem.">
        <form onSubmit={save} noValidate className="flex max-w-md flex-col gap-4">
          {msg ? <Alert tone="success">{msg}</Alert> : null}
          {err && !err.fieldError('primary') && !err.fieldError('productName') ? <Alert tone="error">{err.title}</Alert> : null}
          <Field label="Nome exibido do produto" value={v.productName} maxLength={80}
            onChange={(e) => setName(e.target.value)} error={err?.fieldError('productName')} />
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium" id="cor-label">Cor da marca</span>
            <div className="flex items-center gap-3">
              <input type="color" aria-labelledby="cor-label" value={HEX.test(v.primary) ? v.primary : '#000000'}
                onChange={(e) => { setColor(e.target.value.toUpperCase()); previewWith({ primary: e.target.value, mode: v.mode }); }}
                className="h-11 w-14 cursor-pointer rounded-[6px] border border-line-strong bg-surface p-1" />
              <input aria-label="Cor da marca em hexadecimal" value={v.primary} maxLength={7}
                onChange={(e) => { setColor(e.target.value); previewWith({ primary: e.target.value, mode: v.mode }); }}
                className={`h-11 w-32 rounded-[6px] border bg-surface px-3 font-mono text-sm ${err?.fieldError('primary') ? 'border-bad' : 'border-line-strong'}`} />
            </div>
            {err?.fieldError('primary') ? <p className="text-[13px] text-bad">{err.fieldError('primary')}</p>
              : <p className="text-[13px] text-muted">O sistema escolhe a cor do texto sobre ela e recusa cores sem contraste suficiente.</p>}
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[13px] font-medium">Tema</legend>
            {(['light', 'dark'] as const).map((m) => (
              <label key={m} className="flex min-h-11 items-center gap-2.5">
                <input type="radio" name="modo" checked={v.mode === m} onChange={() => { setMode(m); previewWith({ primary: v.primary, mode: m }); }}
                  className="size-[18px] accent-[var(--primary)]" />
                {m === 'light' ? 'Claro' : 'Escuro'}
              </label>
            ))}
          </fieldset>
          <p className="text-[13px] text-muted">Envio de logotipo e favicon chega junto com o armazenamento de arquivos.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={saving} disabled={!dirty}>Salvar</Button>
            {dirty ? <Button type="button" variant="ghost" onClick={() => { setName(null); setColor(null); setMode(null); setPreview(null); setErr(null); }}>Descartar</Button> : null}
            {cur.customized ? <Button type="button" variant="secondary" onClick={() => setAskReset(true)}>Restaurar padrão</Button> : null}
          </div>
        </form>
      </Panel>

      <Panel title="Pré-visualização">
        <ThemePreview branding={shown} />
      </Panel>

      <Confirm open={askReset} title="Restaurar o tema padrão?" confirmLabel="Restaurar" danger={false} loading={resetting}
        onConfirm={reset} onCancel={() => setAskReset(false)}>
        O nome do produto e a cor voltam ao padrão para todos da empresa. A versão atual fica guardada no histórico.
      </Confirm>
    </div>
  );
}

function ThemePreview({ branding }: { branding: Branding }) {
  const vars = themeVars(branding) as CSSProperties;
  const dark = branding.theme.mode === 'dark';
  return (
    <div data-theme={dark ? 'dark' : 'light'} style={vars}
      className="overflow-hidden rounded-[8px] border border-line" aria-label="Exemplo do tema" role="img">
      <div className="flex">
        <div className="flex w-28 flex-col gap-1.5 bg-side p-2.5">
          <div className="mb-1 truncate text-[12px] font-semibold text-white">{branding.productName}</div>
          <div className="rounded-[4px] bg-side-active px-2 py-1.5 text-[11px] font-semibold text-side-active-text">
            <span className="mr-1 inline-block size-1.5 rounded-full bg-side-mark align-middle" />Início
          </div>
          <div className="px-2 py-1.5 text-[11px] text-side-text">Negócios</div>
          <div className="px-2 py-1.5 text-[11px] text-side-text">Contatos</div>
        </div>
        <div className="flex flex-1 flex-col gap-3 bg-bg p-3 text-ink">
          <div className="rounded-[6px] border border-line bg-surface p-3">
            <p className="text-[12px] font-semibold">Negócio exemplo</p>
            <p className="mt-0.5 text-[11px] text-muted">Texto secundário</p>
            <p className="mt-2 text-[11px] font-medium text-accent">Link de destaque</p>
          </div>
          <span className="inline-flex h-8 items-center justify-center self-start rounded-[6px] bg-primary px-3 text-[12px] font-semibold text-primary-fg">Botão principal</span>
        </div>
      </div>
    </div>
  );
}
