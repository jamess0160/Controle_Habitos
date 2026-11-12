/**
 * Ícones da navegação e do seletor de tema.
 *
 * Desenhados à mão em traço de 1.75 para ficarem legíveis a 24 px no celular,
 * sem biblioteca: são seis, e uma dependência de ícones custaria mais que eles.
 *
 * `Alvo` é o ícone de Hoje de propósito — é a mesma marca de "cumprido" que
 * aparece em cada linha do dashboard e no ícone do app, então o destino e a
 * ação que ele contém usam o mesmo símbolo.
 */

type Props = { readonly className?: string };

const comuns = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function Alvo({ className }: Props) {
  return (
    <svg {...comuns} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.2 11 14.7 15.8 9.4" />
    </svg>
  );
}

export function Lista({ className }: Props) {
  return (
    <svg {...comuns} className={className}>
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  );
}

export function Engrenagem({ className }: Props) {
  return (
    <svg {...comuns} className={className}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" />
    </svg>
  );
}

export function Sol({ className }: Props) {
  return (
    <svg {...comuns} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4" />
    </svg>
  );
}

export function Lua({ className }: Props) {
  return (
    <svg {...comuns} className={className}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

export function Celular({ className }: Props) {
  return (
    <svg {...comuns} className={className}>
      <rect x="6.5" y="2.8" width="11" height="18.4" rx="2.4" />
      <path d="M10.5 18.6h3" />
    </svg>
  );
}
