import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  helper: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, helper, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]"
      >
        {icon}
      </div>
      <div className="max-w-md space-y-1">
        <p className="text-sm font-semibold text-[var(--text)]">{title}</p>
        <p className="text-sm leading-6 text-[var(--text-muted)]">{helper}</p>
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
