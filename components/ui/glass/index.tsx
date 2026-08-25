import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* GlassPanel — the raw frosted surface everything else is built from.         */
/* -------------------------------------------------------------------------- */

export const GlassPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function GlassPanel({ className, ...props }, ref) {
    return <div ref={ref} className={cn("glass-surface", className)} {...props} />;
  },
);

/* -------------------------------------------------------------------------- */
/* GlassCard — a panel with padding and an optional titled header.             */
/* -------------------------------------------------------------------------- */

export interface GlassCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Removes inner padding when the body manages its own (tables, charts). */
  flush?: boolean;
}

export function GlassCard({
  title,
  description,
  action,
  flush,
  className,
  children,
  ...props
}: GlassCardProps) {
  const hasHeader = Boolean(title || description || action);

  return (
    <GlassPanel className={cn("animate-fade-up overflow-hidden", className)} {...props}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 border-b border-white/25 px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            {title && (
              <h2 className="truncate text-base font-semibold tracking-tight text-ink">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn(!flush && "p-5")}>{children}</div>
    </GlassPanel>
  );
}

/* -------------------------------------------------------------------------- */
/* GlassButton                                                                 */
/* -------------------------------------------------------------------------- */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-white border-transparent hover:bg-accent/90 shadow-glass focus-visible:ring-accent",
  secondary:
    "bg-white/55 text-ink border-white/50 hover:bg-white/75 backdrop-blur-glass " +
    "dark:bg-white/10 dark:border-white/15 dark:hover:bg-white/20 focus-visible:ring-accent",
  ghost:
    "bg-transparent text-ink-muted border-transparent hover:bg-white/40 hover:text-ink " +
    "dark:hover:bg-white/10 focus-visible:ring-accent",
  danger:
    "bg-fail text-white border-transparent hover:bg-fail/90 focus-visible:ring-fail",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

export interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  function GlassButton(
    { className, variant = "primary", size = "md", loading, disabled, children, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center rounded-full border font-medium",
          "transition-all duration-150 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          "focus-visible:ring-offset-transparent",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "active:scale-[0.98]",
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
        )}
        {children}
      </button>
    );
  },
);

/* -------------------------------------------------------------------------- */
/* GlassInput / GlassSelect                                                    */
/* -------------------------------------------------------------------------- */

const FIELD_BASE =
  "w-full rounded-xl border border-white/50 bg-white/60 px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-muted/70 backdrop-blur-glass transition " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 " +
  "disabled:cursor-not-allowed disabled:opacity-60 " +
  "dark:border-white/15 dark:bg-white/10";

export const GlassInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function GlassInput({ className, ...props }, ref) {
  return <input ref={ref} className={cn(FIELD_BASE, className)} {...props} />;
});

export const GlassSelect = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function GlassSelect({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(FIELD_BASE, "pr-8", className)} {...props}>
      {children}
    </select>
  );
});

export function FieldLabel({
  htmlFor,
  children,
  hint,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="mb-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {children}
      </label>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badge / StatTile / EmptyState                                               */
/* -------------------------------------------------------------------------- */

export function Badge({
  tone = "neutral",
  children,
  className,
  title,
}: {
  tone?: "neutral" | "pass" | "fail" | "warn" | "accent";
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-white/50 text-ink-muted dark:bg-white/10",
    pass: "bg-pass/15 text-pass",
    fail: "bg-fail/15 text-fail",
    warn: "bg-warn/15 text-warn",
    accent: "bg-accent/15 text-accent",
  };
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatTile({
  label,
  value,
  sublabel,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  tone?: "pass" | "fail" | "warn";
}) {
  const valueTone =
    tone === "pass" ? "text-pass" : tone === "fail" ? "text-fail" : tone === "warn" ? "text-warn" : "text-ink";

  return (
    <GlassPanel className="animate-fade-up p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-tight", valueTone)}>
        {value}
      </p>
      {sublabel && <p className="mt-0.5 text-xs text-ink-muted">{sublabel}</p>}
    </GlassPanel>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-ink-muted" aria-hidden>{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {body && <p className="max-w-md text-sm text-ink-muted">{body}</p>}
      {action}
    </div>
  );
}
