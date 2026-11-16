# INVOX — site oficial

Versão independente do site, criada nesta pasta a partir da referência visual fornecida. O projeto Next.js na raiz permanece separado.

## Abrir

Abra `index.html` no navegador. Não é necessário instalar dependências ou executar um build.

Para servir a pasta por HTTP, execute nela:

```sh
python -m http.server 4173
```

Depois acesse `http://localhost:4173`.

## Editar

- `index.html`: textos, navegação e estrutura.
- `styles.css`: layout, responsividade e efeitos de hover.
- `about.css`: seção sobre o jogo, recursos, modos e acesso antecipado.
- `config.js`: links oficiais dos downloads e redes sociais.
- `script.js`: menu, navegação e janelas de informação.
- `assets/`: imagens e fonte local.

Os links de Windows e Android foram preservados do projeto existente. macOS aguarda o endereço oficial: deixe `""` em `config.js` enquanto não houver um link. Esses botões mostram uma mensagem informativa. Para ativá-los, preencha o respectivo endereço completo com `https://` ou `http://`.

Os ícones são Font Awesome Free 7.1.0, distribuídos localmente em `assets/vendor/fontawesome/`, com a licença original. A seção de download contém Windows, macOS e Android.

Esta pasta pode ser hospedada como site estático. Salvar alterações aqui não publica uma nova versão do site na internet.

## Arte e verificação

A logo do cabeçalho e a marca principal usam `assets/brand-wordmark.png`, o arquivo oficial do projeto. Um filtro de apresentação retira visualmente o fundo preto do PNG, preservando as cores da marca.

O fundo exibido é `assets/hero-scene-hd.png`, regenerado pela ferramenta integrada de imagens a partir de `assets/hero-scene.png` para melhorar a definição e preservar a composição. A camada JPEG de baixa qualidade foi retirada da página. O arquivo final tem **1672 × 941 pixels**: a ferramenta manteve essas dimensões nas tentativas de ampliação; não é uma exportação 4K. O prompt da edição está em [assets/hero-hd-prompt.txt](assets/hero-hd-prompt.txt). A referência original e a primeira edição foram mantidas em `assets/`.

Os downloads têm três botões com cantos cortados, ícones de 44 px e títulos e subtítulos alinhados. A navegação “Sobre” leva à seção abaixo dos downloads. O texto resume a descrição fornecida, incluindo até 12 jogadores, recursos, três modos e acesso antecipado 1.0.0.

Scripts verificados quanto à sintaxe; referências de imagens, ícones e links conferidas. A página foi aberta no Chrome para conferência visual.

## Barra fixa e efeitos do lobby

`premium.css` e `effects.js` controlam a barra fixa, o gradiente da hero, os hovers e as entradas ao rolar. Os efeitos ficam sempre ativos, respeitando movimento reduzido do sistema; não há toggle nem preferência antiga que os desligue.

`lobby.js` e `lobby.css` adaptam o código original do INVOX: Casa (399 blocos), Robô (269) e Nave (273), em ciclos de 14 segundos. A comparação em `.qa/lobby-source-parity.json`, fora da pasta pública, confirmou todas as 941 coordenadas, cores, ordem e dimensões. Os materiais foram adaptados de Godot para WebGL2; igualdade visual pixel a pixel não foi certificada.

A animação ocupa toda a largura da seção, com câmera ampliada e canvas transparente. Não há card, títulos ou botões ao redor. Mova o mouse para separar os blocos; no canvas, as setas escolhem a forma e Espaço pausa. A renderização para fora da tela e em abas ocultas; WebGL2 é necessário, com apresentação estática alternativa.

Os cinco scripts passaram na verificação de sintaxe. Nesta revisão, a janela do navegador não disponibilizou geometria para a interação; a conferência visual ficou pendente.

A barra fixa usa glass translúcido com blur de 28 px. Os tópicos foram agrupados em Como funciona, Possibilidades, Modos de jogo e Acesso antecipado, com grades e alinhamentos responsivos.

## Montserrat e feedback

O site usa Montserrat variável (100–900), hospedada em assets/fonts/montserrat-variable.ttf com a licença OFL. A navegação tem uma única barra glass, sem faixa de slogan nem botões de redes sociais.

A seção Feedback fica no fim da página e é acessível pelo menu. feedback.css e feedback.js controlam os campos de nome, contato e mensagem. O botão prepara e valida o texto, mas não envia mensagens nem armazena dados. Nenhum backend ou endpoint foi adicionado.

## Busca e interação durante a rolagem

O título oficial é INVOX — Sua voz. Suas regras. A página inclui descrição, canonical, Open Graph, Twitter, dados estruturados WebSite/VideoGame e sitemap.xml. A URL de produção segue a já configurada no projeto: https://jmxxp.github.io/invox-site/. Se o domínio mudar, atualize o head e o sitemap. A indexação depende de publicação e rastreamento; não há garantia de posição no Google.

A interação 3D conserva a posição do mouse na janela e recalcula sua posição relativa ao canvas em cada frame, inclusive durante a rolagem. O teste .qa/lobby-scroll-cursor.cjs valida mouse parado, deslocamento do canvas, limites, barra fixa, perda de foco e propriedade do toque, sem alterar a geometria das formas.
