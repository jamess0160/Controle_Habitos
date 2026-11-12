import type { MetadataRoute } from "next";

/**
 * Manifest da PWA.
 *
 * `display: "standalone"` é o que tira a barra de endereço e faz o app abrir
 * como aplicativo — e é também o que torna a biometria utilizável sem o
 * incômodo do navegador em volta.
 *
 * `start_url: "/"` cai no dashboard. Quando não há sessão, o
 * [proxy](../proxy.ts) redireciona para `/login`, então o atalho da tela
 * inicial sempre abre no lugar certo sem precisar saber de autenticação.
 *
 * As cores vêm da paleta Esmalte: `background_color` é a superfície do tema
 * claro, usada na tela de abertura antes do CSS carregar. Ela não acompanha o
 * tema do sistema — o manifest não tem como declarar duas —, então fica no
 * claro, que é o caso mais comum de primeira abertura.
 *
 * Os dois ícones declaram `any maskable` porque a arte é full bleed com o disco
 * dentro da zona segura de 80%: o Android pode recortar em círculo ou em
 * squircle sem cortar a marca.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Controle de hábitos",
    short_name: "Hábitos",
    description: "Acompanhamento diário de hábitos, sequências e congelamentos.",
    lang: "pt-BR",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#eef1f6",
    theme_color: "#eef1f6",
    categories: ["productivity", "lifestyle", "health"],
    icons: [
      {
        src: "/icone-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icone-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icone-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
