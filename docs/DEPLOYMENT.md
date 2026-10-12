# Implantação

Nada foi instalado em nenhuma VPS. O plano é uma stack nova e isolada, sem porta publicada, que não toca em rede, volume ou serviço existente, e que sai inteira com a remoção de uma única stack.

## Inventário

Antes de qualquer instalação, o responsável roda `deploy/inventario.sh` na VPS e envia a saída. O script só lê. A sintaxe foi validada; os comandos do Docker não foram executados no ambiente de desenvolvimento, que não tem serviço Docker.

Não enviar a saída de `docker service inspect`, variáveis de ambiente nem arquivos de stack: é neles que ficam as senhas.

Ainda desconhecido: CPU, memória e disco livres; versão e modo da Evolution API e para onde os webhooks das instâncias apontam; versão do n8n; se já existe Redis ou armazenamento de objetos; rotina atual de backup; regras de firewall.

## Topologia

Os valores de memória são estimativas para dimensionar, não medições.

| Serviço | Rede | Volume | Memória reservada | Limite |
| --- | --- | --- | --- | --- |
| `web` | Traefik e interna | | 256 MB | 512 MB |
| `api` | Traefik e interna | | 256 MB | 512 MB |
| `worker` | Interna | | 256 MB | 768 MB |
| `db` | Interna | `crmwta_db` | 512 MB | 1,5 GB |
| `redis` | Interna | `crmwta_redis` | 64 MB | 256 MB |
| `migrate` | Interna | | Termina após rodar | |
| `backup` | Interna | `crmwta_backup` | 64 MB | 256 MB |

Cerca de 1,4 GB reservados e 3,8 GB de teto. Daí o corte de 4 GB livres para decidir entre a VPS atual e uma dedicada.

Regras da stack:

- Nenhuma seção `ports`. Só `web` e `api` levam rótulos do Traefik.
- Banco e Redis em rede overlay criada pela própria stack. A rede existente do Traefik é apenas usada, nunca recriada.
- Serviços, rede e volumes com prefixo `crmwta`.
- Senhas e chaves como segredos do Docker.
- Limite de memória e de CPU em todo serviço.
- Atualização com o contêiner novo no ar antes de parar o antigo, e retorno automático se a verificação de saúde falhar.
- Imagens promovidas por digest: a produção recebe exatamente a imagem aprovada em homologação.

## Sequência

1. Inventário e análise. **Aprovação: VPS atual ou dedicada.**
2. Endereço de homologação no DNS.
3. Se for a VPS atual, snapshot no provedor antes da primeira instalação.
4. Stack de homologação no Portainer, com o arquivo e a lista de segredos deste repositório.
5. Verificação: saúde, certificado, login e suíte de fumaça.
6. Conferência dos vizinhos: mesma lista de serviços e réplicas do inventário.
7. Ensaio de backup, restauração e rollback em homologação.
8. Produção, com a mesma imagem. **Aprovação e janela definidas pelo responsável.**
9. Acompanhamento de 48 horas.

## Reversão

| Situação | Ação | Efeito nos outros sistemas |
| --- | --- | --- |
| A stack não sobe | Remover a stack do CRM | Nenhum |
| Versão nova com defeito | Voltar ao digest anterior | Nenhum |
| Migração com problema | As migrações são aditivas: a imagem anterior funciona com o esquema novo. Em último caso, restaurar o backup tirado antes | Nenhum |
| A VPS fica pressionada | Reduzir o worker a zero e, se preciso, a stack inteira | Nenhum |

Remoção de coluna ou tabela nunca vai na mesma versão que deixa de usá-la.

## O que não acontece sem autorização explícita

Remover, substituir ou reiniciar serviço existente; apagar volume; qualquer `prune`; recriar rede em uso; alterar firewall, DNS ou configuração do Traefik; reiniciar o Docker ou a VPS; publicar porta interna; alterar webhook de instância da Evolution ou fluxo do n8n; migração destrutiva.
