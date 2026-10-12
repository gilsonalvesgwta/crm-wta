# Design system

A interface sai inteira de tokens. É por eles que cada empresa troca a identidade sem tocar no código.

Situação em 11 de outubro de 2026: a direção abaixo foi entregue como prévia de quatro telas (login, início, caixa de entrada e Kanban) e **aguarda aprovação**. Nenhum componente foi implementado no repositório.

## Marca padrão da WTA

| Token | Valor | Uso |
| --- | --- | --- |
| Azul WTA | `#051628` | Menu lateral, texto principal no tema claro, fundo no tema escuro |
| Laranja WTA | `#FF6600` | Ação primária, item ativo, foco, indicadores |
| Texto sobre o laranja | `#051628` | Contraste de 6,2:1. Branco sobre o laranja dá 2,9:1 e não é usado em texto |
| Laranja para texto no claro | `#B84300` | Links e destaques sobre fundo branco, 5,5:1 |
| Laranja para texto no escuro | `#FF8A3D` | Links e destaques sobre o azul |

O logo da WTA tem a marca em laranja e a assinatura "Gestão e Automações" em branco. A versão completa só funciona sobre fundo escuro; em fundo claro usa-se só a marca. Falta o arquivo vetorial.

## Direção visual

| Aspecto | Definição |
| --- | --- |
| Superfícies | Três níveis: fundo, superfície e superfície elevada. Separação por borda de 1 px; sombra só em menus, pop-ups e modais |
| Cor de marca | Uma. Aparece em botão primário, item ativo, foco e links |
| Cores de estado | Sucesso, alerta, erro e informação, separadas da marca e com significado fixo |
| Canais | WhatsApp, Instagram e e-mail têm ícone e cor constantes em todas as telas |
| Tipografia | Geist, pesos 400, 500 e 600, com algarismos tabulares em tabelas e valores. Texto de trabalho em 14 px; 12 px só para metadados |
| Espaçamento | Base de 4 px, ritmo de 8. Raio de 6 px em controles e 10 px em painéis |
| Densidade | Confortável por padrão e compacta por preferência do usuário |
| Ícones | Uma família só, traço de 1,75, em 16 e 18 px. Nenhum emoji no lugar de ícone |
| Movimento | 120 a 180 ms, apenas em mudança de estado. Desligado quando o sistema pede menos animação |

## Tokens

| Camada | Exemplos | Quem altera |
| --- | --- | --- |
| Primitivos | Escalas de cinza e de marca, geradas a partir da cor escolhida | O sistema |
| Semânticos | `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`, `--primary`, `--primary-fg`, `--focus-ring`, `--success`, `--warning`, `--danger`, `--info` | O tema da empresa |
| De componente | `--button-radius`, `--sidebar-bg`, `--table-row-height` | O sistema; poucos ficam expostos à empresa |

Os componentes só leem tokens semânticos e de componente. Nenhum componente cita uma cor diretamente.

## Tema por empresa

1. A empresa define nome do produto, logos, favicon, cores, superfícies, texto e o modo padrão.
2. O sistema gera as escalas e o par claro e escuro, e calcula o contraste de cada combinação usada.
3. Combinação abaixo de 4,5:1 para texto ou 3:1 para controles é recusada, com a sugestão do tom mais próximo que passa.
4. A tela mostra a pré-visualização antes de salvar e tem "restaurar padrão".
5. O tema é gravado como JSON validado em `tenant_branding`, com a versão anterior guardada.
6. O servidor injeta as variáveis CSS já no primeiro HTML, conforme a empresa da sessão ou o domínio.
7. Logos e favicon ficam no prefixo de arquivos da empresa.

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
