# Critérios de aceite

Cada item só fecha com um critério verificável e o teste que o comprova.

## Definição de pronto

- O comportamento existe, persiste e tem a permissão conferida na API.
- A tela cobre carregamento, vazio, erro, sem permissão e operação em andamento.
- Os testes automatizados do item passam no CI.
- Ações sensíveis geram auditoria; documentação e `PROJECT_STATUS.md` atualizados.
- Integração externa tem dois estados distintos: "implementada, aguardando teste real" e "validada com conta real em tal data".

## Fase 1: Fundação

| Item | Critério | Comprovação | Situação |
| --- | --- | --- | --- |
| Repositório e CI | Todo envio instala, checa tipos, testa e constrói as imagens | Execução verde no GitHub Actions | Atendido (lint ainda não configurado) |
| Banco e migrações | Migrações aplicam do zero e sobre a versão anterior; toda tabela de cliente tem RLS forçado | Testes de banco | Atendido (PostgreSQL 16 e 18) |
| Login e sessão | Entrar, sair, expirar, revogar; bloqueio progressivo; eventos registrados | Integração e ponta a ponta | Atendido |
| Convite e recuperação de senha | Link de uso único com validade | Integração | Atendido |
| 2FA | Administrador sem 2FA não abre configurações; códigos de recuperação valem uma vez | Ponta a ponta | Atendido |
| Empresas | Criar, suspender e arquivar; usuário de empresa suspensa não entra | Ponta a ponta | Atendido |
| Usuários, equipes e perfis | Matriz aplicada na API | Testes da matriz e de integração | Atendido para as rotas da Fase 1; os testes por linha da matriz crescem com cada módulo |
| Isolamento | Casos de `DATA_MODEL.md` | Suíte de isolamento | Atendido |
| Auditoria | Ação sensível grava ator, empresa, ação, objeto e horário | Integração | Atendido |
| Design system e tema | Mudar a cor primária altera toda a interface sem nova implantação; tema de uma empresa não aparece em outra; contraste insuficiente recusado | Ponta a ponta com axe; integração com duas empresas | Atendido (logo e favicon por empresa na Fase 2) |
| Stack implantável | Sobe em Docker Swarm atrás de um Traefik de teste, sem porta publicada | Job do CI | Atendido |
| Backup inicial | Restaurar em banco vazio e conferir os dados | Job do CI | Atendido |

## Fase 2: CRM comercial

| Item | Critério | Comprovação |
| --- | --- | --- |
| Contatos e organizações | Vários telefones e e-mails, tags, campos personalizados, responsável; busca e filtros com paginação | Integração e ponta a ponta |
| Duplicados e mesclagem | Detecção por e-mail e telefone normalizados; mesclagem preserva o histórico e é auditada | Integração |
| Importação e exportação | CSV de 10 mil linhas com erro por linha; exportação respeita o alcance e fica registrada | Integração |
| Funis configuráveis | Funil, etapas, ordem, cores, probabilidade e campos obrigatórios sem alterar código | Ponta a ponta |
| Negócios e Kanban | Arrastar respeita regra de transição, campo obrigatório e permissão; histórico registra | Unidade e ponta a ponta |
| Acesso por funil | Funil não autorizado some da interface e devolve 404 na API e na exportação | Segurança |
| Leads e distribuição | Rodízio distribui por igual com entradas simultâneas; atribuição auditada | Integração concorrente |
| Tarefas e agenda | Recorrência e lembrete; visões de dia, semana e mês | Unidade e ponta a ponta |
| Linha do tempo | Toda alteração relevante aparece no histórico do contato, em ordem | Integração |
| Atribuição de origem | Primeira origem nunca sobrescrita; campo ausente fica vazio | Unidade e banco |
| Arquivos | Tipo e tamanho validados; acesso só por URL assinada; arquivo de outra empresa devolve 404 | Segurança |
| Consentimento e privacidade | Consentimento por canal com origem e data; exportar e anonimizar titular, auditado | Integração |
| Dashboards iniciais | Números batem com consulta direta em base conhecida e respeitam o alcance | Integração |

## Fase 3: API, eventos e n8n

| Item | Critério | Comprovação |
| --- | --- | --- |
| API v1 e OpenAPI | Contrato publicado; cliente gerado compila; erros padronizados | Teste de contrato |
| Chaves e escopos | Sem escopo: 403; revogada: 401; nenhuma chave alcança outra empresa | Segurança |
| Idempotência | Vinte chamadas simultâneas com a mesma chave criam um registro | Integração |
| Outbox | Derrubar o worker no meio do despacho não perde nem repete efeito | Confiabilidade |
| Webhooks de saída | Assinatura confere; 500 gera retentativas; histórico; reenvio manual | Integração |
| Limite de taxa | Excedente recebe 429 com tempo de espera | Integração |
| n8n real | Um fluxo recebe `deal.stage_changed` e cria uma tarefa pela API | Manual, registrado com data |

## Fase 4: WhatsApp e caixa unificada

| Item | Critério | Comprovação |
| --- | --- | --- |
| Conta conectada | Estado, QR code, diagnóstico; chave cifrada | Integração |
| Recebimento | Texto, imagem, documento, áudio e vídeo na conversa certa, com anexo guardado | Corpos reais capturados; teste manual |
| Duplicidade | Mesmo evento três vezes gera uma mensagem | Integração |
| Envio | Estado evolui; falha definitiva visível; queda após o envio vira "incerto", sem reenvio | Integração com simulador |
| Caixa de entrada | Abas, filtros, não lidas, busca; mensagem nova aparece em duas sessões sem recarregar | Ponta a ponta |
| Notas internas | Nenhuma rota de envio aceita nota | Segurança |
| Reinício | Reiniciar API e worker durante tráfego não perde nem duplica | Confiabilidade |
| Validação real | Envio e recebimento com número de teste | Manual, registrado com data |

## Fase 5: E-mail e agendamentos

| Item | Critério | Comprovação |
| --- | --- | --- |
| Conector de e-mail | Sincronização incremental, envio, resposta, encaminhamento, anexos | Servidor de teste; caixa real |
| Encadeamento | Respostas na mesma conversa e no contato certo | Integração |
| Modelos | Variável sem valor bloqueia o envio | Unidade |
| Agendamento | Criar, editar, cancelar, reagendar; fuso; horários permitidos | Unidade e ponta a ponta |
| Sobrevivência | Derrubar Redis e worker com 100 pendentes: todos executam uma vez | Confiabilidade |
| Concorrência | Dois workers e 1.000 agendamentos: nenhum duplicado | Confiabilidade |
| Comemorativas | 29 de fevereiro, data sem ano, fuso; sem consentimento não recebe | Unidade e integração |

## Fase 6: Instagram e WhatsApp oficial

| Item | Critério | Comprovação |
| --- | --- | --- |
| Instagram | Conectar a conta da WTA, receber, responder dentro da janela, bloquear fora | Teste real |
| Webhook da Meta | Assinatura inválida rejeitada; evento repetido não duplica | Integração |
| WhatsApp oficial | Modelos, janela, opt-out | Integração; real se a conta existir |
| Coexistência | Implementada se elegível; senão, pendência externa registrada | `PROJECT_STATUS.md` |

## Fase 7: Marketing e atendimento avançado

| Item | Critério | Comprovação |
| --- | --- | --- |
| Tickets e SLA | Prazos em horário de atendimento; estouro gera alerta e escalonamento | Unidade e integração |
| Conversa para ticket | Relação nos dois registros | Ponta a ponta |
| Automações | Os oito exemplos do prompt mestre; uma regra não roda duas vezes para o mesmo evento | Integração |
| Segmentos e sequências | Resposta do contato interrompe a sequência | Integração |
| Captação | Formulário de teste cria lead com UTMs | Ponta a ponta |
| Dashboards avançados e metas | Conferidos contra base conhecida; metas com progresso; filtros | Integração e carga |

## Fase 8: Homologação e produção

| Item | Critério | Comprovação |
| --- | --- | --- |
| Segurança | Itens aplicáveis do OWASP ASVS; nenhuma dependência com falha grave conhecida | Relatório em `SECURITY.md` |
| Carga | Meta proporcional à VPS, definida após o inventário | Teste em homologação |
| Backup e restauração | Restauração cronometrada em máquina limpa | Ensaio registrado |
| Monitoramento | Derrubar um serviço dispara alerta | Ensaio registrado |
| Rollback | Voltar à imagem anterior | Ensaio registrado |
| Checklist de produção | Aprovado pelo responsável | Aceite |
