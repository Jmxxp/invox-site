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

Os testes automatizados usam respostas simuladas. O backend também foi implantado e validado no Supabase em 17/11/2026, incluindo login, feedbacks, upload e downloads públicos ou protegidos por senha.

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
