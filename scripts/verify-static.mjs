import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "../next.config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "out");
const basePath = "/invox-site";
const origin = "https://jmxxp.github.io";
const canonical = `${origin}${basePath}/`;
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}
async function filesUnder(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const groups = await Promise.all(entries.map(entry => {
    const name = path.join(folder, entry.name);
    return entry.isDirectory() ? filesUnder(name) : [name];
  }));
  return groups.flat();
}

check(config.output === "export" && config.trailingSlash, "Exportação estática com caminhos terminados em barra");
check(config.basePath === basePath && config.assetPrefix === basePath, "Prefixos de rota e recursos configurados para o Pages");
check(config.images.unoptimized === true, "Imagens independentes de servidor de otimização");
const sourceConfig = await fs.readFile(path.join(root, "lib/site-config.ts"), "utf8");
check(sourceConfig.includes(`siteBasePath = "${basePath}"`), "Helper público usa o mesmo prefixo do Next.js");
const pageSource = await fs.readFile(path.join(root, "app/page.tsx"), "utf8");
const downloads = Object.fromEntries(["windows", "android"].map(platform => {
  const constant = `LINK_DOWNLOAD_${platform.toUpperCase()}`;
  const declaration = pageSource.match(new RegExp(`const\\s+${constant}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")\\s*;`));
  check(Boolean(declaration), `Link de ${platform} editável diretamente em app/page.tsx`);
  const value = JSON.parse(declaration[1]).trim();
  if (value) {
    const url = new URL(value);
    check(["https:", "http:"].includes(url.protocol), `Link de ${platform} usa HTTP ou HTTPS`);
  }
  return [platform, value];
}));
const catalog = await fs.readFile(path.join(root, "lib/catalog-background.ts"), "utf8");
const items = [...catalog.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map(match => match[1]);
check(items.length === 72 && new Set(items).size === 72, "Catálogo mantém os 72 itens únicos");

const html = await fs.readFile(path.join(output, "index.html"), "utf8");
check(html.includes(`rel="canonical" href="${canonical}"`), "Canonical corresponde ao endereço público final");
check((html.match(/class="catalog-card"/g) || []).length === 144, "Três fileiras mantêm a duplicação contínua dos 72 itens");
check((html.match(/class="catalog-lane lane-/g) || []).length === 3, "As três fileiras animadas foram renderizadas");
check(html.includes("pause-background"), "Pausa das animações presente");
function escapeAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
for (const [platform, label] of [["windows", "Windows"], ["android", "Android"]]) {
  const card = html.match(new RegExp(`<div id="${platform}">([\\s\\S]*?)</article>`))?.[1] ?? "";
  const cardText = card.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "");
  check(card.length > 0, `Card de download ${label} foi renderizado`);
  if (downloads[platform]) {
    check(card.includes(`href="${escapeAttribute(downloads[platform])}"`)
      && cardText.includes(`Baixar para ${label}`) && !/<button\b[^>]*\bdisabled\b/.test(card),
    `Botão ${label} ativo usa exatamente o link configurado`);
  } else {
    check(/<button\b[^>]*\bdisabled\b/.test(card) && cardText.includes("Download em breve")
      && !cardText.includes(`Baixar para ${label}`),
    `Botão ${label} permanece desativado enquanto o link está vazio`);
  }
}
check(!html.includes("chatgpt.site") && !html.includes("/_sites/"), "Nenhuma URL ou infraestrutura do hosting anterior no HTML");

const referenced = new Set();
const htmlFiles = (await filesUnder(output)).filter(file => file.endsWith(".html"));
async function verifyUrl(raw, ownerUrl, label) {
  const value = raw.replaceAll("&amp;", "&");
  if (!value || /^(?:data:|blob:|mailto:|tel:|#)/i.test(value)) return;
  const url = new URL(value, ownerUrl);
  if (url.origin !== origin) return;
  assert.ok(url.pathname === basePath || url.pathname.startsWith(`${basePath}/`), `${label}: prefixo ausente em ${value}`);
  let relative = decodeURIComponent(url.pathname.slice(basePath.length)).replace(/^\/+/, "");
  if (!relative || relative.endsWith("/")) relative += "index.html";
  const resolved = path.resolve(output, relative);
  assert.ok(resolved.startsWith(output + path.sep), `${label}: caminho fora da exportação`);
  assert.ok((await fs.stat(resolved)).isFile(), `${label}: arquivo não encontrado ${relative}`);
  referenced.add(resolved);
}
for (const file of htmlFiles) {
  const content = await fs.readFile(file, "utf8");
  const relative = path.relative(output, file).split(path.sep).join("/");
  const ownerUrl = `${origin}${basePath}/${relative}`;
  for (const tag of content.matchAll(/<(?:link|script|img)\b[^>]*>/gi)) {
    for (const attribute of tag[0].matchAll(/\b(?:src|href)="([^"]+)"/g)) {
      await verifyUrl(attribute[1], ownerUrl, relative);
    }
  }
}
const exportedFiles = await filesUnder(output);
const cssFiles = exportedFiles.filter(file => file.endsWith(".css"));
for (const file of cssFiles) {
  const content = await fs.readFile(file, "utf8");
  const relative = path.relative(output, file).split(path.sep).join("/");
  for (const match of content.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
    await verifyUrl(match[1], `${origin}${basePath}/${relative}`, relative);
  }
}
check(referenced.size > 75, "Todos os recursos locais referidos em HTML/CSS existem sob o prefixo correto");
check([...referenced].some(file => file.endsWith(".woff2") && file.includes(`${path.sep}_next${path.sep}`)), "Fonte local emitida e referida pelo next/font sob _next");
check(cssFiles.length > 0 && (await fs.readFile(cssFiles[0], "utf8")).includes("prefers-reduced-motion"), "Preferência de movimento reduzido preservada");
for (const match of catalog.matchAll(/"src"\s*:\s*"([^"]+)"/g)) {
  await verifyUrl(`${basePath}${match[1]}`, canonical, "item do catálogo");
}
await fs.access(path.join(output, ".nojekyll"));
check(true, "Exportação inclui .nojekyll para os recursos _next");
check((await fs.readFile(path.join(output, "sitemap.xml"), "utf8")).includes(canonical), "Sitemap corresponde ao GitHub Pages");

const report = {
  passed: true,
  checks,
  catalogItems: items.length,
  renderedCatalogCards: 144,
  htmlFiles: htmlFiles.length,
  referencedFiles: referenced.size,
  exportedFiles: exportedFiles.length,
  bytes: (await Promise.all(exportedFiles.map(async file => (await fs.stat(file)).size))).reduce((sum, size) => sum + size, 0),
  canonical,
};
await fs.mkdir(path.join(root, ".qa"), { recursive: true });
await fs.writeFile(path.join(root, ".qa/static-verification.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
