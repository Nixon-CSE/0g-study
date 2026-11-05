"use client";

import type { SVGProps } from "react";

export type BoringAvatarProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  name: string;
  variant?: "marble" | "bauhaus";
  colors?: string[];
  square?: boolean;
  size?: number;
};

function hash(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h << 5) - h + name.charCodeAt(i);
    h = h | 0;
  }
  return Math.abs(h);
}

function pick<T>(arr: T[], h: number, i: number) {
  if (!arr.length) return arr[0] as T;
  return arr[(h + i) % arr.length];
}

/** Marble-inspired blob SVG (subset of boring-avatars “marble” look). */
function MarbleSvg({
  name,
  variant: _variant,
  colors = ["#92a0a9", "#6f828a", "#405059"],
  square,
  size: _size,
  ...rest
}: BoringAvatarProps) {
  const h = hash(name);
  const c0 = pick(colors, h, 0);
  const c1 = pick(colors, h, 1);
  const c2 = pick(colors, h, 2);
  const c3 = pick(colors, h, 3);
  const x1 = 8 + (h % 25);
  const y1 = 6 + ((h >> 2) % 20);
  const x2 = 40 + ((h >> 4) % 28);
  const y2 = 28 + ((h >> 6) % 25);
  const r = square ? 0 : 12;
  return (
    <svg
      viewBox="0 0 80 80"
      role="img"
      aria-hidden
      {...rest}
    >
      <rect width="80" height="80" fill={c0} rx={r} />
      <circle cx={x1 + 18} cy={y1 + 20} r={30} fill={c1} opacity={0.92} />
      <circle cx={x2 + 10} cy={y2 + 8} r={24} fill={c2} opacity={0.88} />
      <ellipse cx="44" cy="68" rx="36" ry="16" fill={c3} opacity={0.72} />
    </svg>
  );
}

/** Bauhaus-inspired blocks (subset of boring-avatars “bauhaus” look). */
function BauhausSvg({
  name,
  variant: _variant,
  colors = ["#888888"],
  square,
  size = 80,
  ...rest
}: BoringAvatarProps) {
  const h = hash(name);
  const corner = square ? size * 0.14 : size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-hidden
      {...rest}
    >
      <rect
        width={size}
        height={size}
        fill={pick(colors, h, 0)}
        rx={corner}
      />
      <rect
        x={0}
        y={0}
        width={size * 0.65}
        height={size * 0.38}
        fill={pick(colors, h, 1)}
        opacity={0.95}
      />
      <circle
        cx={size * 0.74}
        cy={size * 0.34}
        r={size * 0.21}
        fill={pick(colors, h, 2)}
      />
      <rect
        x={size * 0.32}
        y={size * 0.48}
        width={size * 0.52}
        height={size * 0.36}
        fill={pick(colors, h, 3)}
        opacity={0.9}
      />
    </svg>
  );
}

/**
 * Deterministic SVG avatars (marble / bauhaus) without the `boring-avatars`
 * dependency so Next always resolves the module.
 */
export default function BoringAvatar({
  variant = "bauhaus",
  ...props
}: BoringAvatarProps) {
  if (variant === "marble") {
    return <MarbleSvg variant={variant} {...props} />;
  }
  return <BauhausSvg variant={variant} {...props} />;
}
