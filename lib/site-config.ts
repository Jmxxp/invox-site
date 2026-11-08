/** Prefixo público do repositório no GitHub Pages. Mantenha next.config.mjs igual. */
export const siteBasePath = "/invox-site";

/** Caminhos de public/ precisam do prefixo; links externos e âncoras não. */
export function assetPath(path: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(path)) return path;
  if (path === siteBasePath || path.startsWith(`${siteBasePath}/`)) return path;
  return `${siteBasePath}/${path.replace(/^\/+/, "")}`;
}

export const siteConfig = {
  name: "INVOX",
  url: "https://jmxxp.github.io/invox-site/",
  year: 2026,
  // Preencha apenas com os links oficiais quando forem disponibilizados.
  downloads: {
    windows: null as string | null,
    android: null as string | null,
  },
};
