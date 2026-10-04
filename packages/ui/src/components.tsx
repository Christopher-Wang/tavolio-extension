import { useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";
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
  lightbulb: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
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

interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** Hover detail that rides next to the cursor (or under the focused element, for keyboard users) instead of taking up room on the page. */
export function useCursorTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  return {
    tip,
    hide: () => setTip(null),
    /** Spread onto the hoverable element. */
    on: (content: ReactNode) => ({
      onMouseEnter: (e: MouseEvent) => setTip({ x: e.clientX, y: e.clientY, content }),
      onMouseMove: (e: MouseEvent) => setTip({ x: e.clientX, y: e.clientY, content }),
      onFocus: (e: FocusEvent) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTip({ x: r.left + r.width / 2, y: r.bottom, content });
      },
    }),
  };
}

const TIP_GAP = 14;

export function CursorTip({ tip }: { tip: TipState | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Flip to the other side of the cursor, or slide inward, so the tip never leaves the pane.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!tip || !el) return setPos(null);
    const { width, height } = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = tip.x + TIP_GAP;
    if (left + width > vw - 4) left = Math.max(4, tip.x - TIP_GAP - width);
    let top = tip.y + TIP_GAP;
    if (top + height > vh - 4) top = Math.max(4, tip.y - TIP_GAP - height);
    setPos({ left, top });
  }, [tip]);
  if (!tip) return null;
  return (
    <div ref={ref} className="tv-tip" role="tooltip" style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}>
      {tip.content}
    </div>
  );
}

export function Bar({
  label,
  value,
  display,
  strong,
  active,
  onActive,
  tip,
}: {
  label: string;
  value: number;
  display?: string;
  strong?: boolean;
  /** With `onActive`, the row can be hovered or focused: `active` says which row is, so the others can recede. */
  active?: boolean | null;
  onActive?: (on: boolean) => void;
  /** Detail shown beside the cursor while the row is hovered or focused. */
  tip?: ReactNode;
}) {
  const t = useCursorTip();
  const tipOn = tip ? t.on(tip) : null;
  const hover =
    onActive || tip
      ? {
          tabIndex: 0,
          onMouseMove: tipOn?.onMouseMove,
          onMouseEnter: (e: MouseEvent) => (onActive?.(true), tipOn?.onMouseEnter(e)),
          onMouseLeave: () => (onActive?.(false), t.hide()),
          onFocus: (e: FocusEvent) => (onActive?.(true), tipOn?.onFocus(e)),
          onBlur: () => (onActive?.(false), t.hide()),
        }
      : {};
  return (
    <div className="tv-bar-row" data-active={active === null || active === undefined ? undefined : String(active)} {...hover}>
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
      <CursorTip tip={t.tip} />
    </div>
  );
}

export interface BreakdownItem {
  key: string;
  label: string;
  /** 0..1 */
  share: number;
  /** Shown beside the cursor while the row is hovered or focused. */
  tip: ReactNode;
}

/**
 * Bars that are all the accent colour; hovering (or focusing) one keeps it lit and dims the rest, and its detail follows the cursor.
 * The same experience wherever a column's values or types are broken down.
 */
export function Breakdown({ items, label, more = 0, moreLabel = "other value" }: { items: BreakdownItem[]; label: string; more?: number; moreLabel?: string }) {
  const [at, setAt] = useState<string | null>(null);
  return (
    <div className="tv-bars" aria-label={label}>
      {items.map((it) => (
        <Bar
          key={it.key}
          label={it.label}
          value={it.share}
          display={percent(it.share)}
          strong
          active={at === null ? null : at === it.key}
          onActive={(on) => setAt(on ? it.key : null)}
          tip={it.tip}
        />
      ))}
      {more > 0 && <span className="tv-small">and {plural(more, moreLabel)}</span>}
    </div>
  );
}

const quoted = (spelling: string) => `\u201c${spelling}\u201d`;
const MAX_LISTED = 6;

/** Every spelling that was counted as one value, each as a share of `rows`. */
export function spellingsTip(variants: Array<{ spelling: string; count: number }>, rows: number): ReactNode {
  return (
    <>
      {variants.slice(0, MAX_LISTED).map((v) => (
        <div key={v.spelling}>
          {quoted(v.spelling)} {percent(v.count / rows)}
        </div>
      ))}
      {variants.length > MAX_LISTED && <div>and {variants.length - MAX_LISTED} more spellings</div>}
    </>
  );
}

/** Just names, one per line. */
export function namesTip(names: string[]): ReactNode {
  return (
    <>
      {names.slice(0, MAX_LISTED + 2).map((n) => (
        <div key={n}>{n}</div>
      ))}
      {names.length > MAX_LISTED + 2 && <div>and {names.length - MAX_LISTED - 2} more</div>}
    </>
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

/** Like pct, but a small share shows as "<1%" instead of rounding to a misleading 0%. */
export function percent(x: number): string {
  return x > 0 && x < 0.01 ? "<1%" : pct(x);
}

export const num = formatNumber;

/** Kept for call sites that used a separate short form; num() is now always short. */
export const compact = formatNumber;

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** Counts per equal-width bin, drawn as thin bars with the range underneath. Hover or focus a bar for its range and count. */
export function Histogram({ histogram, label }: { histogram: { bins: number[]; min: number; max: number }; label: string }) {
  const [at, setAt] = useState<number | null>(null);
  const t = useCursorTip();
  const { bins, min, max } = histogram;
  const peak = Math.max(...bins);
  const width = (max - min) / bins.length;
  const range = (i: number) => {
    const lo = min + i * width;
    const hi = i === bins.length - 1 ? max : lo + width;
    return width === 0 ? formatNumber(min) : `${formatNumber(lo)} – ${formatNumber(hi)}`;
  };
  const total = bins.reduce((sum, n) => sum + n, 0);
  const share = (n: number) => percent(total === 0 ? 0 : n / total);
  const tipOn = (i: number, n: number) =>
    t.on(
      <>
        <b>{range(i)}</b>
        <br />
        {share(n)}
      </>,
    );
  return (
    <div className="tv-hist" role="group" aria-label={`Distribution of ${label}, ${formatNumber(min)} to ${formatNumber(max)}`}>
      <div className="tv-hist-bars" onMouseLeave={() => (setAt(null), t.hide())}>
        {bins.map((n, i) => (
          <span
            key={i}
            className="tv-hist-col"
            data-active={at === null ? undefined : String(at === i)}
            tabIndex={0}
            aria-label={`${range(i)}: ${share(n)}`}
            onMouseMove={tipOn(i, n).onMouseMove}
            onMouseEnter={(e) => (setAt(i), tipOn(i, n).onMouseEnter(e))}
            onFocus={(e) => (setAt(i), tipOn(i, n).onFocus(e))}
            onBlur={() => (setAt(null), t.hide())}
          >
            <span className="tv-hist-bar" style={{ height: `${Math.max(n > 0 ? 6 : 0, (n / peak) * 100)}%`, ["--i" as string]: i }} />
          </span>
        ))}
      </div>
      <div className="tv-hist-axis">
        <span>{formatNumber(min)}</span>
        <span>{formatNumber(max)}</span>
      </div>
      <CursorTip tip={t.tip} />
    </div>
  );
}
