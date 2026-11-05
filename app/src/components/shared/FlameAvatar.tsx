import { BF_BRAND_EMOJI } from "@/lib/brand";
import { agentHueRotation, isUserUploadedAvatar } from "@/lib/agent-identicon";

interface FlameAvatarProps {
  slug: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
}

/**
 * Agent avatar: shows a user-uploaded image when provided, otherwise the
 * BonFire 🔥 emoji with a per-slug CSS hue-rotate so each agent looks unique.
 */
export default function FlameAvatar({
  slug,
  avatarUrl,
  size = 36,
  className,
  style,
  alt = "",
}: FlameAvatarProps) {
  if (avatarUrl && isUserUploadedAvatar(avatarUrl)) {
    return (
      <img
        src={avatarUrl}
        alt={alt}
        className={className}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", ...style }}
      />
    );
  }
  const hue = agentHueRotation(slug);
  return (
    <span
      role="img"
      aria-label={alt || "agent flame"}
      className={className}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        background: `hsl(${hue}, 60%, 12%)`,
        fontSize: Math.round(size * 0.66),
        lineHeight: 1,
        filter: `hue-rotate(${hue}deg)`,
        userSelect: "none",
        flexShrink: 0,
        ...style,
      }}
    >
      {BF_BRAND_EMOJI}
    </span>
  );
}
