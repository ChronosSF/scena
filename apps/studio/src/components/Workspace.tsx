// The workspace: a neutral surface with the page floating in it at a sensible zoom.
// Zoom is a CSS transform on the page; pointer maths on the canvas uses getScreenCTM,
// which includes it, and the selection handles stay a constant size on screen.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImagePlus, Minus, Plus, Upload } from "lucide-react";
import { store, useStudio } from "../store.ts";
import { useNarrow, useReducedMotion } from "../hooks.ts";
import { toast } from "../ui.ts";
import { drawings } from "../model.ts";
import * as actions from "../actions.ts";
import { Stage } from "./Stage.tsx";
import { Preview } from "./Preview.tsx";
import { Button, IconButton, Switch, Tip } from "./ui.tsx";
import { openFilePicker, SamplesMenu } from "./LayersPanel.tsx";

const PAGE_W = 480; // the published page's column at its widest (30rem)
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3];
const PAD_X = 80, PAD_TOP = 56, PAD_BOTTOM = 88, PAD_X_NARROW = 24;

export const zoomIn = (s: number) => store.set({ zoom: STEPS.find((z) => z > s + 0.001) ?? STEPS[STEPS.length - 1]! });
export const zoomOut = (s: number) => store.set({ zoom: [...STEPS].reverse().find((z) => z < s - 0.001) ?? STEPS[0]! });

export function Workspace() {
  const { view, zoom, scene, page, forceMotion } = useStudio();
  const empty = drawings(scene).length === 0;
  const reduced = useReducedMotion();
  const narrow = useNarrow();
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [nat, setNat] = useState({ h: 1200, fitH: 760, deskX: 240, deskY: 400 });

  // workspace size
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);
  // the page's natural (unscaled) height, and how much of it Fit should show: the header and the drawing
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const measure = () => {
      const desk = el.querySelector<HTMLElement>("#stage .desk");
      const stage = el.querySelector<HTMLElement>("#stage");
      // offsets relative to the unscaled page; the desk's offsetParent is the stage
      const top = desk ? desk.offsetTop : 0;
      setNat({
        h: el.offsetHeight,
        fitH: desk ? top + desk.offsetHeight + 28 : el.offsetHeight,
        deskX: desk ? desk.offsetLeft + desk.offsetWidth / 2 : (stage?.offsetWidth || PAGE_W) / 2,
        deskY: desk ? top + desk.offsetHeight / 2 : 400,
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [view]);

  // Fit shows the whole width and, on a desktop, the header and the drawing, never past 100%
  // (raster drawings would blur); on a phone the
  // workspace is short, so it fits the width only and the page scrolls.
  const fit = !box.w ? 1 : narrow
    ? Math.max(0.25, Math.min(1, (box.w - PAD_X_NARROW) / PAGE_W))
    : Math.max(0.25, Math.min(1, (box.w - PAD_X) / PAGE_W, (box.h - PAD_TOP - PAD_BOTTOM + 40) / nat.fitH));
  const s = zoom === "fit" ? Math.round(fit * 100) / 100 : zoom;

  // Ctrl or Cmd + wheel (and trackpad pinch) zooms the canvas
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const cur = store.getSnapshot().zoom;
      const base = cur === "fit" ? s : cur;
      store.set({ zoom: Math.max(0.25, Math.min(3, Math.round(base * Math.exp(-e.deltaY / 300) * 100) / 100)) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [s, view]);

  if (view === "preview") {
    return (
      <main className="workspace" id="workspace" aria-label="Preview">
        <div className="workspace-scroll"><Preview /></div>
      </main>
    );
  }

  return (
    <main className="workspace" id="workspace" aria-label="Canvas">
      <div className="workspace-scroll" ref={scroll}>
        {/* a press on the empty workspace around the page clears the selection, as in any canvas tool */}
        <div className="canvas-area" onPointerDown={(e) => { if (!(e.target as Element).closest("#stage, .empty-card, .frame-label")) store.select(null); }}>
          <div>
            <div className="frame-label" style={{ width: PAGE_W * s }}>
              <span className="frame-url">scena.example/{page.handle}</span>
              <span>{scene.canvas.width} × {scene.canvas.height}</span>
            </div>
            <div className="zoom-box" style={{ width: PAGE_W * s, height: nat.h * s }}>
              <div className="zoom-content" ref={content} style={{ transform: `scale(${s})` }}>
                <Stage scale={s} />
              </div>
              {empty ? (
                // chrome, not page: kept outside the page's scoped CSS and unscaled by the zoom
                <div className="empty-card" data-ui="empty" style={{ left: nat.deskX * s, top: nat.deskY * s }}>
                  <span className="empty-icon" aria-hidden="true"><ImagePlus strokeWidth={1.75} /></span>
                  <p className="empty-title">Add your first drawing</p>
                  <p className="empty-text">Drop an SVG or a transparent PNG anywhere, or start from one of Pia's sketches.</p>
                  <div className="empty-actions">
                    <Button variant="primary" icon={Upload} onClick={openFilePicker}>Upload</Button>
                    <SamplesMenu trigger="empty" />
                  </div>
                  {/* the other way to a page: a scene that is already drawn, to fill in */}
                  <p className="empty-alt">No drawings of your own? <button type="button" className="link-btn" onClick={actions.openBuiltInDesk} data-ui="empty-builtin">Fill in a ready-made scene</button>.</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <div className="float zoom-ctrl" role="group" aria-label="Zoom">
        <IconButton icon={Minus} label="Zoom out" tipSide="top" className="hide-narrow" onClick={() => zoomOut(s)} disabled={s <= 0.25} />
        <span className="zoom-readout num" aria-live="polite" style={{ display: "inline-grid", placeItems: "center" }}>{Math.round(s * 100)}%</span>
        <IconButton icon={Plus} label="Zoom in" tipSide="top" className="hide-narrow" onClick={() => zoomIn(s)} disabled={s >= 3} />
        <span className="sep" aria-hidden="true" />
        <Tip label="Zoom to fit" shortcut="Shift+1" side="top">
          <button type="button" className="zoom-readout" aria-pressed={zoom === "fit"} data-ui="zoom-fit" onClick={() => store.set({ zoom: "fit" })}>Fit</button>
        </Tip>
        <Tip label="Actual size" shortcut="Shift+0" side="top">
          <button type="button" className="zoom-readout" aria-pressed={zoom === 1} data-ui="zoom-100" onClick={() => store.set({ zoom: 1 })}>100%</button>
        </Tip>
      </div>
      {reduced ? (
        <div className="float motion-chip">
          <span className="hide-narrow">Motion reduced by your system</span>
          <Tip label="Animate the canvas and preview anyway. Published pages still respect each visitor's setting." side="top">
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ui-text)" }}>
              Animate
              <Switch label="Animate the canvas anyway" checked={forceMotion} onChange={() => {
                store.set({ forceMotion: !forceMotion });
                toast(!forceMotion ? "Boiling for this session. Published pages still respect each visitor's reduced-motion setting." : "Lines held still, as your system asks.");
              }} />
            </label>
          </Tip>
        </div>
      ) : null}
    </main>
  );
}
