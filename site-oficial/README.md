# INVOX — site oficial

Interface oficial em Montserrat e roxo INVOX. O site e o painel usam o backend do Supabase por `shared/invox-client.js`.

## Desenvolvimento

Na raiz do repositório, execute `node scripts/serve-official.mjs`. Abra http://localhost:4173/invox-site/ e o painel em http://localhost:4173/invox-site/admin/. Para verificar o artefato, execute `node scripts/verify-official.mjs` após o build.

## Arquivos principais

- `index.html`, `styles.css`, `hero.css`, `about.css`, `premium.css`, `navigation.css`: layout, hero interativa e navegação com ícones e quinas cortadas.
- `script.js`, `downloads.css`, `integration.css`: plataformas, versões individuais dos instaladores, downloads e diálogo de senha.
- `feedback.js`, `feedback.css`: envio real de feedback.
- `shared/invox-client.js`: conexão pública, autenticação e chamadas ao servidor.
- `shared/vendor/`: Supabase JS 2.119.0 fixado, licença e hash verificado.
- `shared/vendor/tus.min.js`: transporte oficial TUS 4.3.1 para uploads grandes no painel, com chunks de 6 MiB, licença e hash verificado.
- `lobby.js`, `lobby.css`: blocos 3D e interação a cada frame durante a rolagem.
- `modes.js`, `modes.css`, `assets/modes/`: apresentações dos cinco modos reais do jogo. Os vídeos só rodam quando visíveis; com movimento reduzido ou falha de reprodução, os cards mantêm a imagem estática.

Os cards usam capturas nativas das cenas de seleção de modo do jogo, com os nomes Sandbox livre, Mata-mata, Pique-bandeira, Domínio e Parkour. A origem, o commit do jogo, os hashes e os parâmetros de exportação estão em `assets/modes/provenance.json`. A esfera de Parkour recebeu um ajuste nativo de tamanho e contraste, descrito em `assets/modes/parkour-marker-override.md`.

Os botões não usam mais os antigos links Mediafire. O servidor confere a liberação e gera uma URL curta de download. Os arquivos reais e a senha de acesso são administrados pelo painel. Falhas de conexão bloqueiam o download; não existe fallback público.

Cada botão permanece desativado até o servidor confirmar que existe instalador para a plataforma. A página reconsulta a disponibilidade ao receber foco ou voltar à aba.

A configuração inicial é 1.1.0. A disponibilidade depende de publicar instaladores reais e implantar o backend conforme `../supabase/README.md`. Salvar estes arquivos não cria o banco nem publica a função.

A marca usa o PNG oficial com filtro para retirar o fundo preto. A hero usa uma única instância da animação interativa de blocos, à direita do texto no desktop e abaixo dele no celular. A geometria das três formas preserva as 941 coordenadas verificadas do código original; materiais WebGL e enquadramento são adaptados ao navegador. A antiga arte `assets/hero-scene-3d.png` permanece apenas como imagem de compartilhamento; não é carregada como fundo da hero.

As fontes, os ícones e as bibliotecas mantêm suas licenças em `assets/` e `shared/vendor/`. A navegação, os efeitos e os blocos respeitam movimento reduzido.
