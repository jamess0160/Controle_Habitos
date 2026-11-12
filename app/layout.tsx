import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SCRIPT_TEMA } from "./tema";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Hábitos",
    template: "%s · Hábitos",
  },
  description: "Acompanhamento diário de hábitos, sequências e congelamentos.",
  applicationName: "Hábitos",
  /*
   * Instalado no iOS o app precisa destes dois: `capable` tira a barra do
   * Safari, e `statusBarStyle: "default"` deixa o sistema escolher o contraste
   * da barra de status conforme o tema — `black-translucent` empurraria o
   * conteúdo para debaixo do relógio.
   */
  appleWebApp: {
    capable: true,
    title: "Hábitos",
    statusBarStyle: "default",
  },
  /*
   * O Next 16 traduz `appleWebApp.capable` para `mobile-web-app-capable`, o nome
   * moderno — o WebKit aceita, mas iOS mais antigo só lê a variante prefixada, e
   * sem ela o app instalado abre dentro do Safari, com barra de endereço. Dois
   * bytes de seguro para o único aparelho que vai rodar isso.
   */
  other: { "apple-mobile-web-app-capable": "yes" },
  /* Uso pessoal atrás de um túnel: não há nada aqui para indexar. */
  robots: { index: false, follow: false },
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /*
   * `viewportFit: "cover"` é o que libera as `env(safe-area-inset-*)` — sem
   * ele a barra inferior não sabe desviar do indicador de gestos do iPhone.
   */
  viewportFit: "cover",
  /* A cor da barra do sistema acompanha a superfície do tema (paleta Esmalte). */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef1f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e14" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <head>
        {/*
         * Inline e síncrono de propósito — ver a nota em `SCRIPT_TEMA`. Qualquer
         * estratégia de carregamento adiada chega depois da primeira pintura, que
         * é exatamente o flash que isto existe para evitar.
         */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
