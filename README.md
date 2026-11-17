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

`out/` recebe o site na raiz e o painel em `admin/`. O GitHub Actions publica esse artefato após sincronizar `main`. O projeto Next.js anterior permanece no repositório; seus comandos estão em `dev:legacy`, `build:legacy` e `verify:legacy`.

## Supabase

A configuração pública está em `site-oficial/shared/invox-client.js`. A chave publishable pode estar no navegador; chaves secretas e senhas não devem entrar no repositório.

Feedbacks, acesso e instaladores passam pela função `invox-api`, já publicada. O painel exige autenticação e permissão administrativa no servidor. Consulte [supabase/README.md](supabase/README.md) para detalhes da implantação e migrações.

Os instaladores ficam em bucket privado. Mesmo em modo público, o servidor gera URLs de download válidas por 60 segundos. Em modo privado, verifica a senha antes de gerar a URL. Uma URL já emitida continua válida até expirar.

A versão inicial é 1.1.0. Publique os arquivos reais pelo painel; nenhum instalador de exemplo é criado. Os antigos links em `LINKS-DOS-DOWNLOADS.ts` pertencem à implementação anterior e não controlam mais o site oficial.

O painel abre em **Análises**, com visualizações e downloads iniciados por plataforma em Hoje, 7 dias, 30 dias e 12 meses, no horário de Brasília. Os dados começam na ativação da contagem e não recuperam acessos anteriores. `site-oficial/analytics.js` conta uma página visível por carregamento; testes locais não entram nas métricas.

O login administrativo permanece salvo entre sessões do navegador, até sair ou o acesso ser revogado. O acesso privado aos downloads pode ser lembrado por até 30 dias, usando um token; a senha não é gravada no navegador. Os botões de Windows, macOS e Android usam gradientes opacos roxo, azul e verde.

Marca e jogo seguem os direitos definidos em [LICENSE](LICENSE). Bibliotecas e fontes preservam suas próprias licenças.
