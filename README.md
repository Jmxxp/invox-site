# INVOX — Sua voz. Suas regras.

Site oficial em `site-oficial/`, painel em `painel-admin/` e backend em `supabase/`. A interface usa Montserrat e Font Awesome locais.

## Gerar e conferir

Requer Node.js 22.13 ou superior. O build oficial usa somente módulos nativos, sem instalar dependências.

```sh
node scripts/test-official.mjs
node scripts/build-official.mjs
node scripts/verify-official.mjs
node scripts/serve-official.mjs
```

As migrações aditivas `20261117193242_invox_game_feedback.sql` e `20261117194103_invox_game_announcements.sql` e a função Edge `invox-api` versão 6 já estão implantadas no projeto INVOX em 17/11/2026. O teste SQL com rollback confirmou campos e restrições de acesso. Um teste HTTPS real usando os clientes Godot passou em sete verificações: consulta do estado da plataforma e dois envios, um feedback e uma sugestão, gravados com `source=game` e contato nulo. Somente os dois registros temporários identificados foram removidos depois. Nenhum recado real foi publicado pelo teste.

Após integrar multipart, Realtime e versões independentes, os 24 testes locais e 14 verificações adicionais passaram. O artefato passou na conferência de 83 arquivos e 63 referências. Site e painel foram publicados no GitHub Pages pelo commit `b2b0326`, com Actions aprovado e cinco recursos públicos conferidos por HTTPS. A função mesclada foi implantada como versão 8 e `game-state` respondeu corretamente. As tabelas do jogo continuam com RLS e sem leitura direta de visitantes. Login administrativo visual no navegador e download/instalação real no Android não foram repetidos neste lote.

As proteções do backend incluem limite JSON de 32 KiB, prazo de 5 s para receber o corpo, prazo de 15 s nas chamadas ao Supabase, limite de requisições simultâneas por instância e controles de frequência para consultas públicas, downloads e administração. O estado público usa cache interno de 2 s em produção, invalidado por alterações administrativas; respostas e dados privados continuam sem cache no navegador. Downloads validam versão, manifesto, bucket e origem antes de emitir um link temporário. O frontend preparado restringe scripts e conexões com CSP, preservando estilos dinâmicos e o login existente. Não se trata de uma certificação contra toda invasão.

Site: http://localhost:4173/invox-site/
Painel: http://localhost:4173/invox-site/admin/

`out/` recebe o site na raiz e o painel em `admin/`. O GitHub Actions publica esse artefato após sincronizar `main`.

Os aplicativos ativos são `site-oficial/` e `painel-admin/`. `supabase/` contém o backend; `scripts/`, `tests/` e `.github/` mantêm a geração, a verificação e a publicação. O projeto usa apenas Node.js nativo para essas tarefas, sem dependências npm.

## Supabase

A configuração pública está em `site-oficial/shared/invox-client.js`. A chave publishable pode estar no navegador; chaves secretas e senhas não devem entrar no repositório.

Feedbacks, acesso e instaladores passam pela função `invox-api`, já publicada. O painel exige autenticação e permissão administrativa no servidor. Consulte [supabase/README.md](supabase/README.md) para detalhes da implantação e migrações.

O Realtime atualiza feedbacks, gráficos, acesso e versões no painel e a disponibilidade dos instaladores no site. Eventos apenas invalidam a tela; os dados continuam vindo da API. O canal administrativo é privado e exige a allowlist. Reconexão recupera alterações, sem apagar rascunhos ou interromper downloads.

Os instaladores ficam em bucket privado. Mesmo em modo público, o servidor gera URLs de download válidas por 60 segundos. Em modo privado, verifica a senha antes de gerar a URL. Uma URL já emitida continua válida até expirar.

A versão inicial é 1.1.0. Publique os arquivos reais pelo painel; nenhum instalador de exemplo é criado. Instaladores, versões e acesso são gerenciados pelo painel administrativo.

Windows, macOS e Android têm versões independentes. O painel permite editar a versão publicada sem reenviar o arquivo e consultar o histórico de publicações com data e horário de Brasília.

O painel abre em **Análises**, com visualizações e downloads iniciados por plataforma em Hoje, 7 dias, 30 dias e 12 meses, no horário de Brasília. Os dados começam na ativação da contagem e não recuperam acessos anteriores. `site-oficial/analytics.js` conta uma página visível por carregamento; testes locais não entram nas métricas.

O login administrativo permanece salvo entre sessões do navegador, até sair ou o acesso ser revogado. O acesso privado aos downloads pode ser lembrado por até 30 dias, usando um token; a senha não é gravada no navegador. Os botões de Windows, macOS e Android usam gradientes translúcidos brilhantes roxo, azul e verde.

Marca e jogo seguem os direitos definidos em [LICENSE](LICENSE). Bibliotecas e fontes preservam suas próprias licenças.
