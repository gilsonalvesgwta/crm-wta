import type { ReactNode } from 'react';

const points = [
  'Uma caixa de entrada para WhatsApp, Instagram e e-mail',
  'Funis, tarefas e agenda do time comercial',
  'Mensagens agendadas e automações ligadas ao n8n',
];

/** Moldura das telas de acesso: painel da marca à esquerda, formulário à direita. */
export function AuthShell({ eyebrow = 'CRM WTA', title, subtitle, children }: {
  eyebrow?: string; title: string; subtitle?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-wrap">
      <aside className="flex min-w-0 flex-[1_1_480px] flex-col justify-between gap-12 bg-[#051628] px-8 py-10 text-white sm:px-16 sm:py-14 max-md:hidden">
        <img src="/brand/wta-logo-escuro.svg" alt="WTA Gestão e Automações" width={300} height={102} className="h-auto w-[300px]" />
        <div className="flex max-w-[460px] flex-col gap-7">
          <p className="text-[34px] font-semibold leading-[1.15] tracking-[-0.02em]">Vendas, atendimento e automações no mesmo lugar.</p>
          <ul className="flex flex-col gap-3.5 text-[15px] text-[#B9C6D8]">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF6600" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-px shrink-0"><path d="M20 6 9 17l-5-5" /></svg>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[13px] text-[#B9C6D8]">WTA Gestão e Automações</p>
      </aside>
      <main className="flex min-w-0 flex-[1_1_480px] items-center justify-center bg-surface px-6 py-14">
        <div className="flex w-full max-w-[380px] flex-col gap-7">
          <img src="/brand/wta-marca.svg" alt="WTA" width={96} height={22} className="h-[22px] w-auto self-start md:hidden" />
          <div className="flex flex-col gap-1.5">
            <p className="text-[13px] font-medium text-muted">{eyebrow}</p>
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
            {subtitle ? <div className="text-muted">{subtitle}</div> : null}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
