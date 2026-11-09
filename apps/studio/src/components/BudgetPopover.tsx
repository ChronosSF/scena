import { useEffect, useMemo, useState } from "react";
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { lintPage, lintScene, type LintCheck } from "@scena/scene";
import { renderPage } from "@scena/renderer";
import { useStudio } from "../store.ts";
import { useDebounced } from "../hooks.ts";
import { gzipSize, kb } from "../util.ts";
import { Popover, PopoverContent, PopoverTrigger, Tip } from "./ui.tsx";

const ICON = { ok: CircleCheck, warn: TriangleAlert, error: CircleX } as const;
const WORD = { ok: "Good", warn: "Check", error: "Over budget" } as const;

/** The performance and accessibility budget (development plan section 8.1), as a status pill. */
export function BudgetPill() {
  const { scene, page, rev } = useStudio();
  const checks = useMemo(() => [...lintScene(scene).checks, ...lintPage(scene, page)], [rev]); // documents are mutated in place
  const weight = usePageWeight();
  const all = weight ? [...checks, weight] : checks;
  const errors = all.filter((c) => c.level === "error").length, warns = all.filter((c) => c.level === "warn").length;
  const level = errors ? "error" : warns ? "warn" : "ok";
  const summary = errors ? `${errors} over budget` : warns ? `${warns} to check` : "Within budget";
  return (
    <Popover>
      <Tip label="Page budget">
        <PopoverTrigger asChild>
          <button type="button" className="pill" data-ui="budget" aria-label={`Page budget: ${summary}`}>
            <span className={`dot ${level}`} aria-hidden="true" />
            <span className="hide-narrow squeeze">{summary}</span>
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent label="Page budget">
        <p className="pop-title">Page budget</p>
        <p className="pop-sub">What every published page has to meet: weight, complexity, contrast and tap areas.</p>
        <ul className="checks">
          {all.map((c) => {
            const Icon = ICON[c.level];
            return (
              <li key={c.id} className={`check ${c.level}`}>
                <Icon aria-hidden="true" strokeWidth={1.75} />
                <div>
                  <div className="check-label">{c.label} <span className="sr-only">({WORD[c.level]})</span></div>
                  <div className="check-detail">{c.detail}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Gzipped HTML, CSS, SVG and script of the published page, excluding inlined PNGs. */
function usePageWeight(): LintCheck | null {
  const { scene, page, rev } = useStudio();
  const settled = useDebounced(rev, 500);
  const [check, setCheck] = useState<LintCheck | null>(null);
  useEffect(() => {
    let live = true;
    const html = renderPage(scene, page).html;
    const images = Object.values(scene.assets).reduce((s, a) => s + (a.kind === "raster" ? a.url.length : 0), 0);
    void gzipSize(html.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, "data:")).then((gz) => {
      if (!live) return;
      const level = gz > 60 * 1024 ? "error" : gz > 48 * 1024 ? "warn" : "ok";
      setCheck({ id: "weight", level, label: "Page weight",
        detail: `${kb(gz)} gzipped HTML, CSS, SVG and script of a 60 KB budget` + (images ? `; plus ${kb(images)} of inlined PNG (served from the CDN when published)` : "") });
    });
    return () => { live = false; };
  }, [settled]); // the documents are read when the edits settle
  return check;
}
