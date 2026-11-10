# INVOX — site oficial

Site de apresentação do INVOX, um sandbox multiplayer de criação por voz para Windows e Android. A página reúne recursos, modos competitivos e cooperativos, informações de acesso antecipado e espaço para os links oficiais de instalação.

O projeto preserva o layout roxo, o robô e as três fileiras animadas com 72 itens do catálogo. As animações podem ser pausadas no rodapé e respeitam a preferência de movimento reduzido do navegador.

**COLOCAR LINKS DOS BOTÕES:** edite [LINKS-DOWNLOAD.json](./LINKS-DOWNLOAD.json), na raiz. O atalho [EDITAR-LINKS.cmd](./EDITAR-LINKS.cmd) abre esse arquivo diretamente. `windows` controla o botão Windows; `android` controla o botão Android. [Como publicar as alterações](#links-de-download).

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

O código-fonte pertence à branch `main` do repositório [Jmxxp/invox-site](https://github.com/Jmxxp/invox-site). Após enviar o código para essa branch, publique a exportação estática com uma conta autorizada no repositório:

```sh
npm run deploy
```

O passo `predeploy` verifica o TypeScript, executa o build e valida os arquivos estáticos; `gh-pages` envia o conteúdo de `out/`, incluindo `.nojekyll`, para a branch `gh-pages`. Nas configurações do GitHub Pages, selecione **Deploy from a branch**, branch **gh-pages**, pasta **/ (root)**. Este projeto não precisa de workflow próprio nem de credenciais dentro dos arquivos. A autenticação Git é feita pelo ambiente de quem publica.

O código-fonte e os artefatos de publicação ficam em branches separadas. `out/` permanece fora de `main`; `.nojekyll` preserva o diretório `_next` na publicação.

`basePath` e `assetPrefix` estão em `next.config.mjs`. O helper `assetPath`, em `lib/site-config.ts`, aplica o mesmo prefixo às imagens de `public/`. A fonte local Manrope é processada pelo `next/font/local`, com arquivos emitidos sob `_next/`.

## Links de download

Os dois links ficam em um único arquivo na raiz: **[LINKS-DOWNLOAD.json](./LINKS-DOWNLOAD.json)**. Abra **[EDITAR-LINKS.cmd](./EDITAR-LINKS.cmd)** com dois cliques para editar esse arquivo no Bloco de Notas.

Cole os endereços públicos dos instaladores entre as aspas correspondentes:

```json
{
  "windows": "",
  "android": ""
}
```

Use links completos começando com `https://` ou `http://`. Um campo vazio mantém somente aquele botão desativado, com “Download em breve”. Quando preenchido, o botão passa a usar o endereço informado. `LINKS-DOWNLOAD.json` é o único local para alterar esses links; `lib/site-config.ts` lê o arquivo automaticamente. Os instaladores precisam estar hospedados em um endereço público; caminhos locais como `C:/...` não funcionam para os visitantes. Não inclua APKs ou instaladores neste repositório.

Após salvar, gere e confira o site:

```sh
npm run build
npm run verify
```

Para atualizar o site público no GitHub Pages, execute `npm run deploy`, que já inclui as verificações e o build. Apenas salvar o JSON não altera a versão publicada.

## Organização

- `app/`: página, estilos e metadados.
- `LINKS-DOWNLOAD.json`: links editáveis dos botões Windows e Android.
- `EDITAR-LINKS.cmd`: atalho para abrir o arquivo de links no Bloco de Notas.
- `lib/`: configuração pública e as três fileiras do catálogo.
- `public/assets/`: imagens usadas pela página e pelos itens.
- `public/fonts/`: Manrope e sua licença.
- `scripts/verify-static.mjs`: verificação da exportação.

As versões de Next.js, React e demais dependências estão fixadas em `package.json` e `package-lock.json`.

## Direitos

Este é um repositório público de consulta, com direitos reservados conforme [LICENSE](./LICENSE). A visibilidade do código não concede uma licença de código aberto para o site, a marca ou o jogo. Componentes de terceiros continuam sujeitos às respectivas licenças, incluindo a [SIL Open Font License da Manrope](./public/fonts/manrope-OFL.txt).
