import type { ReactNode } from "react";
import type { ColumnType } from "@tavolio/table";
import { formatNumber } from "./numfmt.js";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Icon = {
  check: () => (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2.5}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
  dash: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M7 12h10" />
    </svg>
  ),
  back: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  chevron: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  down: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  refresh: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
    </svg>
  ),
  info: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  ),
  alert: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M12 3l9.5 17h-19L12 3z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  ),
  lock: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  done: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16 10" />
    </svg>
  ),
};

export function Logo() {
  return (
    <span className="tv-logo" aria-hidden>
      <svg viewBox="0 0 12 12" fill="#fff">
        <rect x="1" y="1" width="10" height="2.2" rx="0.6" />
        <rect x="1" y="4.9" width="4.4" height="2.2" rx="0.6" />
        <rect x="6.6" y="4.9" width="4.4" height="2.2" rx="0.6" opacity="0.6" />
        <rect x="1" y="8.8" width="4.4" height="2.2" rx="0.6" />
        <rect x="6.6" y="8.8" width="4.4" height="2.2" rx="0.6" opacity="0.6" />
      </svg>
    </span>
  );
}

const TYPE_LABEL: Record<ColumnType, { label: string; cls: string }> = {
  numeric: { label: "Number", cls: "tv-pill-number" },
  categorical: { label: "Category", cls: "tv-pill-category" },
  ordinal: { label: "Category", cls: "tv-pill-category" },
  boolean: { label: "Yes / No", cls: "tv-pill-category" },
  datetime: { label: "Date", cls: "tv-pill-date" },
  text: { label: "Text", cls: "" },
};

export function typeLabel(type: ColumnType): string {
  return TYPE_LABEL[type].label;
}

export function TypePill({ type }: { type: ColumnType }) {
  const t = TYPE_LABEL[type];
  return <span className={`tv-pill ${t.cls}`}>{t.label}</span>;
}

export function Back({ onClick, children = "Back" }: { onClick: () => void; children?: ReactNode }) {
  return (
    <button className="tv-back" onClick={onClick}>
      <Icon.back />
      {children}
    </button>
  );
}

export function Callout({ tone = "info", children }: { tone?: "info" | "warn" | "danger"; children: ReactNode }) {
  const icon = tone === "info" ? <Icon.info /> : <Icon.alert />;
  return (
    <div className={`tv-callout ${tone === "info" ? "" : `tv-callout-${tone}`}`} role={tone === "info" ? undefined : "alert"}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function Bar({ label, value, display, strong }: { label: string; value: number; display?: string; strong?: boolean }) {
  return (
    <div className="tv-bar-row">
      <span className="tv-bar-label" title={label}>
        {label}
      </span>
      <span className="tv-bar-track">
        <span
          className="tv-bar-fill"
          data-strong={strong ? "true" : "false"}
          style={{ display: "block", width: `${Math.max(2, Math.min(100, value * 100))}%` }}
        />
      </span>
      {display !== undefined && <span>{display}</span>}
    </div>
  );
}

export function Details({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="tv-details">
      <summary>
        <Icon.chevron />
        {summary}
      </summary>
      {children}
    </details>
  );
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export const num = formatNumber;

/** Kept for call sites that used a separate short form; num() is now always short. */
export const compact = formatNumber;

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
