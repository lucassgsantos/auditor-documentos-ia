interface InfoRowProps {
  label: string;
  value: string;
  /**
   * Visual variant.
   * - "default": sans-serif label, flexible width (used in side panels).
   * - "mono": mono uppercase label, fixed 92px column (used in detail inspectors).
   */
  variant?: "default" | "mono";
}

export function InfoRow({ label, value, variant = "default" }: InfoRowProps) {
  if (variant === "mono") {
    return (
      <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3">
        <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
          {label}
        </dt>
        <dd className="text-sm leading-6 text-[var(--text)]">{value}</dd>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(88px,auto)_minmax(0,1fr)] items-baseline gap-3">
      <dt className="text-[12px] font-medium text-[var(--text-muted)]">{label}</dt>
      <dd className="text-sm font-medium text-[var(--text)]">{value}</dd>
    </div>
  );
}
