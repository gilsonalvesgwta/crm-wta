# Implantação

A stack do CRM é isolada: banco, API, interface e cópia diária próprios, sem porta publicada, sem tocar em rede, volume ou serviço existente. Ela sai inteira com a remoção de uma única stack.

Situação: a stack é testada a cada envio no CI, em amd64 e em arm64, num Docker Swarm descartável com um Traefik configurado como o da VPS (`deploy/teste-stack.sh`). **Ainda não foi instalada.** O inventário foi feito em 12 de outubro de 2026; a instalação aguarda a aprovação do plano abaixo.

## O que a stack contém

| Serviço | Imagem | Rede | Função |
| --- | --- | --- | --- |
| `db` | `postgres:18` | interna | Banco dedicado do CRM, volume `crmwta_db` |
| `migrate` | imagem da API | interna | Aplica migrações, cria o papel de login da API e, na primeira vez, a empresa WTA e o superadministrador. Termina (0/1) |
| `api` | imagem da API | interna e Traefik | API em `https://<domínio>/api`; arquivos enviados no volume `crmwta_arquivos`; lembretes e importações em segundo plano |
| `web` | imagem da interface | interna e Traefik | Interface em `https://<domínio>` |
| `backup` | imagem da API | interna | Cópia diária do banco às 03:30, volume `crmwta_backup` |

Limites de memória: banco 1,5 GB; API, interface 512 MB cada; migração e cópia 256 MB. Soma dos limites: 3 GB. A API fica no nó gerente, junto do volume de arquivos.

## Inventário (antes de instalar)

O responsável roda `deploy/inventario.sh` na VPS e envia a saída. O script só lê e não mostra variáveis, segredos nem arquivos de stack.

Resultado de 12 de outubro de 2026 (VPS `Wtatechor3`):

| Item | Valor | Consequência para o CRM |
| --- | --- | --- |
| Sistema | Ubuntu 24.04, Oracle, **ARM (aarch64)** | Imagens publicadas também para arm64 (ADR 025) |
| Recursos | 4 núcleos, 23 GB de memória (15 GB disponíveis), 152 GB de disco livres, sem swap | Folga para os 3 GB de limite da stack |
| Docker | 29.9, Swarm ativo com um nó | Stack do Swarm, como as outras |
| Traefik | v3.5.3, provedor `docker`, rede `Wtatechor3Net`, entradas `web` (80) e `websecure` (443), resolvedor `letsencryptresolver` por desafio HTTP | Rótulos no contêiner e no serviço; valores padrão da stack já batem |
| Portas abertas | 22, 80, 443 e as do Swarm | A stack não publica porta |
| Bancos existentes | `postgres:14`, `pgvector:pg16`, Supabase | Não são usados nem alterados; o CRM tem o próprio PostgreSQL 18 |
| Outros | Evolution API, Evolution Go, n8n, MinIO, Portainer, Appsmith, Evo CRM; `bolt` parado (0/1) | Nenhum é alterado |

## Plano de instalação em crm.wtatech.com.br

Aguarda aprovação. Ambiente definitivo, usado também para os testes (decisão de 12 de outubro de 2026).

| Pergunta | Resposta |
| --- | --- |
| O que muda | Uma stack nova, `crmwta`, com cinco serviços e três volumes novos (`crmwta_db`, `crmwta_backup`, `crmwta_arquivos`); cinco segredos novos `crmwta_*`; um registro DNS `crm`. A stack entra na rede `Wtatechor3Net` só com `web` e `api` |
| Motivo | Colocar o CRM no ar para uso e testes reais |
| Impacto nos outros sistemas | Nenhuma configuração existente é tocada: Traefik, rede, Evolution, n8n, bancos e volumes ficam como estão. O Traefik passa a ver dois roteadores novos, só para `crm.wtatech.com.br`. Consumo previsto: até 3 GB de memória, de 15 GB livres |
| Backup disponível | Antes de instalar: snapshot da VPS no painel da Oracle (recomendado). Depois: cópia diária do banco do CRM às 03:30, já testada |
| Plano de reversão | Remover a stack `crmwta` no Portainer. Os outros serviços não percebem. Volumes e segredos do CRM ficam até serem apagados de propósito |

Passos:

1. **DNS** (você): no Cloudflare, registro A `crm` para o IP da VPS, com a mesma opção de proxy dos outros endereços que já funcionam com esse Traefik.
2. **Versão** (eu): mesclar a Fase 2 no `main`; o CI publica as imagens amd64 e arm64 com uma versão fixa.
3. **Segredos** (você, com o roteiro): na VPS, `curl` do `deploy/criar-segredos.sh` e `sudo bash criar-segredos.sh`. O script pede a senha da caixa de e-mail e mostra uma única vez a chave mestra e a senha inicial do administrador. Guarde as duas num cofre de senhas, fora da VPS.
4. **Stack** (você, no Portainer): Stacks > Add stack, nome `crmwta`, colar `deploy/stack.yml` e preencher as variáveis da tabela do roteiro, com `DOMINIO=crm.wtatech.com.br`, `REDE_TRAEFIK=Wtatechor3Net` e o e-mail da Hostinger.
5. **Conferência** (juntos): `https://crm.wtatech.com.br/api/readyz` responde; certificado válido; login com a senha inicial; os serviços da VPS com as mesmas réplicas de antes.
6. **Primeiro acesso** (você): trocar a senha, ativar a verificação em duas etapas e apagar `BOOTSTRAP_EMAIL` das variáveis da stack.

## Roteiro de instalação

Cada passo marcado com **aprovação** espera o seu sinal.

1. **Inventário e decisão** (aprovação): VPS atual ou dedicada, endereços de produção e de homologação.
2. **DNS**: no Cloudflare, um registro A do endereço escolhido para o IP da VPS.
3. **Snapshot**: se for a VPS atual, um snapshot no provedor antes de começar.
4. **Imagens**: o CI publica no registro do GitHub, para amd64 e arm64, a cada mesclagem no `main`. A versão aparece no resumo do CI no formato `AAAA.MM.DD-<commit>`. Se o repositório virar privado, a VPS precisa de um token de leitura de pacotes.
5. **Segredos**: na VPS, como root, `bash deploy/criar-segredos.sh`. O script cria cinco segredos e mostra **uma única vez** a chave mestra e a senha inicial do superadministrador. Guarde as duas num cofre de senhas, fora da VPS.
6. **Stack**: no Portainer, Stacks > Add stack, nome `crmwta`, conteúdo de `deploy/stack.yml`, e as variáveis:

   | Variável | Exemplo | Observação |
   | --- | --- | --- |
   | `DOMINIO` | `crm.wtatech.com.br` | O endereço do passo 2 |
   | `REDE_TRAEFIK` | `Wtatechor3Net` | A rede do Traefik existente, conferida no inventário |
   | `IMAGEM_API` | `ghcr.io/gilsonalvesgwta/crm-wta-api:<versão>` | Sempre uma versão fixa, nunca `latest` |
   | `IMAGEM_WEB` | `ghcr.io/gilsonalvesgwta/crm-wta-web:<versão>` | A mesma versão da API |
   | `BOOTSTRAP_EMAIL` | o seu e-mail | Só na primeira implantação |
   | `BOOTSTRAP_NAME` | o seu nome | Só na primeira implantação |
   | `ENTRADA_TRAEFIK` | `websecure` | Opcional; é o padrão |
   | `RESOLVEDOR_TLS` | `letsencryptresolver` | Opcional; é o padrão |
   | `MAIL_MODE`, `SMTP_*` | | E-mails do sistema (convites, nova senha). Sem eles, os e-mails não saem |

   E-mail do sistema pela Hostinger (caixa definida pelo responsável em 12 out 2026):

   | Variável | Valor |
   | --- | --- |
   | `MAIL_MODE` | `smtp` |
   | `SMTP_HOST` | `smtp.hostinger.com` |
   | `SMTP_PORT` | `465` (TLS desde a conexão) |
   | `SMTP_USER` | o endereço completo da caixa |
   | `SMTP_FROM` | `Nome <mesmo endereço da caixa>`; a Hostinger recusa remetente diferente da caixa autenticada |

   A senha da caixa não vai em variável: é o segredo `crmwta_smtp_pass`, pedido por `deploy/criar-segredos.sh`. Para que os e-mails não caiam no spam, o domínio precisa dos registros SPF, DKIM e DMARC que a Hostinger indica no painel do e-mail.

7. **Conferência**: os serviços `db`, `api`, `web` e `backup` em 1/1, `migrate` em 0/1 com "migrate: concluído" no registro; `https://<domínio>/api/readyz` responde; o login funciona com a senha inicial.
8. **Primeiro acesso**: entre, troque a senha e ative a verificação em duas etapas.
9. **Vizinhos**: a mesma lista de serviços e réplicas do inventário, e o consumo dentro do esperado.
10. **Ensaio**: cópia, restauração e retorno de versão em homologação.
11. **Produção** (aprovação): mesma imagem, janela definida por você.

## Atualização

Trocar `IMAGEM_API` e `IMAGEM_WEB` para a versão nova e atualizar a stack. O contêiner novo sobe antes de o antigo parar; se a verificação de saúde falhar, o Swarm volta sozinho para a versão anterior. O serviço `migrate` roda de novo e aplica só as migrações novas.

## Reversão

| Situação | Ação | Efeito nos outros sistemas |
| --- | --- | --- |
| A stack não sobe | Remover a stack `crmwta` | Nenhum. Os volumes ficam até serem apagados de propósito |
| Versão nova com defeito | Voltar `IMAGEM_API` e `IMAGEM_WEB` para a versão anterior | Nenhum |
| Migração com problema | As migrações são aditivas: a imagem anterior funciona com o esquema novo. Em último caso, restaurar a cópia tirada antes | Nenhum |
| A VPS fica pressionada | Reduzir `web` e `api` a zero | Nenhum |

Remoção de coluna ou tabela nunca vai na mesma versão que deixa de usá-la.

## O que não acontece sem autorização explícita

Remover, substituir ou reiniciar serviço existente; apagar volume; qualquer `prune`; recriar rede em uso; alterar firewall, DNS ou configuração do Traefik; reiniciar o Docker ou a VPS; publicar porta interna; alterar webhook de instância da Evolution ou fluxo do n8n; migração destrutiva.
