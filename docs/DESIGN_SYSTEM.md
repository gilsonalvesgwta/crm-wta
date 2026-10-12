# Design system

A interface sai inteira de tokens. É por eles que cada empresa troca a identidade sem tocar no código.

Situação em 12 de outubro de 2026: direção aprovada pelo responsável. Implementados em `apps/web`: tokens (`globals.css`), tema por empresa no primeiro HTML (`lib/theme.ts`), e os componentes botão, campo, seletor, aviso, painel, selo, confirmação e estados de tela (`components/ui`). Caixa de entrada e Kanban seguem a prévia nas Fases 2 e 4.

## Marca padrão da WTA

| Token | Valor | Uso |
| --- | --- | --- |
| Azul WTA | `#051628` | Menu lateral, texto principal no tema claro, fundo no tema escuro |
| Laranja WTA | `#FF6600` | Ação primária, item ativo, foco, indicadores |
| Texto sobre o laranja | `#051628` | Contraste de 6,2:1. Branco sobre o laranja dá 2,9:1 e não é usado em texto |
| Laranja para texto no claro | `#B84300` | Links e destaques sobre fundo branco, 5,5:1 |
| Laranja para texto no escuro | `#FF8A3D` | Links e destaques sobre o azul |

O logo da WTA foi vetorizado e está em [`packages/ui/brand/wta`](../packages/ui/brand/wta/README.md): versões para fundo escuro e claro, só a marca, e ícone compacto para favicon.

## Direção visual

| Aspecto | Definição |
| --- | --- |
| Superfícies | Três níveis: fundo, superfície e superfície elevada. Separação por borda de 1 px; sombra só em menus, pop-ups e modais |
| Cor de marca | Uma. Aparece em botão primário, item ativo, foco e links |
| Cores de estado | Sucesso, alerta, erro e informação, separadas da marca e com significado fixo |
| Canais | WhatsApp, Instagram e e-mail têm ícone e cor constantes em todas as telas |
| Tipografia | Geist (pacote `geist`, sem depender de rede no build), pesos 400, 500 e 600, com algarismos tabulares. Texto de trabalho em 14 px; 12 px só para metadados |
| Espaçamento | Base de 4 px, ritmo de 8. Raio de 6 px em controles e 10 px em painéis |
| Densidade | Confortável por padrão e compacta por preferência do usuário |
| Ícones | Uma família só, traço de 1,75, em 16 e 18 px. Nenhum emoji no lugar de ícone |
| Movimento | 120 a 180 ms, apenas em mudança de estado. Desligado quando o sistema pede menos animação |

## Tokens

| Camada | Exemplos | Quem altera |
| --- | --- | --- |
| Primitivos | Cores fixas do tema claro e escuro em `globals.css` | O sistema |
| Semânticos | `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`, `--primary`, `--primary-fg`, `--focus-ring`, `--success`, `--warning`, `--danger`, `--info` | O tema da empresa |
| De componente | `--button-radius`, `--sidebar-bg`, `--table-row-height` | O sistema; poucos ficam expostos à empresa |

Os componentes só leem tokens semânticos e de componente. Nenhum componente cita uma cor diretamente.

## Tema por empresa

1. A empresa define nome do produto, logos, favicon, cores, superfícies, texto e o modo padrão.
2. O sistema escolhe o texto sobre a cor (o mais legível, com 4,5:1 ou mais) e deriva tons de destaque com 4,5:1 sobre o fundo claro e o escuro, usados em links e no anel de foco.
3. Cor sem texto legível ou que quase não aparece contra o fundo do tema escolhido é recusada, com a explicação.
4. A tela mostra a pré-visualização antes de salvar e tem "restaurar padrão".
5. O tema é gravado como JSON validado em `tenant_branding`, com a versão anterior guardada.
6. O servidor injeta as variáveis CSS já no primeiro HTML, conforme a empresa da sessão ou o domínio.
7. Logos e favicon ficam no prefixo de arquivos da empresa (com o armazenamento de arquivos, na Fase 2).
8. Empresa com marca própria tem o menu lateral neutro; a marca aparece nos destaques e no nome do produto.

As cores de estado aceitam ajuste de tom dentro de uma faixa que preserva o significado e o contraste.

## Estados de tela

| Estado | Como aparece |
| --- | --- |
| Carregamento | Esqueleto com a forma do conteúdo |
| Vazio | O que é aquela área e a ação principal para começar |
| Erro | O que aconteceu, em linguagem simples, e "tentar de novo" |
| Sem permissão | Explicação e a quem pedir acesso |
| Busca sem resultado | O termo buscado e como limpar os filtros |
| Operação em andamento | Botão com progresso e bloqueado contra clique duplo |
| Operação assíncrona | Progresso e aviso ao terminar |
| Sucesso | Aviso discreto, com "desfazer" quando a ação permite |
| Ação destrutiva | Confirmação que diz o que será perdido; nas graves, digitar o nome do registro |

## Acessibilidade

WCAG 2.2 nível AA. Verificação automática com axe em todas as telas, dentro dos testes de ponta a ponta. Contraste validado em cada tema salvo.
