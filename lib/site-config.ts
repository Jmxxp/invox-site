/** Prefixo público do repositório no GitHub Pages. Mantenha next.config.mjs igual. */
export const siteBasePath = "/invox-site";

/** Caminhos de public/ precisam do prefixo; links externos e âncoras não. */
export function assetPath(path: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(path)) return path;
  if (path === siteBasePath || path.startsWith(`${siteBasePath}/`)) return path;
  return `${siteBasePath}/${path.replace(/^\/+/, "")}`;
}

export function downloadUrl(platform: string, value: unknown): string | null {
  if (typeof value !== "string") {
    throw new Error(`LINKS-DOS-DOWNLOADS.ts: o link ${platform} deve estar entre aspas ou vazio ("").`);
  }
  const link = value.trim();
  if (!link) return null;
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    throw new Error(`LINKS-DOS-DOWNLOADS.ts: coloque um link público http:// ou https:// para ${platform}.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`LINKS-DOS-DOWNLOADS.ts: use http:// ou https:// para ${platform}.`);
  }
  return link;
}

export const siteConfig = {
  name: "INVOX",
  url: "https://jmxxp.github.io/invox-site/",
  year: 2026,
};
