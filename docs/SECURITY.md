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

Testes de mutação feitos em 11 de outubro de 2026 sobre a migração 0001: doze alterações indevidas (RLS desligado, política permissiva, concessão de leitura da senha, função aberta, chave estrangeira simples, auditoria alterável, entre outras) foram aplicadas uma a uma, e os testes falharam em todas.

Camada de aplicação, Fase 1, conferida por `apps/api/test` e `apps/web/e2e`:

- Senhas com Argon2id (19 MiB, 2 passadas). Regra: 10 caracteres ou mais, recusa as mais comuns e as que contêm o e-mail.
- Login com resposta e tempo iguais para e-mail inexistente e senha errada.
- Bloqueio progressivo: 5 falhas no e-mail, 1 minuto; 8 falhas, 15 minutos; 30 falhas no IP, 15 minutos. Contado no banco.
- Sessão no servidor, revogável, em cookie `httpOnly`, `Secure`, `SameSite=Lax`. Trocar ou redefinir a senha encerra as outras sessões.
- CSRF: toda mutação exige o cabeçalho `x-crm-request`, que um site de terceiros não envia sem CORS.
- 2FA por TOTP (RFC 6238), segredo cifrado com AES-256-GCM e chave fora do banco; 10 códigos de recuperação de uso único. Áreas administrativas e a plataforma só abrem com o código confirmado na sessão; administrador não desliga.
- Consultas sempre parametrizadas; entradas validadas por esquema.
- Cabeçalhos: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Cache-Control: no-store` na API.
- Registros em JSON em produção, sem senha, token ou corpo de requisição.
- Imagens rodam como usuário sem privilégios; stack sem portas publicadas; segredos do Docker.

## O que está planejado

| Tema | Controle | Fase |
| --- | --- | --- |
| XSS | Política de conteúdo (CSP); HTML de e-mail sanitizado e exibido em quadro isolado | 2 e 5 |
| Limite de taxa geral | Por IP, usuário e chave de API, com Redis | 3 |
| Credenciais de integrações | AES-256-GCM; chave mestra em segredo do Docker, fora do banco, com identificador para rotação | 3 |
| Arquivos | Tipo conferido pelo conteúdo, limite de tamanho, nome aleatório, URL assinada de curta duração | 2 |
| Webhooks | Assinatura HMAC na saída; token e segredo na entrada | 3 e 4 |

## LGPD

- Consentimento por canal e finalidade, com origem e evidência; lista de supressão; opt-out respeitado antes de qualquer envio.
- Retenção configurável; exportação e anonimização de um titular como operações próprias e auditadas.
- A auditoria registra ator, empresa, ação, horário e objeto, sem guardar conteúdo sensível sem necessidade.
- A WTA passa a ser operadora dos dados de cada empresa cliente. Termos de uso e contrato de tratamento de dados dependem de revisão jurídica, fora do escopo do código.

## Segredos

Nenhum segredo entra no repositório, em documento ou em conversa. Este repositório é público no GitHub na data deste arquivo; a recomendação é torná-lo privado.

## Resposta a incidentes

A definir na Fase 8, em [`OPERATIONS.md`](OPERATIONS.md): quem é avisado, como revogar sessões e chaves de uma empresa, como suspender uma conta conectada e como comunicar os afetados.
