# Integrações

Nenhuma integração foi implementada nem testada contra contas reais. Este arquivo separa o que a documentação oficial confirmava em 11 de outubro de 2026 do que só a instalação e as contas reais vão dizer.

Cada integração terá um de três estados neste arquivo: **planejada**, **implementada, aguardando teste real** ou **validada com conta real em (data)**.

| Integração | Mecanismo | Fase | Estado |
| --- | --- | --- | --- |
| WhatsApp pela Evolution API | Webhook da instância para o CRM; API REST da Evolution para envio | 4 | Planejada |
| WhatsApp oficial (Cloud API) | Webhooks e Graph API da Meta | 6 | Planejada |
| Coexistência | Embedded Signup v4 e sincronização de histórico | 6 | Planejada, condicionada à elegibilidade |
| Instagram Direct | Login do Instagram, webhooks, `graph.instagram.com` | 6 | Planejada |
| E-mail por IMAP/SMTP | Sincronização por UID; envio por SMTP | 5 | Planejada |
| Gmail e Microsoft 365 | OAuth, Gmail API, Microsoft Graph | 5 | Planejada |
| n8n | Webhooks assinados na saída; API com chave na entrada | 3 | Planejada |
| Captação de leads | Endereço de captação com token | 7 | Planejada |

## Evolution API

Conferido na documentação ([repositório](https://github.com/EvolutionAPI/evolution-api), [webhooks da v2](https://doc.evolution-api.com/v2/en/configuration/webhooks)):

- Dois tipos de conexão: Baileys, baseada no WhatsApp Web, e a Cloud API oficial.
- Última versão estável publicada: 2.3.7. A 2.4.0 estava em versão candidata.
- Webhook por instância, com `enabled`, `url`, `webhook_by_events` e `events`; consulta em `GET /webhook/find/{instância}`.
- Vinte eventos, entre eles `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `MESSAGES_DELETE`, `SEND_MESSAGE`, `CONNECTION_UPDATE` e `QRCODE_UPDATED`.
- A página não descreve retentativas nem proteção contra entrega duplicada. O CRM assume que os dois casos acontecem.

Estratégia:

1. Diagnóstico só de leitura: versão, instâncias e webhook atual de cada uma. Nada é alterado.
2. Cada conta conectada corresponde a uma instância e pertence a uma empresa. A chave fica cifrada.
3. Para o CRM, uma instância nova. **Webhook de instância existente não é alterado sem aprovação**, porque pode estar alimentando fluxos do n8n.
4. Mensagens deduplicadas pelo identificador do WhatsApp mais a instância.
5. Envio pela fila da instância, com intervalo mínimo e teto diário configuráveis.
6. Mídia copiada para o armazenamento do CRM assim que chega.

Limitações declaradas no produto: em modo Baileys o canal não é oficial e há risco de bloqueio do número; grupos ficam fora do escopo inicial; confirmação de leitura depende da privacidade do contato.

A confirmar na instalação: versão, tipo de conexão de cada instância, forma de autenticação, se o webhook aceita cabeçalho próprio, e o formato real dos corpos.

## WhatsApp oficial e coexistência

Conferido na documentação da Meta ([coexistência](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users), [preços](https://developers.facebook.com/docs/whatsapp/pricing)):

- A coexistência usa o mesmo número no aplicativo WhatsApp Business e na Cloud API. Quem integra precisa ser Solution Partner ou Tech Provider e usar o Embedded Signup.
- O Embedded Signup v2 seria descontinuado em 15 de outubro de 2026; o conector nasce na v4.
- O aplicativo do cliente precisa da versão 2.24.17 ou superior.
- Sincronizam contatos e seis meses de conversas individuais; mídia, só dos últimos 14 dias. Há 24 horas para sincronizar depois da entrada.
- Grupos não sincronizam. Listas de transmissão, mensagens temporárias e de visualização única ficam desativadas.
- Vazão fixa de 20 mensagens por segundo.
- O número é desconectado se o celular principal ficar cerca de 14 dias inativo.
- Cobrança por mensagem desde 1º de julho de 2025. Dentro da janela de 24 horas, mensagens de serviço e modelos de utilidade são gratuitos. Fora dela, só modelo aprovado.

Estratégia: conector `whatsapp_cloud` próprio, sem passar pela Evolution. Janela calculada por conversa, modelos sincronizados com o estado de aprovação, opt-out registrado. A decidir na Fase 6: a WTA se torna Tech Provider ou usa um parceiro.

## Instagram Direct

Conferido na documentação da Meta ([mensagens](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api), [visão geral](https://developers.facebook.com/docs/instagram-platform/overview)):

- A API com login do Instagram atende contas profissionais sem exigir Página do Facebook.
- Permissões: `instagram_business_basic` e `instagram_business_manage_messages`.
- Acesso padrão cobre contas que a WTA possui ou administra. Contas de clientes exigem acesso avançado, com revisão do aplicativo e verificação da empresa.
- A conversa só começa quando o usuário escreve. Resposta em 24 horas, ou 7 dias com a marcação de agente humano.
- Texto até 1.000 bytes; imagem até 8 MB; áudio, vídeo e PDF até 25 MB.
- Sem grupos e sem as pastas da caixa do Instagram.

Sem raspagem e sem automação fora da API.

## E-mail

Conferido:

- No Gmail, `gmail.readonly`, `gmail.modify` e `gmail.compose` são escopos restritos. Aplicativo público que guarda esses dados em servidor passa por verificação e avaliação de segurança ([Google](https://developers.google.com/workspace/gmail/api/auth/scopes)).
- No Exchange Online, a autenticação básica foi removida de IMAP e POP, e a de SMTP está em retirada ([Microsoft](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online)).

| Conector | Atende | Limite |
| --- | --- | --- |
| IMAP/SMTP | Provedores com senha de aplicativo | Sem confirmação de entrega; não serve ao Microsoft 365 |
| Gmail API | Google Workspace e Gmail | Aplicativo interno atende só o Workspace da WTA; clientes exigem a verificação do Google |
| Microsoft Graph | Microsoft 365 | Consentimento do administrador de cada cliente |

O primeiro a ser construído é o IMAP/SMTP. Falta saber qual provedor de e-mail a WTA usa no dia a dia.

## n8n

Conferido ([nó Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)): o nó aceita autenticação básica, por cabeçalho ou JWT; o corpo vai até 16 MB por padrão; os endereços de teste e de produção são diferentes.

O contrato dos eventos e da API de entrada está em [`API.md`](API.md). O n8n não acessa o banco do CRM.

## Credenciais necessárias

| Fase | O que |
| --- | --- |
| 3 | Endereço do n8n e um fluxo de teste |
| 4 | Endereço e chave da Evolution; uma instância com número de teste |
| 5 | Caixa de e-mail de teste: servidor, porta, usuário e senha de aplicativo |
| 6 | Conta Meta for Developers, aplicativo, verificação da empresa, conta profissional do Instagram |
| 7 | Acesso aos formulários do WordPress e do Typebot |
| 8 | DNS, destino do backup, janela de implantação |

Chaves e senhas entram como segredos no GitHub ou no Portainer. Nunca em arquivo do repositório nem em conversa.
