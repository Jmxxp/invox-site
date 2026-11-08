import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { assetPath, siteConfig } from "@/lib/site-config";
import "./globals.css";

const manrope = localFont({
  src: "../public/fonts/manrope.woff2",
  variable: "--font-manrope",
  weight: "400 800",
  style: "normal",
  display: "swap",
  adjustFontFallback: false,
});

const brandIcon = new URL(assetPath("/assets/brand-icon.png"), siteConfig.url).href;

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: "INVOX — Sua voz. Suas regras. Infinitas possibilidades.",
  description: "Um sandbox multiplayer onde sua voz cria. Combine armas, criaturas, veículos e poderes. Construa com amigos ou entre na disputa. Para Windows e Android.",
  applicationName: siteConfig.name,
  alternates: { canonical: siteConfig.url },
  openGraph: {
    title: "INVOX — Sua voz. Suas regras.",
    description: "Sandbox multiplayer. Infinitas possibilidades e combinações. Windows + Android.",
    type: "website",
    locale: "pt_BR",
    url: siteConfig.url,
    images: [{ url: brandIcon, width: 512, height: 512, alt: "INVOX" }],
  },
  icons: { icon: brandIcon, shortcut: brandIcon, apple: brandIcon },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#08090d",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className={`${manrope.variable} antialiased`}>{children}</body></html>;
}
