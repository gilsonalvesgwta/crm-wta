# Situação do projeto

Atualizado em 14 de outubro de 2026.

## Fase atual

**Lote 3 (automações e entrada pelo n8n)**, modelo de planilha de importação e cópias de segurança dentro de cada empresa, sobre os lotes 1 e 2 e o backup já instalados.

**Instalação:** no ar em `https://crm.wtatech.com.br` desde 13 de outubro de 2026, versão `2026.10.13-40971d2`, stack `crmwta` criada pelo Portainer da VPS. Migrações aplicadas, administrador criado, `/api/readyz` respondendo.

## Concluído, com teste

### Fase 1: fundação

| Item | Evidência |
| --- | --- |
| Banco: papéis, contexto de empresa, RLS forçado, funções de autenticação | Migrações `0001` a `0003`; testes de banco no PostgreSQL 16 e 18 |
| Login, sessão no servidor, bloqueio progressivo, CSRF, nova senha, troca de senha | Integração e ponta a ponta |
| Verificação em duas etapas com códigos de recuperação, obrigatória nas áreas administrativas | Vetores das RFC 4226 e 6238; integração; ponta a ponta |
| Convites, várias empresas por pessoa, sessões abertas | Integração e ponta a ponta |
| Matriz de permissões, oito perfis padrão, perfis personalizados com alcance | Domínio e integração |
| Usuários, equipes, dados da empresa, identidade visual com contraste calculado | Integração e ponta a ponta |
| Auditoria só de inserção; plataforma para criar e suspender empresas | Integração e ponta a ponta |
| Stack de produção com Traefik, segredos, cópia diária e restauração | `deploy/teste-stack.sh` no CI |

### Conversas (bloco 1 dos ajustes de 14 out 2026)

| Item | Evidência |
| --- | --- |
| Automações no menu principal, entre Organizações e Agenda | Ponta a ponta |
| Iniciar conversa de WhatsApp ou e-mail com quem nunca escreveu (contato cadastrado ou novo, pela tela de Conversas ou pelo contato) | Integração; ponta a ponta |
| Conversas separadas por canal (WhatsApp e e-mail), com estado (aberta, aguardando cliente, encerrada), responsável e equipe; reabre quando o cliente escreve | Banco; integração; ponta a ponta |
| Filtros por estado, canal, responsável, equipe, etiqueta, negócio (aberto, sem negócio, funil) e não lidas | Integração; ponta a ponta |
| Assumir conversa sem responsável (`conversations:take`); atribuir e trocar equipe (`conversations:assign`) | Integração |
| Respostas prontas de WhatsApp e e-mail (da empresa e pessoais), com variáveis e atalho "/" na caixa de mensagem | Banco; integração; ponta a ponta |

### Lote 3: automações e n8n

| Item | Evidência |
| --- | --- |
| Automações com gatilho (contato, lead e negócio novos, mudança de etapa, ganho, perda, mensagem recebida, aniversário, negócio parado), filtros (funil, etapa, etiqueta, origem) e ações em sequência (WhatsApp, e-mail, tarefa, etiqueta, mover etapa, webhook, esperar) | Banco; integração contra Evolution e SMTP falsos; ponta a ponta |
| Variáveis nos textos ({{primeiro_nome}}, {{empresa}}, {{negocio}}…); modelos prontos na tela | Integração; ponta a ponta |
| Registro de cada execução com o que cada ação fez, ou por que não se aplicou | Integração; ponta a ponta |
| Lista de supressão respeitada; resposta automática no máximo a cada 12 h por contato; limite de automações do plano | Integração |
| Chaves de API e entrada do n8n: contato achado ou criado, organização e etiquetas pelo nome, negócio no funil e etapa escolhidos (pelo nome), lead | Integração; ponta a ponta |

### Backup e restauração pela Plataforma

| Item | Evidência |
| --- | --- |
| Cópia com banco, arquivos e manifesto (empresas e migrações); automática diária com retenção; "Fazer cópia agora" | Agente com PostgreSQL real; integração; ponta a ponta; stack amd64 e arm64 |
| Baixar a cópia (cópia externa manual) e enviar uma cópia guardada fora, conferida antes de aparecer | Integração |
| Restaurar uma empresa (volta a existir se foi excluída; as outras não mudam; arquivos voltam) | Agente; integração; ponta a ponta; stack |
| Restaurar o banco inteiro, com o anterior guardado e cópia de segurança automática antes | Agente; stack |
| Cópias antigas (.dump sem donos) restauram com os donos certos | Agente |
| Configurações › Cópias de segurança: o administrador da empresa faz, baixa, restaura e exclui cópias só da própria empresa (dados e arquivos, sem senhas); outra empresa não vê nem usa; cópias apagadas sozinhas depois de 7 dias (`DIAS_COPIAS_EMPRESA`) | Agente; integração; ponta a ponta |

### Lote 2: canais e mensagens

| Item | Evidência |
| --- | --- |
| Configurações › Canais: conectar número de WhatsApp pelo CRM (instância `crmwta-*` criada na Evolution existente, QR code renovado, fecha sozinho ao conectar), desconectar, refazer o webhook, remover | Integração e ponta a ponta, contra uma Evolution falsa |
| Receber WhatsApp: contato criado para número novo, número sem o nono dígito casa com o cadastrado, mídia guardada, grupos e reações fora, aviso repetido entra uma vez | Integração; domínio |
| Enviar WhatsApp: texto e arquivo, estados enviada, entregue e lida (sem regredir), mensagem do celular no histórico, falha com o motivo | Integração; ponta a ponta |
| E-mail da empresa por SMTP: cadastro com senha cifrada, teste com envio real, envio com assunto e anexo, erro de senha explicado; proteção contra servidor interno | Integração contra um SMTP falso; domínio |
| Conversas: lista no alcance de quem atende, não lidas no menu, resposta pelo canal escolhido | Integração; ponta a ponta |
| Histórico completo no contato: painel Mensagens e linha do tempo (recebida, enviada, não enviada) | Ponta a ponta |
| Limites do plano para números de WhatsApp e caixas de e-mail; privacidade (exportar e anonimizar incluem as mensagens); mesclagem leva as mensagens | Integração; banco |

### Lote 1: plataforma comercial e marca das empresas

| Item | Evidência |
| --- | --- |
| Plataforma: editar empresa (nome, responsável, e-mail, telefone, documento, observações), reenviar convite de administrador, excluir com o identificador digitado (WTA protegida), apagando também os arquivos | Banco; integração; ponta a ponta |
| Planos com preço, período, dias de acesso e limites (usuários, WhatsApp, e-mail, automações, domínio próprio, API); assinatura por empresa com situação e vigência; vencida, a empresa é suspensa sozinha | Banco; integração; ponta a ponta |
| Limite de usuários aplicado no convite e na reativação | Integração |
| Greenn: webhook com segredo, compra paga cria ou renova, reembolso suspende, cancelamento vale até o fim do período, avisos repetidos uma vez só, registro de cada aviso | Integração (avisos no formato da documentação; compra real pendente) |
| Identidade visual: 4 modelos de cores, cor do menu com contraste conferido, logotipo e ícone | Integração; ponta a ponta |
| Domínio próprio: cadastro, instruções de DNS, verificação de DNS e rota; tela de login com o logotipo e as cores da empresa pelo endereço; empresa escolhida sozinha no login | Banco; integração; ponta a ponta |
| Plano, vigência e uso dos limites em Configurações › Empresa | Ponta a ponta |

### Fase 2: CRM comercial

| Item | Evidência |
| --- | --- |
| Contatos e organizações: vários e-mails e telefones normalizados (E.164), etiquetas, campos personalizados, responsável e equipe, aniversário com ano opcional | Integração; ponta a ponta |
| Busca sem acento por nome, e-mail, telefone e documento; filtros, ordenação e paginação | Integração |
| Duplicados por e-mail e telefone, sem revelar o nome de cadastro fora do alcance; mesclagem que preserva negócios, notas, histórico, origem e consentimento, auditada | Integração; ponta a ponta |
| Alcance: comercial vê os próprios (e os contatos dos seus negócios e leads), líder vê a equipe, gestor vê a empresa; fora do alcance responde 404 | Integração, por perfil |
| Funis configuráveis: etapas, ordem, cores, probabilidade, campos exigidos, prazo de inatividade, regras de transição | Integração; ponta a ponta |
| Negócios em quadro com arrastar (também pelo teclado), totais e valor ponderado por etapa; ganho e perda com motivo; itens de produto | Integração; ponta a ponta |
| Histórico de etapas gravado pelo banco, com tempo em cada etapa | Banco; integração |
| Funil restrito: some da lista, da API, do quadro e da exportação para quem não está na lista | Integração |
| Leads: contato existente reaproveitado, rodízio por origem e equipe (30 entradas simultâneas, 10 para cada um), atribuição auditada com aviso, qualificar em negócio, descartar e reabrir | Integração; ponta a ponta |
| Tarefas e agenda: tipos, prioridade, recorrência que mantém o horário local, editar ou excluir "esta e as seguintes", lembrete que vira aviso uma única vez, visões de dia, semana, mês e lista | Integração; ponta a ponta |
| Linha do tempo de cada registro, com nomes dos campos alterados e nunca os valores pessoais | Integração |
| Origem: primeira e última, UTMs e identificadores de clique; a primeira nunca é sobrescrita; campo ausente fica vazio | Banco; integração |
| Arquivos: tipo conferido pelo conteúdo (HTML, SVG e executáveis recusados), limite de tamanho, download só por endereço assinado de 5 minutos, 404 fora do alcance | Integração; ponta a ponta |
| Importação de CSV: 10 mil linhas em lotes, sugestão de colunas, duplicados pulados ou completados, aviso por linha, retomada sem repetir depois de queda | Integração; ponta a ponta |
| Exportação em CSV para o Excel em português, no alcance de quem exporta, registrada | Integração |
| Consentimento por canal e finalidade com origem e evidência; opt-out vai para a lista de supressão | Banco; integração |
| Direitos do titular: exportar tudo e anonimizar, com 2FA e auditoria | Integração |
| Painel inicial: negócios em aberto, ganhos, taxa de ganho, perdas por motivo, leads por origem, agenda do dia; números conferidos contra consulta direta e no alcance de quem vê | Integração; ponta a ponta |
| Imagens para amd64 e arm64 (a VPS é ARM), com o teste da stack nas duas | CI |

## Testes executados

Lote 2, ramo `claude/lote2-canais`, ambiente de desenvolvimento (o CI repete tudo, nas duas arquiteturas): banco 367 verificações; API 185 de 185; ponta a ponta 24 de 24, com axe em cada tela nova.

Lote 1, ramo `claude/lote1-plataforma`: banco 352 verificações; API 160 de 160; ponta a ponta 22 de 22.

Fase 2, ramo `claude/fase2-crm`, 13 de outubro de 2026, no GitHub Actions (os mesmos conjuntos também rodam no ambiente de desenvolvimento).

| Conjunto | Onde | Resultado |
| --- | --- | --- |
| Banco | PostgreSQL 16 e 18 | 330 verificações aprovadas em cada |
| API (domínio e integração) | Node 24, PostgreSQL 18 | 137 de 137 |
| Ponta a ponta | Chromium, API e interface compiladas | 19 de 19, com axe em cada tela |
| Stack | Docker Swarm com Traefik 3.5 configurado como o da VPS, em amd64 e em arm64 | Todas as conferências aprovadas nas duas, incluindo arquivo gravado no volume e baixado pelo endereço assinado |
| Dependências | `pnpm audit --prod` | Nenhuma vulnerabilidade conhecida |

## Pendências

- **Limite de requisições geral** por IP e por usuário: entra com o Redis, na Fase 3. O login já tem bloqueio.
- **Certificado dos domínios próprios**: decidir entre Cloudflare for SaaS e a lista no Traefik (DEPLOYMENT.md).
- **Greenn**: teste com uma compra real.
- **WhatsApp e e-mail com servidores reais**: conectar um número de teste na Evolution da VPS e cadastrar uma caixa da Hostinger.
- **Leitura das respostas de e-mail (IMAP)**: Fase 5. Hoje as respostas chegam na caixa de sempre.
- **Automações e n8n com servidores reais**: criar uma chave, ligar um fluxo do n8n à entrada e uma automação ao webhook do n8n.
- **Visões salvas**: a API existe; falta a tela para salvar e escolher filtros.
- **Lembretes só dentro do CRM.** Lembrete por e-mail ou WhatsApp entra com os canais (Fases 4 e 5).
- **Metas comerciais**: Fase 7, junto com os dashboards avançados.
- **Lint** no CI.

## Bugs conhecidos

Nenhum aberto. Corrigidos em 13 out 2026 (acesso):

- Administrador geral sem empresa ativa ficava preso em "Escolha a empresa"; agora vai para a Plataforma. A plataforma recusa excluir a empresa em uso e a última empresa.
- Conta que ficou sem empresa (empresa excluída) não conseguia entrar nem aceitar um convite novo. Agora entra sem empresa (só alcança a própria conta e os convites), e o convite de quem já tem conta pede a senha na própria página e já entra na empresa.

## Dependências externas

| Item | De quem |
| --- | --- |
| Registro DNS `crm` (tipo A) para o IP da VPS, no Cloudflare | Responsável pelo produto |
| Revisão da matriz de permissões | Responsável pelo produto |
| Caixa de e-mail na Hostinger para os e-mails do sistema | Responsável pelo produto (endereço e senha só na instalação) |
| Endereço e chave da Evolution API (variáveis da stack) e um número de teste | Responsável pelo produto, lote 2 |
| Aplicativo na Meta e verificação da empresa | Fase 6 |

## Mudanças de infraestrutura

13 de outubro de 2026, com aprovação do responsável, na VPS `Wtatechor3`:

- Registro DNS `crm.wtatech.com.br` (Cloudflare).
- Segredos `crmwta_db_password`, `crmwta_api_db_password`, `crmwta_master_keys`, `crmwta_smtp_pass`, `crmwta_bootstrap_password`.
- Stack `crmwta` (serviços `db`, `migrate`, `api`, `web`, `backup`; volumes `crmwta_db`, `crmwta_backup`, `crmwta_arquivos`), ligada à rede existente `Wtatechor3Net` só pelos serviços `api` e `web`.
- Nenhum serviço, rede, volume ou configuração existente foi alterado.

## Riscos

- **Verificação em duas etapas desligada nas áreas administrativas** durante os testes (`EXIGIR_2FA=false`). Religar antes de receber clientes.

- **Repositório público.** Recomendação: torná-lo privado. Nenhum segredo foi gravado nele.
- **Cópias do banco e arquivos só na VPS** até haver destino externo.
- **VPS sem swap** e com muitos serviços em imagens `latest`, que podem mudar sozinhas numa reinicialização. Não é do CRM, mas afeta a máquina toda.

## Próximas ações

1. Colar a stack nova (backup ligado à API) no editor web do Portainer e atualizar com "Re-pull image and redeploy"; conferir a aba Backups e baixar uma cópia.
2. Conectar um número de teste e cadastrar uma caixa de e-mail; conferir receber, responder e enviar arquivo.
3. Cadastrar o endereço do webhook na Greenn e ligar os produtos aos planos.
4. Cópias dentro de cada empresa: prontas (Configurações › Cópias de segurança).
5. Planilha modelo de importação: pronta (contatos e organizações, com exemplo ilustrado na tela).

## Aprovações pendentes

- ADR 021: consultas em SQL, sem ORM.
- Usar o MinIO da VPS para os arquivos, ou manter o volume da stack (ADR 023).
- Matriz de permissões.
- Tornar o repositório privado.
