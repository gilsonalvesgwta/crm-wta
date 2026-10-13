'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { money, moneyInput, parseMoney, type Product } from '@/lib/crm';
import { useProducts } from '@/components/crm/data';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Dialog } from '@/components/ui/dialog';
import { Empty, LoadError, Loading } from '@/components/ui/states';

export default function ProductsSettings() {
  const list = useLoad(() => api<Product[]>('GET', '/api/v1/products?includeInactive=true'));
  const { refresh } = useProducts();
  const [dialog, setDialog] = useState<Product | 'new' | null>(null);
  useEffect(() => { void refresh(); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Panel title="Produtos e serviços" description="Usados nos itens dos negócios. Mudar o preço não altera negócios já criados."
      actions={<Button onClick={() => setDialog('new')}><Plus size={16} aria-hidden />Novo produto</Button>}>
      {list.error ? <LoadError error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : !list.data.length ? <Empty title="Nenhum produto">Cadastre o que a empresa vende.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead><tr className="border-b border-line text-[12px] text-muted"><th scope="col" className="py-2 pr-3 font-medium">Nome</th><th scope="col" className="py-2 pr-3 font-medium">Código</th><th scope="col" className="py-2 pr-3 text-right font-medium">Preço</th><th scope="col" className="py-2 font-medium"><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="py-2.5 pr-3"><span className={p.active ? 'font-medium' : 'text-muted'}>{p.name}</span> {!p.active ? <Badge>Inativo</Badge> : null}</td>
                  <td className="py-2.5 pr-3 font-mono text-[13px]">{p.sku ?? ''}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{money(p.priceCents, p.currency)}</td>
                  <td className="py-2.5 text-right"><Button variant="ghost" onClick={() => setDialog(p)}>Editar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={!!dialog} onClose={() => setDialog(null)} title={dialog === 'new' ? 'Novo produto' : 'Editar produto'}>
        {dialog ? <ProductForm product={dialog === 'new' ? null : dialog} onDone={() => { setDialog(null); void list.reload(); }} onCancel={() => setDialog(null)} /> : null}
      </Dialog>
    </Panel>
  );
}

function ProductForm({ product, onDone, onCancel }: { product: Product | null; onDone: () => void; onCancel: () => void }) {
  const [v, setV] = useState({ name: product?.name ?? '', sku: product?.sku ?? '', price: moneyInput(product?.priceCents ?? null), description: product?.description ?? '' });
  const [active, setActive] = useState(product?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const price = parseMoney(v.price || '0');
    if (price === null) { setErr(new ApiError(422, 'validation', 'Preço inválido.', [{ field: 'priceCents', message: 'Preço inválido.' }])); return; }
    setBusy(true);
    setErr(null);
    const body = { name: v.name, sku: v.sku || null, description: v.description || null, priceCents: price, active };
    try {
      if (product) await api('PATCH', `/api/v1/products/${product.id}`, body); else await api('POST', '/api/v1/products', body);
      onDone();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2 : null);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {err ? <Alert tone="error">{err.title}</Alert> : null}
      <Field label="Nome" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Código (SKU)" value={v.sku} onChange={(e) => setV({ ...v, sku: e.target.value })} error={err?.fieldError('sku')} />
        <Field label="Preço (R$)" inputMode="decimal" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} error={err?.fieldError('priceCents')} />
      </div>
      <Textarea label="Descrição" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      {product ? <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={active} onChange={(e) => setActive(e.target.checked)} />Ativo (aparece para escolher nos negócios)</label> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button><Button type="submit" loading={busy} disabled={!v.name.trim()}>Salvar</Button></div>
    </form>
  );
}
