"use client";

interface AvatarProps {
  src?: string;
  name: string;
  size?: number;
  color?: string;
  emoji?: string;
  className?: string;
}

export default function Avatar({ src, name, size = 32, color = "var(--bf-plum)", emoji, className = "" }: AvatarProps) {
  const style = { width: size, height: size, minWidth: size, minHeight: size };

  if (src && !src.startsWith("#")) {
    return (
      <img
        src={src}
        alt={name}
        style={style}
        className={`rounded-full object-cover ${className}`}
      />
    );
  }

  const bgColor = src?.startsWith("#") ? src : color;

  return (
    <div
      style={{ ...style, background: bgColor }}
      className={`rounded-full flex items-center justify-center text-[var(--foreground)] font-bold select-none ${className}`}
    >
      {emoji ? (
        <span style={{ fontSize: size * 0.52, lineHeight: 1 }}>{emoji}</span>
      ) : (
        <span style={{ fontSize: size * 0.4 }}>{name.charAt(0).toUpperCase()}</span>
      )}
    </div>
  );
}
