# Segurança e privacidade

## O que já está implementado e testado

Camada de banco, migração `0001_fundacao`, conferida por `packages/db/tests`:

- RLS ligado e forçado em todas as tabelas. Sem contexto de empresa, a consulta falha.
- Chaves estrangeiras compostas com `tenant_id`: uma relação não cruza empresas nem para o dono do banco.
- O papel da aplicação (`crm_app`) não é superusuário, não ignora RLS e não cria objetos.
- Senha e segredo de 2FA não são legíveis pelo papel da aplicação. Só as funções de autenticação os alcançam.
- Tokens de sessão, de convite e de nova senha são guardados só como hash.
- Sessão deixa de valer quando vence, é revogada, o usuário é desativado, o vínculo é desativado ou a empresa é suspensa.
- Auditoria e eventos de autenticação só aceitam inserção; um gatilho barra alteração e exclusão até para o dono.
- Nenhuma função é executável por todos os papéis. Os testes conferem a lista fechada do que a aplicação executa.
- Toda função que roda com os direitos do dono fixa o `search_path`.

Testes de mutação feitos em 11 de outubro de 2026: doze alterações indevidas (RLS desligado, política permissiva, concessão de leitura da senha, função aberta, chave estrangeira simples, auditoria alterável, entre outras) foram aplicadas uma a uma, e os testes falharam em todas.

## O que está planejado

| Tema | Controle | Fase |
| --- | --- | --- |
| Senhas | Argon2id | 1 |
| Sessão | Cookie `httpOnly`, `Secure`, `SameSite=Lax`; rotação e revogação | 1 |
| 2FA | TOTP com códigos de recuperação, obrigatório para administradores | 1 |
| Força bruta | Bloqueio progressivo por e-mail e por IP; eventos registrados | 1 |
| CSRF | Conferência de origem e token em toda mutação | 1 |
| XSS | Política de conteúdo (CSP); HTML de e-mail sanitizado e exibido em quadro isolado | 1 e 5 |
| Injeção de SQL | Consultas parametrizadas | 1 |
| Limite de taxa | Por IP, usuário e chave de API | 1 e 3 |
| Credenciais de integrações | AES-256-GCM; chave mestra em segredo do Docker, fora do banco, com identificador para rotação | 3 |
| Arquivos | Tipo conferido pelo conteúdo, limite de tamanho, nome aleatório, URL assinada de curta duração | 2 |
| Logs | Estruturados, com empresa, ator e requisição; sem corpo de mensagem nem segredo | 1 |
| Webhooks | Assinatura HMAC na saída; token e segredo na entrada | 3 e 4 |
| Dependências | Verificação de falhas conhecidas no CI | 1 |

## LGPD

- Consentimento por canal e finalidade, com origem e evidência; lista de supressão; opt-out respeitado antes de qualquer envio.
- Retenção configurável; exportação e anonimização de um titular como operações próprias e auditadas.
- A auditoria registra ator, empresa, ação, horário e objeto, sem guardar conteúdo sensível sem necessidade.
- A WTA passa a ser operadora dos dados de cada empresa cliente. Termos de uso e contrato de tratamento de dados dependem de revisão jurídica, fora do escopo do código.

## Segredos

Nenhum segredo entra no repositório, em documento ou em conversa. Este repositório é público no GitHub na data deste arquivo; a recomendação é torná-lo privado.

## Resposta a incidentes

A definir na Fase 8, em [`OPERATIONS.md`](OPERATIONS.md): quem é avisado, como revogar sessões e chaves de uma empresa, como suspender uma conta conectada e como comunicar os afetados.
