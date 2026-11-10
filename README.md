# INVOX — site oficial

Site de apresentação do INVOX, um sandbox multiplayer de criação por voz para Windows e Android. A página reúne recursos, modos competitivos e cooperativos, informações de acesso antecipado e espaço para os links oficiais de instalação.

O projeto preserva o layout roxo, o robô e as três fileiras animadas com 72 itens do catálogo. As animações podem ser pausadas no rodapé e respeitam a preferência de movimento reduzido do navegador.

**COLOCAR LINKS DOS BOTÕES:** abra **[LINKS-DOS-DOWNLOADS.ts](./LINKS-DOS-DOWNLOADS.ts)**, na raiz do site. Esse é o único arquivo para colocar os links de Windows e Android. [Como publicar as alterações](#links-de-download).

## Desenvolvimento

Requer Node.js 22.13 ou superior e npm.

```sh
npm ci
npm run dev
```

Abra `http://localhost:3000/invox-site/`. O prefixo faz parte da configuração de produção e também é usado durante o desenvolvimento.

## Verificação e exportação

```sh
npm run typecheck
npm run build
npm run verify
```

O build gera `out/` com HTML, CSS, JavaScript, fontes e imagens estáticos. Não exige servidor Node.js, banco de dados, Worker, variáveis secretas ou serviços do Sites. A verificação confere os 72 itens, os caminhos dos arquivos emitidos e o prefixo público usado pelos recursos.

## GitHub Pages

Endereço configurado: **https://jmxxp.github.io/invox-site/**.

O código-fonte pertence à branch `main` do repositório [Jmxxp/invox-site](https://github.com/Jmxxp/invox-site). **Depois de editar, fazer commit e sincronizar essa branch, o site é gerado e publicado automaticamente.** Isso inclui as alterações dos links de download.

O workflow [Publicar site do INVOX](./.github/workflows/publish-site.yml) usa Node.js 24, instala as versões fixadas, verifica o TypeScript, gera a exportação e confere os botões e recursos antes de publicar. Acompanhe o resultado na aba [Actions](https://github.com/Jmxxp/invox-site/actions/workflows/publish-site.yml). Aguarde a execução ficar verde antes de conferir o site. Também é possível iniciar a publicação por **Run workflow** nessa página.

O GitHub Pages está configurado com a origem **GitHub Actions**. O workflow usa somente ações oficiais, fixadas por SHA, e o token temporário fornecido pelo GitHub. Não coloque tokens ou senhas no repositório.

`out/` continua fora de `main`; somente o artefato estático validado é publicado. `.nojekyll` preserva o diretório `_next` na exportação. A branch `gh-pages` foi mantida como histórico e opção de recuperação, mas não é a origem ativa do site.

O comando local `npm run deploy` continua disponível como alternativa para gerar e enviar `out/` à antiga branch `gh-pages`. **Com a origem atual em GitHub Actions, esse comando sozinho não atualiza o site público.** Para a publicação normal, sincronize `main` ou use **Run workflow**; não altere a origem do Pages para publicar uma edição comum.

`basePath` e `assetPrefix` estão em `next.config.mjs`. O helper `assetPath`, em `lib/site-config.ts`, aplica o mesmo prefixo às imagens de `public/`. A fonte local Manrope é processada pelo `next/font/local`, com arquivos emitidos sob `_next/`.

## Links de download

Os dois links ficam em um único arquivo de código, separado e destacado na raiz: **[LINKS-DOS-DOWNLOADS.ts](./LINKS-DOS-DOWNLOADS.ts)**.

Cole os endereços públicos dos instaladores entre as aspas correspondentes:

```ts
export const LINK_DOWNLOAD_WINDOWS = "";
export const LINK_DOWNLOAD_ANDROID = "";
```

Use links completos começando com `https://` ou `http://`. Uma constante vazia mantém somente aquele botão desativado, com “Download em breve”. Quando preenchida, o botão passa a usar o endereço informado. A página importa essas duas constantes automaticamente; edite os links somente em `LINKS-DOS-DOWNLOADS.ts`. Os instaladores precisam estar hospedados em um endereço público; caminhos locais como `C:/...` não funcionam para os visitantes. Não inclua APKs ou instaladores neste repositório.

Após salvar, gere e confira o site:

```sh
npm run build
npm run verify
```

Para atualizar o site público, **faça commit e sincronize a branch `main`**. O GitHub Actions faz o build, valida os links e publica automaticamente. Apenas salvar o arquivo no computador ainda não envia a alteração.

## Organização

- `app/`: página, estilos e metadados.
- `LINKS-DOS-DOWNLOADS.ts`: único arquivo editável com os links dos botões Windows e Android.
- `app/page.tsx`: conteúdo da página e botões ligados às constantes do arquivo de links.
- `lib/`: configuração pública e as três fileiras do catálogo.
- `public/assets/`: imagens usadas pela página e pelos itens.
- `public/fonts/`: Manrope e sua licença.
- `scripts/verify-static.mjs`: verificação da exportação.

As versões de Next.js, React e demais dependências estão fixadas em `package.json` e `package-lock.json`.

## Direitos

Este é um repositório público de consulta, com direitos reservados conforme [LICENSE](./LICENSE). A visibilidade do código não concede uma licença de código aberto para o site, a marca ou o jogo. Componentes de terceiros continuam sujeitos às respectivas licenças, incluindo a [SIL Open Font License da Manrope](./public/fonts/manrope-OFL.txt).
