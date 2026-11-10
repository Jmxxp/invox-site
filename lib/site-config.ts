import downloadLinks from "@/LINKS-DOWNLOAD.json";

/** Prefixo público do repositório no GitHub Pages. Mantenha next.config.mjs igual. */
export const siteBasePath = "/invox-site";

/** Caminhos de public/ precisam do prefixo; links externos e âncoras não. */
export function assetPath(path: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(path)) return path;
  if (path === siteBasePath || path.startsWith(`${siteBasePath}/`)) return path;
  return `${siteBasePath}/${path.replace(/^\/+/, "")}`;
}

function downloadUrl(platform: string, value: unknown): string | null {
  if (typeof value !== "string") {
    throw new Error(`LINKS-DOWNLOAD.json: o campo ${platform} deve ser um link entre aspas ou "".`);
  }
  const link = value.trim();
  if (!link) return null;
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    throw new Error(`LINKS-DOWNLOAD.json: coloque um link público http:// ou https:// para ${platform}.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`LINKS-DOWNLOAD.json: use http:// ou https:// para ${platform}.`);
  }
  return link;
}

export const siteConfig = {
  name: "INVOX",
  url: "https://jmxxp.github.io/invox-site/",
  year: 2026,
  // Edite os dois links em LINKS-DOWNLOAD.json, na raiz do projeto.
  downloads: {
    windows: downloadUrl("windows", downloadLinks.windows),
    android: downloadUrl("android", downloadLinks.android),
  },
};
