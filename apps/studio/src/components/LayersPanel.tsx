import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowDown, ArrowRight, ArrowUp, ChevronRight, Ellipsis, Eye, EyeOff, Film, Link, Shapes, Trash2, Upload } from "lucide-react";
import { resolvePalette } from "@scena/renderer";
import { DESK_SCENE, PIA_PAGE } from "@scena/scenes";
import type { Layer } from "@scena/scene";
import { store, useStudio } from "../store.ts";
import { SAMPLES, drawings, isHidden } from "../model.ts";
import { SENTINELS } from "../ingest/svg.ts";
import { drawingThumb } from "../thumbs.ts";
import * as actions from "../actions.ts";
import { usePrefersDark } from "../hooks.ts";
import { announce } from "../ui.ts";
import { frameCount } from "../frames.ts";
import { Button, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger, Tip } from "./ui.tsx";

export const openFilePicker = () => document.getElementById("file")?.click();

/** The five desk objects, rendered once with the desk's own palette for the menu. */
const SAMPLE_THUMBS = SAMPLES.map((s) => ({ s, svg: drawingThumb({ ...DESK_SCENE, assets: s.assets }, PIA_PAGE, s.layer, `menu-${s.key}`) }));

export function SamplesMenu({ trigger }: { trigger: "button" | "empty" }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        {trigger === "button"
          ? <button type="button" className="btn" data-ui="samples"><Shapes aria-hidden="true" strokeWidth={1.75} />Samples</button>
          : <button type="button" className="btn"><Shapes aria-hidden="true" strokeWidth={1.75} />Add a sample</button>}
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>Sample drawings from Pia's desk</MenuLabel>
        {SAMPLE_THUMBS.map(({ s, svg }) => (
          <MenuItem key={s.key} onSelect={() => actions.addSample(s.key)} data-sample={s.key}>
            <span className="menu-thumb"><span className="stage thumb-scope" dangerouslySetInnerHTML={{ __html: svg }} /></span>
            {s.name}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function ColourHelp() {
  const { scene, page } = useStudio();
  const prefersDark = usePrefersDark();
  const pal = resolvePalette(scene, page);
  const mode = page.theme.mode === "auto" ? (prefersDark ? "dark" : "light") : page.theme.mode;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="colour-hint" data-ui="colour-help">
          <span className="sw-dots" aria-hidden="true">{SENTINELS.map((s) => <i key={s.hex} style={{ background: s.hex }} />)}</span>
          Paint in three colours
          <ChevronRight aria-hidden="true" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent label="How colours work" align="start">
        <p className="pop-title">Paint in three colours</p>
        <p className="pop-sub">Paint with these three and we recolour to any palette.</p>
        <ul className="sentinels">
          {SENTINELS.map((s) => (
            <li className="sentinel" key={s.hex}>
              <span className="sw" style={{ background: s.hex }} />
              <code>{s.hex}</code>
              <ArrowRight aria-hidden="true" strokeWidth={1.75} />
              <span className="sw" style={{ background: pal[mode][s.role] }} />
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
        <p className="pop-sub">Fills in the two colours print slightly off-register, like riso. Other colours stay as you drew them; PNGs keep their own colours.</p>
      </PopoverContent>
    </Popover>
  );
}

function LayerRow(props: { layer: Layer; index: number; count: number; dragging: boolean; onDragStart: (e: PointerEvent<HTMLLIElement>, id: string) => void }) {
  const { scene, page, sel, rev } = useStudio();
  const { layer, index, count } = props;
  const name = layer.name || layer.id;
  const isSel = layer.id === sel;
  const hidden = isHidden(page, layer);
  const theme = page.theme.mode === "auto" ? undefined : page.theme.mode;
  const thumb = useMemo(() => drawingThumb(scene, page, layer, `th-${layer.id}`), [rev, layer.id]); // documents mutate in place

  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    const rows = [...document.querySelectorAll<HTMLButtonElement>("[data-layer-button]")];
    const i = rows.indexOf(e.currentTarget);
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      actions.reorder(layer.id, e.key === "ArrowUp" ? 1 : -1);
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-layer-button="${CSS.escape(layer.id)}"]`)?.focus());
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      rows[i + (e.key === "ArrowUp" ? -1 : 1)]?.focus();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      actions.remove(layer.id);
    }
  }

  return (
    <li className={`layer${isSel ? " is-sel" : ""}${hidden ? " is-hidden" : ""}${props.dragging ? " dragging" : ""}`} data-layer-row={layer.id}
      onPointerDown={(e) => props.onDragStart(e, layer.id)}>
      {/* one tab stop for the list (roving): the selected row, or the first; arrows move between rows */}
      <button type="button" className="layer-main" data-layer-button={layer.id} aria-pressed={isSel} onClick={() => store.select(layer.id)} onKeyDown={onKey}
        tabIndex={isSel || (!sel && index === 0) ? 0 : -1}
        aria-describedby="layers-help">
        <span className="layer-thumb">{thumb ? <span className="stage thumb-scope" data-theme={theme} dangerouslySetInnerHTML={{ __html: thumb }} /> : <Shapes aria-hidden="true" strokeWidth={1.75} />}</span>
        <span className="layer-name">{name}</span>
        {frameCount(layer) > 1 ? <span className="layer-frames" title={`${frameCount(layer)} frames`}><Film aria-hidden="true" strokeWidth={2} />{frameCount(layer)}<span className="sr-only"> frames</span></span> : null}
        {layer.type === "object" ? <span className="layer-badge"><Link aria-hidden="true" strokeWidth={2} />Link</span> : null}
        {hidden ? <span className="sr-only">(hidden)</span> : null}
      </button>
      <span className="layer-tools">
        <IconButton size="sm" icon={hidden ? EyeOff : Eye} label={hidden ? `Show ${name} on the page` : `Hide ${name} from the page`} onClick={() => actions.toggleHidden(layer.id)} data-ui="visibility" tabIndex={isSel ? 0 : -1} />
        <Menu>
          <Tip label="More">
            <MenuTrigger asChild>
              <button type="button" className="icon-btn sm" aria-label={`More for ${name}`} tabIndex={isSel ? 0 : -1}><Ellipsis aria-hidden="true" strokeWidth={1.75} /></button>
            </MenuTrigger>
          </Tip>
          <MenuContent align="end">
            <MenuItem icon={ArrowUp} onSelect={() => actions.reorder(layer.id, 1)} disabled={index === 0} meta="Alt+↑">Bring forward</MenuItem>
            <MenuItem icon={ArrowDown} onSelect={() => actions.reorder(layer.id, -1)} disabled={index === count - 1} meta="Alt+↓">Send back</MenuItem>
            <MenuSeparator />
            <MenuItem icon={Trash2} onSelect={() => actions.remove(layer.id)} danger meta="Del">Delete</MenuItem>
          </MenuContent>
        </Menu>
      </span>
    </li>
  );
}

export function LayersPanel(props: { hidden?: boolean; tabbed?: boolean }) {
  const { scene, focus } = useStudio();
  const items = drawings(scene).slice().reverse(); // front to back
  const list = useRef<HTMLOListElement>(null);
  const drag = useRef<{ id: string; startY: number; pointerId: number; active: boolean; target: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  // After a delete, focus moves to the neighbouring drawing's row.
  useEffect(() => {
    if (focus?.target !== "list") return;
    list.current?.querySelector<HTMLButtonElement>(`[data-layer-button="${CSS.escape(focus.id)}"]`)?.focus();
  }, [focus?.n]);

  function slotFor(y: number): number {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-layer-row]") || [])];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!.getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return rows.length;
  }
  function onDragStart(e: PointerEvent<HTMLLIElement>, id: string) {
    if (e.button !== 0 || e.pointerType === "touch" || (e.target as Element).closest(".layer-tools")) return;
    drag.current = { id, startY: e.clientY, pointerId: e.pointerId, active: false, target: -1 };
  }
  function onMove(e: PointerEvent<HTMLOListElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.active) {
      if (Math.abs(e.clientY - d.startY) < 5) return;
      d.active = true; // capture only once it is really a drag, so plain clicks still select
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragId(d.id);
    }
    const slot = slotFor(e.clientY);
    d.target = slot;
    setDropAt(slot);
  }
  function onUp(e: PointerEvent<HTMLOListElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.active || d.pointerId !== e.pointerId) return;
    setDragId(null);
    setDropAt(null);
    const from = items.findIndex((l) => l.id === d.id);
    const to = d.target > from ? d.target - 1 : d.target;
    if (from >= 0 && to !== from) {
      actions.moveDrawing(d.id, to);
      announce(`Moved ${items[from]!.name || d.id} to position ${to + 1} of ${items.length}.`);
    }
    // swallow the click that follows a drag
    const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
  }

  const dropTop = (() => {
    if (dropAt === null || !list.current) return null;
    const rows = [...list.current.querySelectorAll<HTMLElement>("[data-layer-row]")];
    const ref = rows[dropAt] || rows[rows.length - 1];
    if (!ref) return null;
    return dropAt < rows.length ? ref.offsetTop - 1 : ref.offsetTop + ref.offsetHeight;
  })();

  return (
    <aside className="panel panel-left" id="panel-layers" aria-label="Layers" hidden={props.hidden}
      {...(props.tabbed ? { role: "tabpanel", "aria-labelledby": "tab-layers" } : {})}>
      <div className="panel-head">
        <h2 className="panel-title">Layers</h2>
      </div>
      <div className="add">
        <div className="add-actions">
          <Button icon={Upload} onClick={openFilePicker} data-ui="upload">Upload</Button>
          <SamplesMenu trigger="button" />
        </div>
        <button type="button" className="drop" onClick={openFilePicker} data-ui="drop">
          <Upload aria-hidden="true" strokeWidth={1.75} /> Drop SVG or PNG files here
        </button>
        <ColourHelp />
        <input type="file" id="file" accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp" multiple hidden
          onChange={(e) => { const fs = [...(e.target.files || [])]; e.target.value = ""; if (fs.length) void actions.addFiles(fs); }} />
      </div>
      <div className="layers-head">
        <span className="section-title" id="layers-title">Front to back</span>
        <span className="count-badge">{items.length || ""}</span>
      </div>
      <p className="sr-only" id="layers-help">Arrow keys move between drawings, Enter selects. Alt with an arrow moves a drawing forward or back. Delete removes it.</p>
      {items.length ? (
        <ol className="layers" ref={list} aria-labelledby="layers-title" style={{ position: "relative" }}
          onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {items.map((l, i) => <LayerRow key={l.id} layer={l} index={i} count={items.length} dragging={dragId === l.id} onDragStart={onDragStart} />)}
          {dropTop !== null ? <span className="layer-drop-line" style={{ top: dropTop }} aria-hidden="true" /> : null}
        </ol>
      ) : (
        <p className="empty-layers">No drawings yet. Upload your own, or start from a sample.</p>
      )}
      <div className="panel-foot">
        <button type="button" className="link-btn" onClick={actions.openDesk} data-ui="open-desk">Open Pia's finished desk</button> to see a whole page made the same way.
      </div>
    </aside>
  );
}
