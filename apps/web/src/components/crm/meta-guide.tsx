'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Lightbulb, X } from 'lucide-react';

export type GuideKind = 'whatsapp' | 'instagram';

/** Data da última conferência do passo a passo com a documentação da Meta. */
export const GUIDE_UPDATED = 'outubro de 2026';

const DOCS = {
  whatsapp: [
    { href: 'https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started', label: 'Começar com a Cloud API (Meta)' },
    { href: 'https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration', label: 'Registrar o número (Meta)' },
    { href: 'https://developers.facebook.com/docs/whatsapp/pricing', label: 'Preços do WhatsApp (Meta)' },
  ],
  instagram: [
    { href: 'https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login', label: 'API do Instagram com login do Instagram (Meta)' },
    { href: 'https://developers.facebook.com/documentation/instagram-platform/webhooks', label: 'Avisos (webhooks) do Instagram (Meta)' },
    { href: 'https://developers.facebook.com/documentation/instagram-platform/app-review', label: 'Análise do app (Meta)' },
  ],
};

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-accent underline underline-offset-2">
      {children}<ExternalLink size={12} aria-hidden /><span className="sr-only"> (abre em nova aba)</span>
    </a>
  );
}

/** Nome do menu na Meta: em português, com o nome em inglês entre parênteses (o painel muda de idioma). */
function M({ pt, en }: { pt: string; en?: string }) {
  return <><strong>{pt}</strong>{en ? <span className="text-muted"> ({en})</span> : null}</>;
}

function Note({ tone, children }: { tone: 'tip' | 'warn' | 'crm' | 'info'; children: ReactNode }) {
  const s = {
    tip: { icon: <Lightbulb size={16} aria-hidden />, cls: 'border-line bg-surface-2', label: 'Dica' },
    warn: { icon: <AlertTriangle size={16} aria-hidden />, cls: 'border-warn/40 bg-warn-soft', label: 'Atenção' },
    crm: { icon: <CheckCircle2 size={16} aria-hidden />, cls: 'border-accent/30 bg-accent-soft', label: 'No CRM' },
    info: { icon: <Info size={16} aria-hidden />, cls: 'border-info/30 bg-info-soft', label: 'Por quê' },
  }[tone];
  return (
    <div className={`flex gap-2 rounded-[8px] border px-3 py-2 text-[13px] leading-relaxed ${s.cls}`}>
      <span className="mt-0.5 shrink-0">{s.icon}</span>
      <div><span className="font-semibold">{s.label}: </span>{children}</div>
    </div>
  );
}

/** Um passo, com caixa "feito" lembrada neste navegador. */
function Step({ id, n, title, time, children }: { id: string; n: number; title: string; time?: string; children: ReactNode }) {
  const key = `guia-meta:${id}`;
  const [done, setDone] = useState(false);
  useEffect(() => {
    try { setDone(localStorage.getItem(key) === '1'); } catch { /* sem armazenamento: só não lembra */ }
  }, [key]);
  function toggle(v: boolean) {
    setDone(v);
    try { if (v) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* idem */ }
  }
  return (
    <section aria-labelledby={`${id}-t`} className={`flex flex-col gap-3 rounded-[12px] border p-4 ${done ? 'border-ok/40 bg-ok-soft/30' : 'border-line bg-surface'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`${id}-t`} className="flex items-start gap-2.5 text-[15px] font-semibold leading-snug">
          <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] ${done ? 'bg-ok text-white' : 'bg-primary text-primary-fg'}`}>{done ? '✓' : n}</span>
          <span className="pt-0.5">{title}</span>
        </h3>
        <div className="flex items-center gap-3">
          {time ? <span className="text-[12px] text-muted">{time}</span> : null}
          <label className="flex min-h-8 items-center gap-1.5 text-[13px]">
            <input type="checkbox" checked={done} onChange={(e) => toggle(e.target.checked)} className="size-4 accent-[var(--primary)]" />Feito
          </label>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 pl-0 text-sm leading-relaxed sm:pl-9">{children}</div>
    </section>
  );
}

const Ol = ({ children }: { children: ReactNode }) => <ol className="flex list-decimal flex-col gap-1.5 pl-5">{children}</ol>;
const Ul = ({ children }: { children: ReactNode }) => <ul className="flex list-disc flex-col gap-1.5 pl-5">{children}</ul>;

function Trouble({ items }: { items: [string, ReactNode][] }) {
  return (
    <section aria-labelledby="problemas" className="flex flex-col gap-2">
      <h3 id="problemas" className="text-[15px] font-semibold">Problemas comuns e como resolver</h3>
      {items.map(([q, a]) => (
        <details key={q} className="rounded-[8px] border border-line bg-surface px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">{q}</summary>
          <div className="mt-2 flex flex-col gap-1.5 leading-relaxed text-ink">{a}</div>
        </details>
      ))}
    </section>
  );
}

function Header({ kind }: { kind: GuideKind }) {
  return (
    <div className="flex flex-col gap-2 text-[13px] text-muted">
      <p>Conferido com a documentação oficial da Meta em {GUIDE_UPDATED}. A Meta muda o painel com frequência: se um botão estiver com outro nome, procure pelo nome em inglês entre parênteses.</p>
      <p className="flex flex-wrap gap-x-3 gap-y-1">{DOCS[kind].map((d) => <Ext key={d.href} href={d.href}>{d.label}</Ext>)}</p>
    </div>
  );
}

export function WhatsAppGuide() {
  return (
    <div className="flex flex-col gap-4">
      <Header kind="whatsapp" />
      <section aria-labelledby="wa-antes" className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface-2 p-4 text-sm">
        <h3 id="wa-antes" className="text-[15px] font-semibold">Antes de começar (tempo total: 30 a 45 minutos)</h3>
        <Ul>
          <li>Um perfil do Facebook que seja <strong>administrador do portfólio empresarial</strong> da sua empresa na Meta (o antigo Gerenciador de Negócios).</li>
          <li>Um <strong>número de telefone que não esteja em uso no WhatsApp</strong> (nem no aplicativo comum, nem no WhatsApp Business do celular) e que receba SMS ou ligação para o código.</li>
          <li>Uma <strong>forma de pagamento</strong> para a Meta: as mensagens com modelo (iniciar conversa, campanhas) são cobradas por ela, não pelo CRM.</li>
          <li>O endereço de uma página de <strong>política de privacidade</strong> da sua empresa (a Meta pede para publicar o app).</li>
          <li>Acesso de administrador a este CRM (Configurações › Canais).</li>
        </Ul>
        <Note tone="warn">Se o número já está no WhatsApp do celular, ele precisa sair de lá antes (no celular: Configurações › Conta › Apagar conta). Faça o backup das conversas antes. Usar o mesmo número no celular e na API ao mesmo tempo (coexistência) só é possível por um parceiro oficial da Meta e não está disponível aqui.</Note>
      </section>

      <Step id="wa-1" n={1} title="Criar o app na Meta" time="5 min">
        <Ol>
          <li>Abra <Ext href="https://developers.facebook.com/apps">developers.facebook.com/apps</Ext> e entre com o Facebook. Se for a primeira vez, aceite os termos para virar desenvolvedor.</li>
          <li>Clique em <M pt="Criar app" en="Create App" />. Dê um nome (ex.: <em>CRM Sua Empresa</em>) e o e-mail de contato.</li>
          <li>Em <M pt="Casos de uso" en="Use cases" />, escolha <M pt="Conectar-se com clientes pelo WhatsApp" en="Connect with customers through WhatsApp" /> e avance.</li>
          <li>Escolha o <M pt="portfólio empresarial" en="Business portfolio" /> da sua empresa.</li>
          <li>Avance pelos requisitos e clique em <M pt="Criar app" en="Create app" />. Você cai em <M pt="Personalizar caso de uso › Conectar no WhatsApp › Início rápido" en="Customize use case › Connect on WhatsApp › Quickstart" />.</li>
        </Ol>
      </Step>

      <Step id="wa-2" n={2} title="Ligar a conta do WhatsApp Business e adicionar o número real" time="10 min">
        <Ol>
          <li>No Início rápido, clique em <M pt="Começar a usar a API" en="Start using the API" />. Abre a tela <M pt="Configuração da API" en="API Setup" />.</li>
          <li>Escolha a <M pt="conta do WhatsApp Business" en="WhatsApp Business account" /> da empresa ou clique para criar uma.</li>
          <li>Clique em <M pt="Adicionar número de telefone" en="Add phone number" />. Preencha o <strong>nome de exibição</strong> (é o nome que o cliente vê; precisa ter relação com a sua marca), a categoria e o número.</li>
          <li>Confirme com o código recebido por SMS ou ligação.</li>
        </Ol>
        <Note tone="tip">A Meta mostra também um número de teste. Ele só manda para até 5 números cadastrados e serve para experimentar; para atender clientes, use o número real.</Note>
      </Step>

      <Step id="wa-3" n={3} title="Copiar os dois IDs" time="2 min">
        <p>Ainda em <M pt="Configuração da API" en="API Setup" />, selecione o número real no campo <M pt="De" en="From" /> e copie:</p>
        <Ul>
          <li><M pt="Identificação do número de telefone" en="Phone number ID" />: só números, uns 15 dígitos.</li>
          <li><M pt="Identificação da conta do WhatsApp Business" en="WhatsApp Business Account ID" />: também só números.</li>
        </Ul>
        <Note tone="crm">vão nos campos <strong>ID do número de telefone</strong> e <strong>ID da conta do WhatsApp Business</strong>.</Note>
        <Note tone="warn">Não é o número de telefone em si, nem o ID do app (que aparece no topo da página).</Note>
      </Step>

      <Step id="wa-4" n={4} title="Copiar a chave secreta do app" time="1 min">
        <Ol>
          <li>No menu do app, abra <M pt="Configurações do app › Básico" en="App settings › Basic" />.</li>
          <li>Em <M pt="Chave secreta do app" en="App secret" />, clique em <M pt="Mostrar" en="Show" /> (pede a senha do Facebook) e copie.</li>
        </Ol>
        <Note tone="crm">vai no campo <strong>Chave secreta do app</strong>. Com ela o CRM confere que cada aviso veio mesmo da Meta.</Note>
      </Step>

      <Step id="wa-5" n={5} title="Gerar o token permanente (usuário do sistema)" time="5 min">
        <Ol>
          <li>Abra <Ext href="https://business.facebook.com/settings">business.facebook.com/settings</Ext> (<M pt="Configurações do negócio" en="Business settings" />) e confira, no topo, se está no portfólio da empresa.</li>
          <li>Vá em <M pt="Usuários › Usuários do sistema" en="Users › System users" /> e clique em <M pt="Adicionar" en="Add" />. Nome: <em>crm-whatsapp</em>; função: <M pt="Administrador" en="Admin" />.</li>
          <li>Com o usuário selecionado, clique em <M pt="Atribuir ativos" en="Assign assets" />:
            <Ul>
              <li><M pt="Apps" en="Apps" /> › o seu app › ligue <M pt="Controle total" en="Full control" />.</li>
              <li><M pt="Contas do WhatsApp" en="WhatsApp accounts" /> › a conta da empresa › ligue <M pt="Controle total" en="Full control" />.</li>
            </Ul>
          </li>
          <li>Clique em <M pt="Gerar token" en="Generate token" />, escolha o seu app e, em validade, <M pt="Nunca" en="Never" />.</li>
          <li>Marque as permissões <code>business_management</code>, <code>whatsapp_business_management</code> e <code>whatsapp_business_messaging</code>. Gere e <strong>copie na hora</strong>: ele aparece uma vez só.</li>
        </Ol>
        <Note tone="crm">vai no campo <strong>Token de acesso permanente</strong>. Fica cifrado e não aparece de novo.</Note>
        <Note tone="warn">Não use o token da tela Configuração da API: ele vence em cerca de 24 horas. Esquecer de atribuir a conta do WhatsApp ao usuário do sistema é o erro mais comum.</Note>
      </Step>

      <Step id="wa-6" n={6} title="Definir o PIN de 6 dígitos" time="2 min">
        <Note tone="info">a Meta só aceita mensagens de um número depois que ele é <strong>registrado na API com um PIN de 6 dígitos</strong> (o da verificação em duas etapas), e isso só pode ser feito pela API. O CRM faz o registro para você com o PIN que você informar.</Note>
        <Ul>
          <li>Se o número <strong>já tem</strong> verificação em duas etapas: use o PIN que já existe. Se não lembra, troque em <M pt="Gerenciador do WhatsApp › Telefones › o número › Configurações › Verificação em duas etapas" en="WhatsApp Manager › Phone numbers › Settings › Two-step verification" />.</li>
          <li>Se <strong>não tem</strong>: escolha 6 números agora. Eles passam a ser o PIN. Anote em lugar seguro.</li>
        </Ul>
        <Note tone="crm">vai no campo <strong>PIN (6 dígitos)</strong>. Só precisa na primeira vez, ou depois de a Meta aprovar uma troca do nome de exibição.</Note>
        <Note tone="warn">A Meta permite até 10 tentativas de registro a cada 72 horas por número.</Note>
      </Step>

      <Step id="wa-7" n={7} title="Cadastrar no CRM" time="2 min">
        <Ol>
          <li>Aqui no CRM: <M pt="Configurações › Canais › WhatsApp oficial › Adicionar número oficial" />.</li>
          <li>Preencha nome (para a equipe), os dois IDs, o token, a chave secreta e o PIN. Clique em <strong>Salvar e conferir</strong>.</li>
        </Ol>
        <p>O CRM confere o número na Meta, liga o app à conta do WhatsApp Business (para os avisos chegarem) e registra o número com o PIN. O resultado esperado é a conta como <strong>Conectada</strong>, com o número e o nome verificado.</p>
      </Step>

      <Step id="wa-8" n={8} title="Configurar os avisos (webhook)" time="3 min">
        <Ol>
          <li>No CRM, na conta cadastrada, abra <strong>Configurar os avisos na Meta</strong> e copie a <strong>URL de retorno</strong> e o <strong>token de verificação</strong>.</li>
          <li>No app da Meta, abra <M pt="WhatsApp › Configuração" en="WhatsApp › Configuration" /> (ou <M pt="Casos de uso › Personalizar › Configuração" en="Use cases › Customize › Configuration" />).</li>
          <li>Em <M pt="Webhook" en="Webhook" />, clique em <M pt="Editar" en="Edit" />, cole os dois valores e clique em <M pt="Verificar e salvar" en="Verify and save" />.</li>
          <li>Em <M pt="Campos do webhook" en="Webhook fields" />, assine (<M pt="Assinar" en="Subscribe" />) <code>messages</code> e <code>message_template_status_update</code>.</li>
        </Ol>
        <Note tone="tip">Se a verificação falhar, confira se copiou sem espaços e se o CRM está no ar pelo endereço com https.</Note>
      </Step>

      <Step id="wa-9" n={9} title="Publicar o app" time="5 min">
        <Ol>
          <li>Em <M pt="Configurações do app › Básico" en="App settings › Basic" />, preencha a <M pt="URL da Política de Privacidade" en="Privacy Policy URL" />, a categoria e o ícone. Salve.</li>
          <li>No menu da esquerda, clique em <M pt="Publicar" en="Publish" /> e confirme (em painéis antigos, mude o seletor de modo para <M pt="Ao vivo" en="Live" />).</li>
        </Ol>
        <Note tone="warn">Sem publicar, a Meta não envia ao CRM os avisos das mensagens de clientes.</Note>
      </Step>

      <Step id="wa-10" n={10} title="Testar" time="5 min">
        <Ol>
          <li>Do seu celular, mande uma mensagem para o número oficial. Ela aparece em <strong>Conversas › WhatsApp</strong> em segundos.</li>
          <li>Responda pelo CRM e confira no celular.</li>
          <li>Em <strong>Configurações › Canais › Modelos</strong>, crie um modelo da categoria Utilidade e espere ficar <strong>Aprovado</strong> (minutos a algumas horas).</li>
          <li>Use o modelo para iniciar conversa com um contato que nunca escreveu.</li>
        </Ol>
      </Step>

      <section aria-labelledby="wa-regras" className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface-2 p-4 text-sm">
        <h3 id="wa-regras" className="text-[15px] font-semibold">Regras da Meta que valem no dia a dia</h3>
        <Ul>
          <li><strong>24 horas:</strong> texto livre e arquivos só até 24 h depois da última mensagem do cliente. Fora disso (ou com quem nunca escreveu), só <strong>modelo aprovado</strong>; o CRM abre os modelos sozinho.</li>
          <li><strong>Custos:</strong> a Meta cobra por modelo enviado (marketing, utilidade, autenticação). Respostas dentro das 24 h são gratuitas. Veja os valores em <Ext href="https://developers.facebook.com/docs/whatsapp/pricing">preços do WhatsApp</Ext>.</li>
          <li><strong>Limite de envio:</strong> contas novas começam com um limite diário de conversas iniciadas pela empresa; ele sobe com a verificação da empresa na Meta e com boa qualidade.</li>
          <li><strong>Qualidade:</strong> bloqueios e denúncias derrubam a qualidade e o limite. Mande só para quem aceitou receber; o CRM respeita quem pediu para sair.</li>
          <li><strong>Campanhas</strong> por número oficial saem só com modelo aprovado.</li>
        </Ul>
      </section>

      <Trouble items={[
        ['"O token de acesso é inválido ou venceu"', <p key="a">Gere um token do <strong>usuário do sistema</strong> com validade <strong>Nunca</strong> (passo 5) e salve na conta em <strong>Editar</strong>. O token da tela Configuração da API vence em 24 h.</p>],
        ['"O token não tem permissão para esta ação"', <p key="a">Faltam as três permissões do passo 5, ou a conta do WhatsApp não foi atribuída ao usuário do sistema com controle total. Corrija e gere um token novo.</p>],
        ['As mensagens dos clientes não aparecem no CRM', <Ul key="a">
          <li>O webhook foi verificado e o campo <code>messages</code> está assinado (passo 8)?</li>
          <li>O app está publicado (passo 9)?</li>
          <li>Clique em <strong>Conferir</strong> na conta: o CRM liga de novo o app à conta do WhatsApp Business.</li>
          <li>A URL colada na Meta é a desta conta (cada conta tem a sua)?</li>
        </Ul>],
        ['"O número não foi registrado na API"', <p key="a">O PIN não confere com o da verificação em duas etapas. Troque o PIN no Gerenciador do WhatsApp (passo 6) e salve de novo com o PIN novo. Lembre do limite de 10 tentativas em 72 h.</p>],
        ['"Passaram 24 horas da última mensagem do cliente"', <p key="a">É regra da Meta. Escolha um modelo aprovado no botão <strong>Modelo</strong> da caixa de mensagem.</p>],
        ['Modelo recusado', <p key="a">O motivo aparece na lista de modelos. Os mais comuns: texto começando ou terminando com variável, conteúdo promocional na categoria Utilidade, links encurtados e variáveis sem exemplo. Ajuste e crie de novo com outro nome.</p>],
        ['"Verificar e salvar" falha na Meta', <p key="a">Copie a URL e o token de novo pelo botão Copiar do CRM. O CRM precisa estar no ar com https no endereço público.</p>],
      ]} />
    </div>
  );
}

export function InstagramGuide() {
  return (
    <div className="flex flex-col gap-4">
      <Header kind="instagram" />
      <section aria-labelledby="ig-antes" className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface-2 p-4 text-sm">
        <h3 id="ig-antes" className="text-[15px] font-semibold">Antes de começar (tempo total: 20 a 30 minutos)</h3>
        <Ul>
          <li>Uma conta do Instagram <strong>profissional</strong> (Empresa ou Criador de conteúdo). No app: <M pt="Configurações › Tipo de conta e ferramentas › Mudar para conta profissional" en="Account type and tools › Switch to professional account" />.</li>
          <li>No app do Instagram, ligue <M pt="Configurações › Mensagens e respostas aos stories › Ferramentas conectadas › Permitir acesso às mensagens" en="Messages and story replies › Connected tools › Allow access to messages" />. Sem isso, nenhuma ferramenta recebe as mensagens.</li>
          <li>Um perfil do Facebook com acesso de administrador ao portfólio empresarial da empresa na Meta.</li>
          <li>O endereço de uma página de <strong>política de privacidade</strong> da empresa.</li>
        </Ul>
      </section>

      <Step id="ig-1" n={1} title="Criar o app na Meta" time="5 min">
        <Ol>
          <li>Abra <Ext href="https://developers.facebook.com/apps">developers.facebook.com/apps</Ext> e clique em <M pt="Criar app" en="Create App" />.</li>
          <li>Em <M pt="Casos de uso" en="Use cases" />, escolha <M pt="Gerenciar mensagens e conteúdo no Instagram" en="Manage messaging & content on Instagram" />.</li>
          <li>Escolha o portfólio da empresa e clique em <M pt="Criar app" en="Create app" />.</li>
        </Ol>
        <Note tone="tip">Pode ser o mesmo app do WhatsApp oficial, se ele já existir: em <M pt="Casos de uso" en="Use cases" />, adicione o caso do Instagram.</Note>
      </Step>

      <Step id="ig-2" n={2} title="Adicionar a conta do Instagram e gerar o token" time="5 min">
        <Ol>
          <li>No <M pt="Painel" en="Dashboard" />, clique no caso de uso do Instagram e em <M pt="Personalizar" en="Customize" />. No menu da esquerda, abra <M pt="Configuração da API com login do Instagram" en="API setup with Instagram login" />.</li>
          <li>Clique em <M pt="Adicionar todas as permissões necessárias" en="Add all required permissions" /> (entram <code>instagram_business_basic</code> e <code>instagram_business_manage_messages</code>).</li>
          <li>Em <M pt="Gerar tokens de acesso" en="Generate access tokens" />, clique em <M pt="Adicionar conta" en="Add account" />, <M pt="Continuar" en="Continue" />, entre com o Instagram da empresa, autorize e clique em <M pt="Salvar" en="Save" />.</li>
          <li>Ao lado da conta aparece o <strong>ID da conta do Instagram</strong> (só números). Copie.</li>
          <li>Clique em <M pt="Gerar token" en="Generate token" />, confirme e copie o token.</li>
        </Ol>
        <Note tone="crm">o ID vai no campo <strong>ID da conta do Instagram</strong>, e o token em <strong>Token de acesso</strong>. Esse token vale 60 dias, mas <strong>o CRM renova sozinho toda semana</strong>: não precisa fazer nada.</Note>
        <Note tone="warn">Enquanto o app não passa pela análise da Meta, só funcionam contas com função no app. Se a Meta pedir, adicione a conta em <M pt="Funções do app › Funções › Testadores do Instagram" en="App roles › Roles › Instagram Testers" /> e aceite o convite no Instagram pelo navegador: <M pt="Configurações › Apps e sites › Convites de testador" en="Apps and websites › Tester invites" />.</Note>
      </Step>

      <Step id="ig-3" n={3} title="Copiar as chaves secretas" time="2 min">
        <Ul>
          <li>Em <M pt="Configurações do app › Básico" en="App settings › Basic" />, copie a <M pt="Chave secreta do app" en="App secret" /> (clique em Mostrar).</li>
          <li>Na tela <M pt="Configuração da API com login do Instagram" en="API setup with Instagram login" />, copie também a <M pt="Chave secreta do app do Instagram" en="Instagram app secret" />.</li>
        </Ul>
        <Note tone="crm">a de Configurações do app › Básico vai em <strong>Chave secreta do app</strong>, e a do Instagram em <strong>Segunda chave secreta</strong>.</Note>
        <Note tone="info">a Meta assina cada aviso com a chave secreta do app; em alguns apps com login do Instagram, a assinatura sai com a chave do Instagram. Com as duas, o CRM aceita o aviso certo nos dois casos.</Note>
      </Step>

      <Step id="ig-4" n={4} title="Cadastrar no CRM" time="2 min">
        <Ol>
          <li>Aqui no CRM: <M pt="Configurações › Canais › Instagram › Adicionar Instagram" />.</li>
          <li>Preencha nome, ID da conta, tipo de acesso <strong>API com login do Instagram</strong>, token e as duas chaves. Clique em <strong>Salvar e conferir</strong>.</li>
        </Ol>
        <p>O CRM confere a conta, ativa os avisos de mensagens dela para o app e mostra a conta como <strong>Conectada</strong>, com o @.</p>
      </Step>

      <Step id="ig-5" n={5} title="Configurar os avisos (webhook)" time="3 min">
        <Ol>
          <li>No CRM, na conta cadastrada, abra <strong>Configurar os avisos na Meta</strong> e copie a URL de retorno e o token de verificação.</li>
          <li>No app da Meta, na tela <M pt="Configuração da API com login do Instagram" en="API setup with Instagram login" />, abra <M pt="Configurar webhooks" en="Configure webhooks" />.</li>
          <li>Cole a <M pt="URL de retorno" en="Callback URL" /> e o <M pt="Token de verificação" en="Verify token" /> e clique em <M pt="Verificar e salvar" en="Verify and save" />. Só depois da verificação os campos aparecem.</li>
          <li>Na lista de campos, assine <code>messages</code>.</li>
        </Ol>
      </Step>

      <Step id="ig-6" n={6} title="Publicar o app" time="5 min">
        <Ol>
          <li>Em <M pt="Configurações do app › Básico" en="App settings › Basic" />, preencha a URL da política de privacidade, a categoria e o ícone.</li>
          <li>No menu da esquerda, clique em <M pt="Publicar" en="Publish" /> e confirme.</li>
        </Ol>
        <Note tone="warn">Sem publicar, a Meta não manda os avisos de mensagens.</Note>
        <Note tone="info">para usar só com o Instagram da própria empresa, o acesso padrão basta. Para ligar contas de <strong>outras empresas</strong> (clientes de uma agência), a Meta exige a <M pt="Análise do app" en="App Review" /> da permissão <code>instagram_business_manage_messages</code> e a verificação da empresa.</Note>
      </Step>

      <Step id="ig-7" n={7} title="Testar" time="3 min">
        <Ol>
          <li>De outra conta do Instagram, mande uma mensagem direta para a conta da empresa.</li>
          <li>Ela aparece em <strong>Conversas › Instagram</strong>, com o @ da pessoa.</li>
          <li>Responda pelo CRM e confira no Instagram.</li>
        </Ol>
      </Step>

      <section aria-labelledby="ig-regras" className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface-2 p-4 text-sm">
        <h3 id="ig-regras" className="text-[15px] font-semibold">Regras da Meta que valem no dia a dia</h3>
        <Ul>
          <li><strong>Quem começa é o cliente:</strong> a empresa não pode mandar a primeira mensagem pelo Instagram.</li>
          <li><strong>24 horas</strong> para responder depois da última mensagem da pessoa. Depois disso, o CRM não deixa enviar.</li>
          <li><strong>Sem envio em massa:</strong> o Instagram não aparece em Campanhas.</li>
          <li><strong>Arquivos:</strong> o CRM recebe imagens e vídeos; o envio de arquivo pelo Instagram ainda não está disponível.</li>
        </Ul>
      </section>

      <Trouble items={[
        ['"O token do Instagram venceu ou foi revogado"', <p key="a">Gere um token novo (passo 2) e salve na conta em <strong>Editar</strong>. Acontece se a senha do Instagram mudar, se o acesso for removido, ou se a conta ficar mais de 60 dias sem renovação.</p>],
        ['As mensagens não aparecem no CRM', <Ul key="a">
          <li><strong>Permitir acesso às mensagens</strong> está ligado no app do Instagram?</li>
          <li>O webhook foi verificado e o campo <code>messages</code> está assinado (passo 5)?</li>
          <li>O app está publicado (passo 6)?</li>
          <li>Antes da análise da Meta, a conta precisa ser <strong>testadora</strong> do app (passo 2).</li>
          <li>Clique em <strong>Conferir</strong> na conta: o CRM ativa de novo os avisos.</li>
        </Ul>],
        ['"O dono da conta desativou o acesso às mensagens"', <p key="a">Ligue <strong>Permitir acesso às mensagens</strong> no app do Instagram (Configurações › Mensagens e respostas aos stories › Ferramentas conectadas). Só o dono da conta pode ligar.</p>],
        ['"O Instagram só deixa responder até 24 horas"', <p key="a">É regra da Meta. Espere a pessoa escrever de novo.</p>],
        ['Avisos com "assinatura inválida"', <p key="a">Confira as duas chaves do passo 3 (Editar na conta) e cole de novo.</p>],
      ]} />
    </div>
  );
}

export function MetaGuide({ kind }: { kind: GuideKind }) {
  return kind === 'instagram' ? <InstagramGuide /> : <WhatsAppGuide />;
}

/** Abas WhatsApp oficial / Instagram. */
export function GuideTabs({ kind, onChange }: { kind: GuideKind; onChange: (k: GuideKind) => void }) {
  return (
    <div role="group" aria-label="Qual canal" className="flex gap-1">
      {([['whatsapp', 'WhatsApp oficial'], ['instagram', 'Instagram']] as const).map(([v, label]) => (
        <button key={v} type="button" aria-pressed={kind === v} onClick={() => onChange(v)}
          className={`h-9 rounded-full px-4 text-sm font-medium ${kind === v ? 'bg-primary text-primary-fg' : 'border border-line text-muted hover:text-ink'}`}>{label}</button>
      ))}
    </div>
  );
}

/**
 * Passo a passo num painel lateral, ao lado da tela de canais. Não é modal:
 * dá para continuar usando a tela (e o formulário) com o guia aberto.
 */
export function GuideSheet({ kind, onKind, onClose }: { kind: GuideKind; onKind: (k: GuideKind) => void; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <aside ref={ref} tabIndex={-1} aria-label="Passo a passo da conexão"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[560px] flex-col border-l border-line bg-bg shadow-2xl outline-none">
      <header className="flex flex-col gap-3 border-b border-line bg-surface px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Passo a passo da conexão</h2>
            <p className="text-[13px] text-muted">Siga na ordem e marque cada passo como feito.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar o passo a passo" className="flex size-9 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink"><X size={18} aria-hidden /></button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <GuideTabs kind={kind} onChange={onKind} />
          <Link href={`/configuracoes/canais/guia?canal=${kind}`} target="_blank" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent underline underline-offset-2">
            Abrir em nova aba<ExternalLink size={12} aria-hidden />
          </Link>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <MetaGuide kind={kind} />
      </div>
    </aside>
  );
}
