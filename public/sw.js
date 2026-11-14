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
 * As notificações push entraram na etapa 3.5, no fim do arquivo.
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

/*
 * ─── Push ──────────────────────────────────────────────────────────────────
 *
 * O payload é o `Notificacao` de `servidor/push.ts`: título, corpo, url e tag.
 *
 * `waitUntil` não é opcional: sem ele o navegador pode encerrar o service worker
 * antes de `showNotification` resolver, e a notificação chega às vezes — o pior
 * tipo de defeito para depurar, porque some quando se olha.
 */
self.addEventListener("push", (evento) => {
  const dados = lerPayload(evento);

  evento.waitUntil(
    self.registration.showNotification(dados.titulo, {
      body: dados.corpo,
      /*
       * O ícone da PWA. Caminho fixo porque o service worker não tem como ler o
       * manifest, e um ícone ausente faz o Android mostrar um quadrado cinza.
       */
      icon: "/icone-192.png",
      badge: "/icone-192.png",
      /* Mesma tag substitui a anterior: um dia sem abrir o app não vira pilha. */
      tag: dados.tag,
      data: { url: dados.url },
      /*
       * Vibra ao chegar. Sem isto, no Android a notificação entra silenciosa
       * quando o app está em segundo plano, que é justamente o caso de uso.
       */
      vibrate: [80, 40, 80],
    }),
  );
});

/**
 * Lê o payload com defesa.
 *
 * Um push sem corpo, ou com corpo que não é o nosso JSON, ainda tem de virar
 * notificação: o navegador **exige** que todo evento de push mostre alguma —
 * ignorá-lo faz o Chrome mostrar "Este site foi atualizado em segundo plano" no
 * lugar, e revoga a permissão se isso se repetir.
 */
function lerPayload(evento) {
  const vazio = {
    titulo: "Controle de Hábitos",
    corpo: "Você tem algo pendente.",
    url: "/",
    tag: "generico",
  };

  if (!evento.data) return vazio;

  try {
    const dados = evento.data.json();
    return {
      titulo: dados.titulo ?? vazio.titulo,
      corpo: dados.corpo ?? vazio.corpo,
      url: dados.url ?? vazio.url,
      tag: dados.tag ?? vazio.tag,
    };
  } catch {
    return { ...vazio, corpo: evento.data.text() || vazio.corpo };
  }
}

/*
 * Tocar na notificação **foca a janela aberta** em vez de abrir outra.
 *
 * Sem isto, cada toque abre uma aba nova da PWA, e o usuário termina o dia com
 * seis cópias do app. Só quando não há nenhuma é que se abre.
 */
self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();

  const destino = new URL(evento.notification.data?.url ?? "/", self.location.origin);

  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      for (const janela of janelas) {
        if ("focus" in janela) {
          janela.navigate?.(destino.href);
          return janela.focus();
        }
      }

      return self.clients.openWindow(destino.href);
    }),
  );
});
