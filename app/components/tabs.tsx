"use client";
// In-page tabs over server-rendered panels (W3C APG tabs pattern).
// Without JavaScript each tab is a plain link (?tab=...), and the server renders the
// active panel visible. With JavaScript a click only switches which already-rendered
// panel is shown — no new request, so the numbers stay the ones you are reading.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

export type TabDef = { id: string; label: string; panel: ReactNode };

const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export function Tabs({ tabs, initial, baseQuery }: { tabs: TabDef[]; initial: string; baseQuery: string }) {
  const [active, setActive] = useState(initial);
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({});
  // Scroll target to reach once the newly selected panel is actually visible.
  const pendingAnchor = useRef<string | null>(null);
  const href = useCallback((id: string) => `/?${baseQuery}${baseQuery ? "&" : ""}tab=${id}`, [baseQuery]);

  const select = useCallback(
    (id: string, opts: { push?: boolean; anchor?: string; focusTab?: boolean } = {}) => {
      if (!tabs.some((t) => t.id === id)) return;
      setActive(id);
      if (opts.push !== false) history.pushState(null, "", href(id) + (opts.anchor ? `#${opts.anchor}` : ""));
      if (opts.focusTab) refs.current[id]?.focus();
      if (opts.anchor) pendingAnchor.current = opts.anchor;
    },
    [tabs, href],
  );

  useEffect(() => {
    const target = pendingAnchor.current;
    if (!target) return;
    pendingAnchor.current = null;
    const el = document.getElementById(target);
    el?.scrollIntoView({ block: "start" });
    el?.focus({ preventScroll: true });
  }, [active]);

  useEffect(() => {
    const onPop = () => {
      const t = new URLSearchParams(location.search).get("tab");
      setActive(tabs.some((x) => x.id === t) ? (t as string) : tabs[0].id);
    };
    const onGo = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; anchor?: string }>).detail;
      select(d.id, { anchor: d.anchor });
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("pc:tab", onGo);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pc:tab", onGo);
    };
  }, [tabs, select]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const n = tabs.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to >= 0) {
      e.preventDefault();
      select(tabs[to].id, { focusTab: true });
    } else if (e.key === " ") {
      e.preventDefault();
      select(tabs[i].id);
    }
  };

  return (
    <div className="tabs">
      <div role="tablist" aria-label="Comparison details" className="tablist" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((t, i) => (
          <a
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            role="tab"
            id={`tab-${t.id}`}
            href={href(t.id)}
            aria-selected={active === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            onClick={(e) => {
              if (!plainClick(e)) return;
              e.preventDefault();
              select(t.id);
            }}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </a>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={active !== t.id} tabIndex={0}>
          {t.panel}
        </div>
      ))}
    </div>
  );
}

/** A link that opens a tab (and scrolls to an element in it) without reloading the numbers. */
export function TabLink({ tab, anchor, href, children }: { tab: string; anchor?: string; href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        if (!plainClick(e)) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("pc:tab", { detail: { id: tab, anchor } }));
      }}
    >
      {children}
    </a>
  );
}
