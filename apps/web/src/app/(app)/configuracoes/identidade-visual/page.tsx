'use client';
import { useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Check, ImageUp, Trash2 } from 'lucide-react';
import { ApiError, api, apiUpload } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { themeVars, type Branding } from '@/lib/theme';
import { buildTheme, PALETTES } from '@/lib/theme-build';
import { useSession } from '@/components/shell/session';
import { Panel } from '@/components/ui/panel';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Confirm } from '@/components/ui/confirm';
import { LoadError, Loading } from '@/components/ui/states';

const HEX = /^#[0-9A-Fa-f]{6}$/;

type Form = { productName: string; primary: string; mode: 'light' | 'dark'; sidebar: string | null };

export default function BrandingPage() {
  const { setBranding } = useSession();
  const { data, error, loading, reload, setData } = useLoad(() => api<Branding>('GET', '/api/v1/branding'));
  const [edit, setEdit] = useState<Partial<Form>>({});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [askReset, setAskReset] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <LoadError error={error} retry={reload} />;
  const cur = data!;
  const base: Form = { productName: cur.productName, primary: cur.theme.primary, mode: cur.theme.mode, sidebar: cur.theme.sidebar ?? null };
  const v: Form = { ...base, ...edit };
  const dirty = Object.keys(edit).length > 0;

  // Pré-visualização local; o contraste é conferido de novo pela API ao salvar.
  const built = HEX.test(v.primary) && (!v.sidebar || HEX.test(v.sidebar)) ? buildTheme(v) : null;
  const problems = built && 'problems' in built ? built.problems : [];
  const shown: Branding = built && 'theme' in built
    ? { ...cur, productName: v.productName, customized: true, theme: built.theme }
    : cur;
  const fieldErr = (f: string) => problems.find((p) => p.field === f)?.message ?? err?.fieldError(f);

  function apply(b: Branding, message: string) {
    setData(b);
    setEdit({});
    setBranding(b);
    setMsg(message);
    setErr(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!HEX.test(v.primary)) {
      setErr(new ApiError(422, 'validation', 'Ajuste as cores.', [{ field: 'primary', message: 'Use uma cor no formato #RRGGBB.' }]));
      return;
    }
    if (problems.length) return;
    setSaving(true);
    setMsg(null);
    try {
      apply(await api<Branding>('PUT', '/api/v1/branding', v), 'Identidade visual salva. Ela já vale para todos da empresa.');
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível salvar.'));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setResetting(true);
    try {
      apply(await api<Branding>('POST', '/api/v1/branding/reset'), 'Tema padrão restaurado.');
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : new ApiError(0, 'error', 'Não foi possível restaurar.'));
    } finally {
      setResetting(false);
      setAskReset(false);
    }
  }

  const activePalette = PALETTES.find((p) => p.primary === v.primary.toUpperCase() && p.sidebar === (v.sidebar ?? '').toUpperCase() && p.mode === v.mode);

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Modelos de cores" description="Comece por um modelo e ajuste a cor, se quiser. Nada muda até você salvar.">
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PALETTES.map((p) => {
            const on = activePalette?.key === p.key;
            return (
              <li key={p.key}>
                <button type="button" aria-pressed={on} onClick={() => { setEdit({ ...edit, primary: p.primary, sidebar: p.sidebar, mode: p.mode }); setMsg(null); }}
                  className={`flex w-full flex-col gap-2.5 rounded-[8px] border p-3 text-left hover:bg-surface-2 ${on ? 'border-primary ring-2 ring-primary/30' : 'border-line'}`}>
                  <span className="flex h-12 overflow-hidden rounded-[6px] border border-line" aria-hidden>
                    <span className="w-1/3" style={{ background: p.sidebar }} />
                    <span className="flex flex-1 items-center justify-center" style={{ background: p.mode === 'dark' ? '#111827' : '#F8FAFC' }}>
                      <span className="h-4 w-12 rounded-[4px]" style={{ background: p.primary }} />
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 font-semibold">{p.name}{on ? <Check size={15} aria-hidden className="text-primary" /> : null}</span>
                  <span className="text-[13px] text-muted">{p.description}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <Panel title="Identidade visual" description="Nome do produto, cores e tema que todos da empresa veem, inclusive na tela de login do domínio próprio.">
          <form onSubmit={save} noValidate className="flex max-w-md flex-col gap-4">
            {msg ? <Alert tone="success">{msg}</Alert> : null}
            {err && !err.errors.length ? <Alert tone="error">{err.title}</Alert> : null}
            <Field label="Nome exibido do produto" value={v.productName} maxLength={80}
              onChange={(e) => setEdit({ ...edit, productName: e.target.value })} error={err?.fieldError('productName')} />
            <ColorInput id="primary" label="Cor da marca" value={v.primary} error={fieldErr('primary')}
              hint="Botões e destaques. O sistema escolhe a cor do texto sobre ela e recusa cores sem contraste suficiente."
              onChange={(c) => setEdit({ ...edit, primary: c })} />
            <div className="flex flex-col gap-2">
              <label className="flex min-h-11 items-center gap-2.5">
                <input type="checkbox" checked={v.sidebar !== null} className="size-[18px] accent-[var(--primary)]"
                  onChange={(e) => setEdit({ ...edit, sidebar: e.target.checked ? '#0F172A' : null })} />
                Escolher a cor do menu lateral
              </label>
              {v.sidebar !== null ? (
                <ColorInput id="sidebar" label="Cor do menu lateral" value={v.sidebar} error={fieldErr('sidebar')}
                  hint="Precisa ser escura: o texto do menu é claro. Também é o fundo do painel da tela de login."
                  onChange={(c) => setEdit({ ...edit, sidebar: c })} />
              ) : <p className="text-[13px] text-muted">Sem escolha: menu azul-marinho no tema padrão e grafite com cores próprias.</p>}
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[13px] font-medium">Tema</legend>
              {(['light', 'dark'] as const).map((m) => (
                <label key={m} className="flex min-h-11 items-center gap-2.5">
                  <input type="radio" name="modo" checked={v.mode === m} onChange={() => setEdit({ ...edit, mode: m })}
                    className="size-[18px] accent-[var(--primary)]" />
                  {m === 'light' ? 'Claro' : 'Escuro'}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={saving} disabled={!dirty || problems.length > 0}>Salvar</Button>
              {dirty ? <Button type="button" variant="ghost" onClick={() => { setEdit({}); setErr(null); }}>Descartar</Button> : null}
              {cur.customized ? <Button type="button" variant="secondary" onClick={() => setAskReset(true)}>Restaurar padrão</Button> : null}
            </div>
          </form>
        </Panel>

        <Panel title="Pré-visualização">
          <ThemePreview branding={shown} />
        </Panel>
      </div>

      <Panel title="Logotipo e ícone" description="PNG, JPG ou WebP, até 2 MB. Valem no menu, na tela de login e na aba do navegador.">
        <div className="grid gap-5 md:grid-cols-2">
          <AssetSlot kind="logo" label="Logotipo" url={cur.logoUrl ?? null} side={shown.theme.sidebar ?? (cur.customized ? '#101828' : '#051628')}
            hint="Aparece sobre a cor do menu lateral: prefira a versão clara (ou com fundo transparente) do logotipo, na horizontal."
            onDone={(b, m) => apply(b, m)} onError={setErr} />
          <AssetSlot kind="icon" label="Ícone (favicon)" url={cur.iconUrl ?? null} side="#FFFFFF"
            hint="Quadrado, de preferência 512 × 512. Aparece na aba do navegador e na tela de login do celular."
            onDone={(b, m) => apply(b, m)} onError={setErr} />
        </div>
      </Panel>

      <Confirm open={askReset} title="Restaurar o tema padrão?" confirmLabel="Restaurar" danger={false} loading={resetting}
        onConfirm={reset} onCancel={() => setAskReset(false)}>
        O nome do produto e as cores voltam ao padrão para todos da empresa. O logotipo e o ícone continuam; remova-os abaixo, se quiser.
      </Confirm>
    </div>
  );
}

function ColorInput({ id, label, value, hint, error, onChange }: {
  id: string; label: string; value: string; hint: string; error?: string; onChange: (c: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium" id={`${id}-label`}>{label}</span>
      <div className="flex items-center gap-3">
        <input type="color" aria-labelledby={`${id}-label`} value={HEX.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-11 w-14 cursor-pointer rounded-[6px] border border-line-strong bg-surface p-1" />
        <input aria-label={`${label} em hexadecimal`} value={value} maxLength={7}
          onChange={(e) => onChange(e.target.value)}
          className={`h-11 w-32 rounded-[6px] border bg-surface px-3 font-mono text-sm ${error ? 'border-bad' : 'border-line-strong'}`} />
      </div>
      {error ? <p className="text-[13px] text-bad">{error}</p> : <p className="text-[13px] text-muted">{hint}</p>}
    </div>
  );
}

function AssetSlot({ kind, label, url, hint, side, onDone, onError }: {
  kind: 'logo' | 'icon'; label: string; url: string | null; hint: string; side: string;
  onDone: (b: Branding, msg: string) => void; onError: (e: ApiError) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setBusy(true);
    try {
      onDone(await apiUpload<Branding>(`/api/v1/branding/${kind}`, file), `${label} atualizado.`);
    } catch (e) {
      onError(e instanceof ApiError ? new ApiError(e.status, e.type, e.fieldError('file') ?? e.title) : new ApiError(0, 'error', 'Não foi possível enviar.'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function remove() {
    setBusy(true);
    try {
      onDone(await api<Branding>('DELETE', `/api/v1/branding/${kind}`), `${label} removido.`);
    } catch (e) {
      onError(e instanceof ApiError ? e : new ApiError(0, 'error', 'Não foi possível remover.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="font-medium">{label}</p>
      <div className="flex h-24 items-center justify-center rounded-[8px] border border-line px-4" style={{ background: side }}>
        {url ? <img src={url} alt={`${label} atual`} className={kind === 'logo' ? 'max-h-16 max-w-full object-contain' : 'size-14 object-contain'} />
          : <span className={`text-[13px] ${side === '#FFFFFF' ? 'text-muted' : 'text-white/70'}`}>Nenhum enviado</span>}
      </div>
      <p className="text-[13px] text-muted">{hint}</p>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label={`Arquivo do ${label.toLowerCase()}`}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
          <ImageUp size={16} aria-hidden />{url ? 'Trocar' : 'Enviar'}
        </Button>
        {url ? <Button type="button" variant="ghost" disabled={busy} onClick={remove}><Trash2 size={16} aria-hidden />Remover</Button> : null}
      </div>
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
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="" className="mb-1 h-6 max-w-full object-contain object-left" />
            : <div className="mb-1 truncate text-[12px] font-semibold text-white">{branding.productName}</div>}
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
