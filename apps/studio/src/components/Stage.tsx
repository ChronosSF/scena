// The canvas. It is not an editor drawing: it is renderParts() output, the same markup
// and CSS the published page uses, scoped to .stage. On top sits a thin overlay SVG in the
// tool's own style: a 1 px accent selection box, corner and rotate handles, and a small
// toolbar (forward, back, delete), all sized in screen pixels whatever the zoom.
//
// The scene SVG is written imperatively (innerHTML in a layout effect) rather than as
// React children: during a drag the live group is moved directly, 60 times a second,
// without re-rendering, and keyboard focus is carried across re-renders by layer id.

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { layerBBox, layerCenter, layerToCanvas, renderParts, scaleOf, slotStatus, transformAttr, translateForCenter, type Point } from "@scena/renderer";
import { store, useStudio } from "../store.ts";
import { getLayer, round, slotOf } from "../model.ts";
import * as actions from "../actions.ts";
import { announce } from "../ui.ts";
import { useDocumentHidden, useReducedMotion } from "../hooks.ts";
import { assetHref } from "../assets.ts";
import { frameCount } from "../frames.ts";

interface Drag {
  kind: "move" | "scale" | "rotate";
  id: string;
  pointerId: number;
  p0: Point;
  t0: { x: number; y: number; rotate: number; scale: number };
  C: Point;
  moved: boolean;
}

const f = (n: number) => Math.round(n * 1000) / 1000;

/** `scale` is the workspace zoom, so handles can be sized in screen pixels. */
export function Stage({ scale = 1 }: { scale?: number }) {
  const { scene, page, sel, view, forceMotion, rev, focus, playFrames, frameAt, framesOpen } = useStudio();
  const reduced = useReducedMotion();
  const hidden = useDocumentHidden();
  const svgHost = useRef<HTMLDivElement>(null);
  const fig = useRef<HTMLElement>(null);
  const drag = useRef<Drag | null>(null);
  const lastSvg = useRef("");
  const [, bumpOverlay] = useReducer((x: number) => x + 1, 0);
  const [dragEnd, bumpDragEnd] = useReducer((x: number) => x + 1, 0);
  const [figWidth, setFigWidth] = useState(0); // untransformed layout width

  const layer = getLayer(scene, sel);
  const slot = slotOf(scene, layer);
  // Dependencies are deliberate: rev covers every document change (documents are mutated in
  // place), and the selection and the motion override change the markup too.
  const parts = useMemo(
    () => renderParts(scene, page, { editor: true, idPrefix: "ed-", scope: ".stage", selected: slot?.id, assetHref, forceMotion }),
    [rev, slot?.id, forceMotion],
  );

  const layerEl = (id: string) => svgHost.current?.querySelector<SVGGElement>(`[data-layer="${CSS.escape(id)}"]`) || null;
  const sceneSvg = () => svgHost.current?.querySelector("svg") || null;

  // Write the scene SVG, keeping focus on the same drawing. Skipped mid-drag.
  useLayoutEffect(() => {
    const host = svgHost.current;
    if (!host || drag.current || parts.svg === lastSvg.current) return;
    const active = document.activeElement;
    const focused = active && host.contains(active) ? active.closest("[data-layer]")?.getAttribute("data-layer") : null;
    host.innerHTML = parts.svg;
    lastSvg.current = parts.svg;
    if (focused) layerEl(focused)?.focus({ preventScroll: true });
  }, [parts.svg, dragEnd]);

  // Focus requests (a sample was added, a drawing was selected from elsewhere).
  useEffect(() => {
    if (focus?.target === "layer") layerEl(focus.id)?.focus({ preventScroll: true });
  }, [focus?.n]);

  useEffect(() => {
    const el = fig.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFigWidth(el.offsetWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ------------------------------------------------------------ boil
  const fx = scene.effects?.boil;
  const motion = page.motion;
  const want = !!fx?.enabled && motion !== "off" && (!reduced || forceMotion) && !hidden && view === "edit";
  const seeds = !fx ? [] : motion === "reduced" ? fx.seeds.slice(0, 2) : fx.seeds;
  const ms = motion === "reduced" ? 400 : fx?.intervalMs || 150;
  const boilKey = want ? `${seeds.join(",")}/${ms}` : "";
  useEffect(() => {
    if (!boilKey) return;
    let k = 0;
    const timer = setInterval(() => {
      if (drag.current) return;
      k = (k + 1) % seeds.length;
      svgHost.current?.querySelectorAll("filter.boil feTurbulence").forEach((t) => t.setAttribute("seed", String(seeds[k])));
    }, ms);
    return () => clearInterval(timer);
  }, [boilKey]);

  // ------------------------------------------------------------ pointer
  function toCanvas(clientX: number, clientY: number): Point | null {
    const m = sceneSvg()?.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: pt.x, y: pt.y };
  }

  function onPointerDown(e: PointerEvent<HTMLElement>) {
    if (view !== "edit" || e.button > 0) return;
    const target = e.target as Element;
    const action = target.closest<HTMLElement>("[data-act]");
    if (action && sel) {
      e.preventDefault();
      const a = action.dataset.act;
      if (a === "delete") actions.remove(sel); else actions.reorder(sel, a === "forward" ? 1 : -1);
      return;
    }
    const handle = target.closest<SVGElement>("[data-h]");
    const el = target.closest<SVGElement>("[data-layer]");
    if (!handle && !el) {
      if (target.closest(".desk")) store.select(null);
      return;
    }
    const id = handle ? sel : el!.dataset.layer || null;
    if (!id) return;
    if (!handle && id !== sel) store.select(id);
    const L = getLayer(store.getSnapshot().scene, id);
    if (!L || !L.transform) return;
    const p0 = toCanvas(e.clientX, e.clientY);
    if (!p0) return;
    drag.current = {
      kind: handle ? (handle.dataset.h as Drag["kind"]) : "move", id, pointerId: e.pointerId, p0,
      t0: { x: L.transform.x, y: L.transform.y, rotate: L.transform.rotate || 0, scale: scaleOf(L) },
      C: layerCenter(scene, L), moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.classList.add("dragging");
    if (handle) e.preventDefault();
  }

  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const sc = store.getSnapshot().scene;
    const p = toCanvas(e.clientX, e.clientY);
    const L = getLayer(sc, d.id);
    if (!p || !L || !L.transform) return;
    const { t0, p0, C } = d;
    if (!d.moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 1.5) return;
    if (!d.moved) store.checkpoint(); // one undo step per gesture
    d.moved = true;
    let t;
    if (d.kind === "move") {
      t = { ...L.transform, x: round(t0.x + p.x - p0.x), y: round(t0.y + p.y - p0.y) };
    } else if (d.kind === "scale") {
      const d0 = Math.hypot(p0.x - C.x, p0.y - C.y) || 1;
      const s = Math.min(20, Math.max(0.03, t0.scale * (Math.hypot(p.x - C.x, p.y - C.y) / d0)));
      const tr = translateForCenter(sc, L, C, t0.rotate, s);
      t = { ...L.transform, x: round(tr.x), y: round(tr.y), scale: Math.round(s * 1000) / 1000 };
    } else {
      const a = (Math.atan2(p.y - C.y, p.x - C.x) - Math.atan2(p0.y - C.y, p0.x - C.x)) * (180 / Math.PI);
      let r = ((((t0.rotate + a + 180) % 360) + 360) % 360) - 180;
      r = Math.round(r * 10) / 10;
      const tr = translateForCenter(sc, L, C, r, t0.scale);
      t = { ...L.transform, x: round(tr.x), y: round(tr.y), rotate: r };
    }
    L.transform = t; // live, in place; committed on release
    // scale is shown with a temporary group scale until release re-renders the parts
    layerEl(d.id)?.setAttribute("transform", transformAttr(t) + (d.kind === "scale" ? ` scale(${Math.round(((t.scale ?? 1) / t0.scale) * 1000) / 1000})` : ""));
    bumpOverlay();
  }

  function onPointerEnd(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    e.currentTarget.classList.remove("dragging");
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (d.moved) {
      store.change(({ scene: sc }) => {
        const L = getLayer(sc, d.id);
        if (L?.transform?.scale === 1) delete L.transform.scale;
        if (L?.transform && !L.transform.rotate) delete L.transform.rotate;
      }, { noHistory: true });
    } else {
      bumpDragEnd(); // a click: show the selection that was held back during the press
    }
  }

  // ------------------------------------------------------------ keyboard, focus, clicks
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const el = (e.target as Element).closest?.("[data-layer]");
    if (!el || !svgHost.current?.contains(el) || view !== "edit") return;
    const id = el.getAttribute("data-layer")!;
    const sc = store.getSnapshot().scene;
    const L = getLayer(sc, id);
    if (!L || !L.transform) return;
    const t = { ...L.transform };
    const step = e.shiftKey ? 10 : 2;
    switch (e.key) {
      case "ArrowLeft": t.x = round(t.x - step); break;
      case "ArrowRight": t.x = round(t.x + step); break;
      case "ArrowUp": t.y = round(t.y - step); break;
      case "ArrowDown": t.y = round(t.y + step); break;
      case "[": case "]": {
        const r = Math.round(((t.rotate || 0) + (e.key === "]" ? 1 : -1) * (e.shiftKey ? 15 : 5)) * 10) / 10;
        const tr = translateForCenter(sc, L, layerCenter(sc, L), r, scaleOf(L));
        Object.assign(t, { x: round(tr.x), y: round(tr.y), rotate: r });
        break;
      }
      case "+": case "=": case "-": case "_": {
        const s = Math.min(20, Math.max(0.03, Math.round(scaleOf(L) * (e.key === "-" || e.key === "_" ? 0.94 : 1.06) * 1000) / 1000));
        const tr = translateForCenter(sc, L, layerCenter(sc, L), t.rotate || 0, s);
        Object.assign(t, { x: round(tr.x), y: round(tr.y), scale: s });
        break;
      }
      case "Delete": case "Backspace": e.preventDefault(); actions.remove(id); return;
      case "PageUp": e.preventDefault(); actions.reorder(id, 1); return;
      case "PageDown": e.preventDefault(); actions.reorder(id, -1); return;
      case "Escape": store.select(null); (el as SVGElement).blur(); return;
      case "Enter": case " ":
        e.preventDefault();
        store.select(id);
        announce(`${L.name || id} selected. Arrows move, brackets rotate, plus and minus resize.`);
        return;
      default: return;
    }
    e.preventDefault();
    store.change(({ scene: s2 }) => { const l2 = getLayer(s2, id); if (l2) l2.transform = t; });
  }

  function onFocus(e: { target: EventTarget }) {
    const el = (e.target as Element).closest?.("[data-layer]");
    const id = el?.getAttribute("data-layer");
    if (el && id && svgHost.current?.contains(el) && id !== store.getSnapshot().sel) store.select(id);
  }

  // Links inside the canvas never navigate; list entries select their drawing.
  function onClick(e: MouseEvent<HTMLElement>) {
    const a = (e.target as Element).closest("a");
    if (!a) return;
    e.preventDefault();
    const k = a.dataset.k;
    const target = k && scene.layers.find((l) => l.type === "object" && l.slotId === k);
    if (target) store.select(target.id);
  }

  // ------------------------------------------------------------ overlay
  const status = slot ? slotStatus(slot, page.links[slot.id]) : null;
  // backgrounds are set in the inspector (fit, placement), not dragged: no handles
  const b = layer && view === "edit" && layer.type !== "background" ? layerBBox(scene, layer, status) : null;
  let overlay = null, toolbar = null;
  if (layer && b && layer.transform) {
    const u = scene.canvas.width / ((figWidth || scene.canvas.width) * scale); // canvas units per screen pixel
    const s = scaleOf(layer);
    const pad = 4 * u;
    const x0 = b.x * s - pad, y0 = b.y * s - pad, w = b.w * s + pad * 2, hh = b.h * s + pad * 2;
    const cx = x0 + w / 2, stalk = 22 * u, knob = 8 * u;
    const hit = 20 * u; // 40 px hit areas on screen, at any zoom
    const corners = [["nw", x0, y0], ["ne", x0 + w, y0], ["sw", x0, y0 + hh], ["se", x0 + w, y0 + hh]] as const;
    const pts = corners.map(([, x, y]) => layerToCanvas(layer.transform!, x, y));
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x)), maxY = Math.max(...pts.map((p) => p.y));
    // the toolbar stays upright below the rotated box, at a constant size on screen
    toolbar = (
      <div className="ov-tools" aria-hidden="true" style={{
        left: `${f((((minX + maxX) / 2) / scene.canvas.width) * 100)}%`,
        top: `${f((maxY / scene.canvas.height) * 100)}%`,
        transform: `translate(-50%, ${f(12 / scale)}px) scale(${f(1 / scale)})`,
      }}>
        {([["forward", "Bring forward", ArrowUp], ["back", "Send back", ArrowDown], ["delete", "Delete", Trash2]] as const).map(([act, title, Icon]) => (
          <button key={act} type="button" tabIndex={-1} className={act === "delete" ? "danger" : undefined} data-act={act} title={title}>
            <Icon aria-hidden="true" strokeWidth={1.75} />
          </button>
        ))}
      </div>
    );
    overlay = (
      <g transform={transformAttr(layer.transform)}>
        <rect className="ov-box" x={f(x0)} y={f(y0)} width={f(w)} height={f(hh)} strokeWidth={f(u)} />
        <line className="ov-stalk" x1={f(cx)} y1={f(y0)} x2={f(cx)} y2={f(y0 - stalk)} strokeWidth={f(u)} />
        <g className="ov-h" data-h="rotate">
          <title>Drag to rotate</title>
          <circle className="ov-hit" cx={f(cx)} cy={f(y0 - stalk)} r={f(hit)} />
          <circle className="ov-knob" cx={f(cx)} cy={f(y0 - stalk)} r={f(knob / 2 + 0.5 * u)} strokeWidth={f(u)} />
        </g>
        {corners.map(([pos, x, y]) => (
          <g key={pos} className={`ov-h ${pos}`} data-h="scale">
            <title>Drag to resize</title>
            <circle className="ov-hit" cx={f(x)} cy={f(y)} r={f(hit)} />
            <rect className="ov-knob" x={f(x - knob / 2)} y={f(y - knob / 2)} width={f(knob)} height={f(knob)} rx={f(1.5 * u)} strokeWidth={f(u)} />
          </g>
        ))}
      </g>
    );
  }

  // Frames: "Play on the canvas" off holds every drawing still; the selected one shows the
  // chosen frame, and while the Frames section is open the other frames show faintly behind it.
  const frames = layer ? frameCount(layer) : 1;
  const hold = !playFrames && layer && frames > 1 ? `[data-layer="${CSS.escape(layer.id)}"] .fr` : "";
  const holdCss = hold
    ? `#stage ${hold}{opacity:${framesOpen ? ".2" : "0"}!important}#stage ${hold}:nth-child(${Math.min(frameAt, frames - 1) + 1}){opacity:1!important}`
    : "";

  return (
    <div className="stage" id="stage" role="region" aria-label="Canvas: your page as visitors see it, editable"
      data-theme={parts.rootAttrs.theme || undefined} data-motion={parts.rootAttrs.motion || undefined} data-fr={playFrames ? undefined : "off"}
      onKeyDown={onKeyDown} onFocus={onFocus} onClick={onClick}>
      {holdCss ? <style>{holdCss}</style> : null}
      <div className="page">
        <div className="st-header" dangerouslySetInnerHTML={{ __html: parts.header }} />
        <figure className="desk" ref={fig} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
          <div className="st-svg" ref={svgHost} />
          <svg className="ov" aria-hidden="true" focusable="false" viewBox={`0 0 ${scene.canvas.width} ${scene.canvas.height}`}>{overlay}</svg>
          {toolbar}
        </figure>
        <div className="st-panel" dangerouslySetInnerHTML={{ __html: parts.panel }} />
        <div className="st-list" dangerouslySetInnerHTML={{ __html: parts.list }} />
        <div className="st-foot" dangerouslySetInnerHTML={{ __html: parts.foot }} />
      </div>
    </div>
  );
}
