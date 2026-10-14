'use client';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Entity = 'contacts' | 'organizations';

/** Planilhas modelo: cabeçalhos que o CRM reconhece sozinho e duas linhas de exemplo. */
const TEMPLATES: Record<Entity, { file: string; headers: string[]; rows: string[][]; tips: string[] }> = {
  contacts: {
    file: 'modelo-contatos.csv',
    headers: ['Primeiro nome', 'Sobrenome', 'E-mail', 'Telefone', 'Cargo', 'Empresa', 'Aniversário', 'Etiquetas', 'Responsável', 'Origem', 'Cidade', 'UF'],
    rows: [
      ['Maria', 'Souza', 'maria@exemplo.com.br', '(11) 98765-4321', 'Gerente de compras', 'Souza Comércio', '15/03', 'Cliente, VIP', '', 'site', 'São Paulo', 'SP'],
      ['João', 'Pereira', 'joao@exemplo.com.br', '(21) 99876-5432', '', '', '02/11/1985', 'Lead', '', 'instagram', 'Rio de Janeiro', 'RJ'],
    ],
    tips: [
      'A primeira linha é o cabeçalho, com os nomes das colunas como no modelo.',
      'Cada contato precisa de nome; e-mail e telefone ajudam a achar quem já está cadastrado.',
      'Telefone com DDD. Aniversário como 15/03 ou 15/03/1990.',
      'Várias etiquetas na mesma célula, separadas por vírgula.',
      'Responsável: o e-mail de quem usa o CRM. Em branco, fica com quem importa.',
      'Colunas a mais podem ser ligadas aos campos personalizados no passo seguinte.',
    ],
  },
  organizations: {
    file: 'modelo-organizacoes.csv',
    headers: ['Nome', 'Razão social', 'CNPJ', 'Site', 'E-mail', 'Telefone', 'Segmento', 'Etiquetas', 'Cidade', 'UF'],
    rows: [
      ['Souza Comércio', 'Souza Comércio de Alimentos Ltda', '12.345.678/0001-90', 'souza.com.br', 'contato@souza.com.br', '(11) 3333-4444', 'Varejo', 'Cliente', 'São Paulo', 'SP'],
      ['Padaria Sol', '', '', '', '', '(31) 3222-1111', 'Alimentação', 'Lead', 'Belo Horizonte', 'MG'],
    ],
    tips: [
      'A primeira linha é o cabeçalho, com os nomes das colunas como no modelo.',
      'Cada organização precisa de nome; o CNPJ ajuda a achar as já cadastradas.',
      'Várias etiquetas na mesma célula, separadas por vírgula.',
    ],
  },
};

function cell(v: string): string {
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV com ponto e vírgula e marca UTF-8: o Excel em português abre com os acentos certos. */
export function templateCsv(entity: Entity): string {
  const t = TEMPLATES[entity];
  return '﻿' + [t.headers, ...t.rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

export function ImportTemplate({ entity }: { entity: Entity }) {
  const t = TEMPLATES[entity];
  function download() {
    const url = URL.createObjectURL(new Blob([templateCsv(entity)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = t.file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const cols = t.headers.map((_, i) => String.fromCharCode(65 + i));
  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">Planilha modelo</p>
          <p className="text-[13px] text-muted">Baixe, abra no Excel ou no Google Planilhas, preencha e salve como CSV.</p>
        </div>
        <Button variant="secondary" onClick={download}><Download size={16} aria-hidden />Baixar planilha modelo</Button>
      </div>
      <figure className="flex flex-col gap-2">
        {/* Rolável pelo teclado: a tabela é mais larga que a tela no celular. */}
        <div className="overflow-x-auto rounded-[6px] border border-line-strong bg-surface" tabIndex={0} role="region" aria-label="Planilha de exemplo">
          <table className="min-w-max border-collapse text-[12px]">
            <caption className="sr-only">Exemplo de como preencher a planilha</caption>
            <thead>
              <tr className="bg-surface-2 text-muted">
                <th scope="col" className="w-8 border-b border-r border-line px-2 py-1 font-normal"><span className="sr-only">Linha</span></th>
                {cols.map((c) => <th key={c} scope="col" className="border-b border-r border-line px-2 py-1 text-center font-normal">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr className="bg-accent-soft">
                <th scope="row" className="border-r border-line px-2 py-1 text-center font-normal text-muted">1</th>
                {t.headers.map((h) => <td key={h} className="whitespace-nowrap border-b border-r border-line px-2 py-1 font-semibold">{h}</td>)}
              </tr>
              {t.rows.map((r, i) => (
                <tr key={i}>
                  <th scope="row" className="border-r border-line px-2 py-1 text-center font-normal text-muted">{i + 2}</th>
                  {r.map((v, j) => <td key={j} className="whitespace-nowrap border-b border-r border-line px-2 py-1">{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <figcaption className="text-[12px] text-muted">A linha 1 (destacada) é o cabeçalho; cada linha abaixo é um cadastro.</figcaption>
      </figure>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted">
        {t.tips.map((x) => <li key={x}>{x}</li>)}
      </ul>
    </div>
  );
}
