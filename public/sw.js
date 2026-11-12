/*
 * Service worker mínimo.
 *
 * Existe por um motivo só: o Chrome no Android exige um service worker com
 * handler de `fetch` para oferecer a instalação do app, e o critério de saída da
 * etapa 2 é validar o app **instalado** no celular. Sem ele, não há convite de
 * instalação.
 *
 * Por isso ele não tem estratégia de cache. Cache offline não está na onda 1, e
 * um service worker que serve conteúdo guardado sem que isso tenha sido decidido
 * é a causa clássica de "mudei o código e o celular continua mostrando o
 * antigo". Aqui o fetch passa direto.
 *
 * As notificações push entram neste arquivo na etapa 3.5, junto do `push` e do
 * `notificationclick`.
 */

/* Assume o controle na primeira carga, sem esperar a aba antiga fechar. */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(self.clients.claim());
});

/*
 * Pass-through explícito. `respondWith` com o fetch da rede é o que registra o
 * handler para o critério de instalabilidade sem interferir em nada.
 */
self.addEventListener("fetch", (evento) => {
  if (evento.request.method !== "GET") return;
  evento.respondWith(fetch(evento.request));
});
