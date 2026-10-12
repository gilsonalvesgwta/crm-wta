# Matriz de permissões

Cada permissão é um recurso, uma ação e um alcance. Os perfis são dados de cada empresa (`roles`, `role_permissions`), não código. A matriz abaixo são os modelos iniciais propostos. Ela ainda aguarda a revisão linha a linha do responsável pelo produto.

Quando a API for criada, esta matriz passa a viver em um único arquivo de código, e os testes e este documento são gerados dele.

## Como funciona

- **Chave.** `recurso:ação`, por exemplo `deals:edit`. Ações: ver, criar, editar, excluir, atribuir, exportar, administrar, executar.
- **Alcance.** `own`: registros de que o usuário é responsável ou participante, e os compartilhados com ele. `team`: os próprios mais os das equipes dele. `tenant`: todos. O alcance pode ser limitado a uma unidade.
- **Restrição por objeto.** Funis e contas conectadas têm lista própria de equipes e usuários autorizados.
- **Vários perfis.** Vale a união das permissões.
- **Onde é decidido.** Sempre na API: guarda da rota, caso de uso e filtro do repositório.
- **Resposta.** Ação não permitida no módulo devolve 403. Registro fora do alcance devolve 404, sem revelar que existe.

## Matriz inicial

Emp = toda a empresa, Eq = equipe, Pr = próprios, — = sem acesso.

| Recurso e ação | Administrador | Gestor | Líder de equipe | Comercial | Suporte | Marketing | Financeiro | Visualizador |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Contatos e organizações: ver | Emp | Emp | Eq | Pr | Eq | Emp | Emp | Emp |
| Contatos e organizações: criar e editar | Emp | Emp | Eq | Pr | Pr | Emp | — | — |
| Contatos: excluir e mesclar | Emp | Emp | — | — | — | — | — | — |
| Contatos: importar e exportar | Emp | Emp | — | — | — | Emp | — | — |
| Leads: ver e trabalhar | Emp | Emp | Eq | Pr | — | Emp | — | Emp (só ver) |
| Negócios: ver | Emp | Emp | Eq | Pr | — | Emp | Emp | Emp |
| Negócios: criar, editar e mover | Emp | Emp | Eq | Pr | — | — | — | — |
| Negócios e leads: atribuir | Emp | Emp | Eq | — | — | — | — | — |
| Negócios: excluir e exportar | Emp | Emp | — | — | — | — | Emp (só exportar) | — |
| Produtos e preços: administrar | Emp | Emp | — | — | — | — | Emp | — |
| Funis e etapas: configurar | Emp | Emp | — | — | — | — | — | — |
| Conversas: ver e responder | Emp | Emp | Eq | Pr e não atribuídas da equipe | Eq | — | — | — |
| Conversas: atribuir e transferir | Emp | Emp | Eq | Só assumir | Eq | — | — | — |
| Tarefas e agenda | Emp | Emp | Eq | Pr | Pr | Pr | Pr | — |
| Tickets: ver e tratar | Emp | Emp | Eq | Pr (só ver) | Eq | — | — | — |
| Suporte: configurar SLA, categorias e estados | Emp | Emp | — | — | — | — | — | — |
| Mensagens agendadas | Emp | Emp | Eq | Pr | Pr | Emp | — | — |
| Modelos, campanhas e segmentos | Emp | Emp | Ver | Ver | Ver | Emp | — | — |
| Campanhas: aprovar envio | Emp | Emp | — | — | — | — | — | — |
| Automações | Emp | Emp | — | — | — | Ver | — | — |
| Relatórios e dashboards: ver | Emp | Emp | Eq | Pr | Eq | Emp | Emp | Emp |
| Relatórios: exportar | Emp | Emp | — | — | — | Emp | Emp | — |
| Metas: definir | Emp | Emp | Eq | — | — | — | — | — |
| Usuários, equipes e perfis | Administrar | Ver | Ver a equipe | — | — | — | — | — |
| Contas conectadas e canais | Administrar | Ver estado | — | — | — | — | — | — |
| Chaves de API e webhooks | Administrar | — | — | — | — | — | — | — |
| Configurações e identidade visual | Administrar | — | — | — | — | — | — | — |
| Auditoria | Ver | Ver | — | — | — | — | — | — |
| Privacidade: exportar e anonimizar titular | Executar | — | — | — | — | — | — | — |

O perfil personalizado parte de qualquer um desses modelos. Nenhuma regra depende do nome do cargo.

## Superadministrador da plataforma

Fica fora da matriz, porque não pertence a nenhuma empresa.

- Cria, suspende e arquiva empresas; define módulos habilitados e limites de uso.
- Não lê contatos, conversas nem credenciais de uma empresa por padrão. No banco, o papel `crm_platform` não tem leitura nessas tabelas.
- Para dar suporte, entra em modo suporte: informa o motivo, recebe acesso por tempo limitado, e a empresa vê o registro na própria auditoria.
- 2FA obrigatório.

## Como será testado

- Para cada perfil e cada linha da matriz, um teste de acesso permitido e um de acesso negado, direto na API.
- Testes de alcance: Comercial não abre negócio de colega por identificador; Líder não abre registro de outra equipe.
- Testes de objeto: funil e conta conectada fora da lista de acesso devolvem 404 pela interface, pela API e pela exportação.
