# Implantação

A stack do CRM é isolada: banco, API, interface e cópia diária próprios, sem porta publicada, sem tocar em rede, volume ou serviço existente. Ela sai inteira com a remoção de uma única stack.

Situação: a stack é testada a cada envio no CI, num Docker Swarm descartável com um Traefik igual ao da VPS (`deploy/teste-stack.sh`). **Ainda não foi instalada em nenhuma VPS.** A instalação depende do inventário e da sua aprovação.

## O que a stack contém

| Serviço | Imagem | Rede | Função |
| --- | --- | --- | --- |
| `db` | `postgres:18` | interna | Banco dedicado do CRM, volume `crmwta_db` |
| `migrate` | imagem da API | interna | Aplica migrações, cria o papel de login da API e, na primeira vez, a empresa WTA e o superadministrador. Termina (0/1) |
| `api` | imagem da API | interna e Traefik | API em `https://<domínio>/api` |
| `web` | imagem da interface | interna e Traefik | Interface em `https://<domínio>` |
| `backup` | imagem da API | interna | Cópia diária do banco às 03:30, volume `crmwta_backup` |

Limites de memória: banco 1,5 GB; API, interface 512 MB cada; migração e cópia 256 MB. Soma dos limites: 3 GB.

## Inventário (antes de instalar)

O responsável roda `deploy/inventario.sh` na VPS e envia a saída. O script só lê. Não enviar a saída de `docker service inspect`, variáveis de ambiente nem arquivos de stack: é neles que ficam as senhas.

Ainda desconhecido: CPU, memória e disco livres; versão e modo da Evolution API e para onde os webhooks das instâncias apontam; versão do n8n; rotina atual de backup; regras de firewall.

## Roteiro de instalação

Cada passo marcado com **aprovação** espera o seu sinal.

1. **Inventário e decisão** (aprovação): VPS atual ou dedicada, endereços de produção e de homologação.
2. **DNS**: no Cloudflare, um registro A do endereço escolhido para o IP da VPS.
3. **Snapshot**: se for a VPS atual, um snapshot no provedor antes de começar.
4. **Imagens**: as imagens são publicadas pelo CI no registro do GitHub quando a Fase 1 for mesclada. Se o repositório for privado, a VPS precisa de um token de leitura de pacotes.
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
