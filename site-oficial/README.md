# INVOX — site oficial

Interface oficial em Montserrat e roxo INVOX. O site e o painel usam o backend do Supabase por `shared/invox-client.js`.

## Desenvolvimento

Na raiz do repositório, execute `node scripts/serve-official.mjs`. Abra http://localhost:4173/invox-site/ e o painel em http://localhost:4173/invox-site/admin/. Para verificar o artefato, execute `node scripts/verify-official.mjs` após o build.

## Arquivos principais

- `index.html`, `styles.css`, `about.css`, `premium.css`, `navigation.css`: layout, conteúdo e navegação com ícones e quinas cortadas.
- `script.js`, `downloads.css`, `integration.css`: plataformas, versões individuais dos instaladores, downloads e diálogo de senha.
- `feedback.js`, `feedback.css`: envio real de feedback.
- `shared/invox-client.js`: conexão pública, autenticação e chamadas ao servidor.
- `shared/vendor/`: Supabase JS 2.119.0 fixado, licença e hash verificado.
- `lobby.js`, `lobby.css`: blocos 3D e interação a cada frame durante a rolagem.

Os botões não usam mais os antigos links Mediafire. O servidor confere a liberação e gera uma URL curta de download. Os arquivos reais e a senha de acesso são administrados pelo painel. Falhas de conexão bloqueiam o download; não existe fallback público.

A configuração inicial é 1.1.0. A disponibilidade depende de publicar instaladores reais e implantar o backend conforme `../supabase/README.md`. Salvar estes arquivos não cria o banco nem publica a função.

A marca usa o PNG oficial com filtro para retirar o fundo preto. A hero usa `assets/hero-scene-3d.png`, arte raster com acabamento de render 3D gerada pela ferramenta integrada a partir da composição anterior; o prompt está em `assets/hero-3d-prompt.txt`. A passagem da imagem para o fundo e o gradiente lateral são controlados por CSS, assim como os ícones e divisores da faixa de recursos. A geometria das três formas do lobby preserva as 941 coordenadas verificadas do código original; materiais WebGL são uma adaptação.

As fontes, os ícones e as bibliotecas mantêm suas licenças em `assets/` e `shared/vendor/`. A navegação, os efeitos e os blocos respeitam movimento reduzido.
