import type { ReactNode } from "react";

interface StatusPillProps {
  tone: "neutral" | "success" | "warning" | "danger";
  children: ReactNode;
  surface?: "light" | "dark" | "dossier";
  /** Optional leading icon. Use a 12-14px Lucide icon for best alignment. */
  icon?: ReactNode;
}

export function StatusPill({
  tone,
  children,
  surface = "light",
  icon,
}: StatusPillProps) {
  return (
    <span
      className="status-pill"
      data-surface={surface}
      data-tone={tone}
    >
      {icon ? (
        <span aria-hidden className="status-pill-icon">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
