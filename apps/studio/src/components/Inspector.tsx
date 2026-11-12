import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Maximize2, RotateCw, Shapes, Trash2 } from "lucide-react";
import { LIMITS, safeHref, type CommissionStatus, type Layer, type LinkContent, type Motion, type ObjectLayer, type SlotKind } from "@scena/scene";
import { store, useStudio } from "../store.ts";
import { CANVASES, KIND_LABELS, SURFACES, canTurnOff, currentSurface, defaultLink, getLayer, isBuiltIn, offeredPalettes, slotOf, type Surface } from "../model.ts";
import { drawingThumb, thumbTheme } from "../thumbs.ts";
import { assetSummary } from "../describe.ts";
import * as actions from "../actions.ts";
import { APPEARANCE, SceneNameInput, setAppearance } from "./TopBar.tsx";
import { IconButton, NumberField, Section, Segmented, SelectField, Switch, TextField } from "./ui.tsx";
import { FramesSection } from "./FramesSection.tsx";
import { BackgroundInspector, LetteringSection, TypefaceSection, UseAsSection } from "./BoardSections.tsx";
import { isBackground } from "../board.ts";

const HANDLE = /^[a-z0-9][a-z0-9_-]{1,29}$/;
const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export function Inspector(props: { hidden?: boolean; tabbed?: boolean }) {
  const { scene, sel } = useStudio();
  const locked = isBuiltIn(scene);
  const picked = getLayer(scene, sel);
  // a built-in scene offers its links and the page; nothing else on it is there to select
  const layer = locked && picked?.type !== "object" ? undefined : picked;
  const label = !layer ? "Page settings" : locked ? "Link settings" : isBackground(scene, layer) ? "Background settings" : "Drawing settings";
  return (
    <aside className="panel panel-right" id="inspector" tabIndex={-1} aria-label={label} hidden={props.hidden}
      {...(props.tabbed ? { role: "tabpanel", "aria-labelledby": "tab-inspect" } : {})}>
      {!layer ? <PageInspector />
        : locked && layer.type === "object" ? <SlotInspector key={layer.id} layer={layer} />
        : isBackground(scene, layer) ? <BackgroundInspector key={layer.id} layer={layer} />
        : <LayerInspector key={layer.id} layer={layer} />}
    </aside>
  );
}

// ------------------------------------------------------------------ a link

/** The words and the address of one link. The same fields serve a drawing of your own and a slot of a built-in scene. */
function LinkFields({ slotId }: { slotId: string }) {
  const { page } = useStudio();
  const link = page.links[slotId];
  if (!link) return null;
  const editLink = (fn: (l: LinkContent) => void) => store.change(({ page: p }) => { const l = p.links[slotId]; if (l) fn(l); });
  return (
    <>
      <TitleField slotId={slotId} />
      <TextField label="Description" value={link.description} max={LIMITS.description} multiline name="link-description" onChange={(v) => editLink((l) => { l.description = v; })} />
      <TextField label="Button text" value={link.cta} max={40} name="link-cta" onChange={(v) => editLink((l) => { l.cta = v; })} />
      <UrlField slotId={slotId} />
      <TextField label="Wording in the plain list" value={link.listLabel || ""} max={60} placeholder={link.title || "Same as the title"}
        hint="The text-only list under the drawing, for screen readers and quick visitors."
        onChange={(v) => editLink((l) => { if (v) l.listLabel = v; else delete l.listLabel; })} />
    </>
  );
}

/**
 * A field whose value in the document has to stay valid, so that saved work always opens.
 * The field shows what was typed; the document gets a value only when the caller says which
 * (the typed text when it is valid, something safe otherwise, or nothing, which leaves the
 * document as it is). When the document changes from elsewhere (undo, a rename, an import)
 * the field follows it.
 */
function useDraft(inDocument: string, write: (v: string) => void): [string, (typed: string, toStore?: string) => void] {
  const [draft, setDraft] = useState(inDocument);
  const wrote = useRef(inDocument); // what this field last put in the document
  useEffect(() => {
    if (inDocument === wrote.current) return;
    wrote.current = inDocument;
    setDraft(inDocument);
  }, [inDocument]);
  return [draft, (typed, toStore) => {
    setDraft(typed);
    if (toStore === undefined || toStore === inDocument) return;
    wrote.current = toStore;
    write(toStore);
  }];
}

/** A link needs a title to be on, so an emptied field keeps the last title in the document and says why. */
function TitleField({ slotId }: { slotId: string }) {
  const { page } = useStudio();
  const link = page.links[slotId];
  const [draft, type] = useDraft(link?.title ?? "", (v) => store.change(({ page: p }) => { const l = p.links[slotId]; if (l) l.title = v; }));
  if (!link) return null;
  return (
    <TextField label="Title" value={draft} max={60} name="link-title"
      check={(v) => (v.trim() ? null : { level: "error", text: link.title ? `A link needs a title. The page keeps "${link.title}" until you type one.` : "A link needs a title." })}
      onChange={(v) => type(v, v.trim() ? v : undefined)} />
  );
}

/**
 * The address is stored only when it is one. While it is not, the link has no address: it
 * does not keep pointing at the one being replaced, and the page stays valid.
 */
function UrlField({ slotId }: { slotId: string }) {
  const { page } = useStudio();
  const link = page.links[slotId];
  const [draft, type] = useDraft(link?.url ?? "", (v) => store.change(({ page: p }) => { const l = p.links[slotId]; if (l) l.url = v; }));
  if (!link) return null;
  return (
    <TextField label="URL" value={draft} type="url" inputMode="url" placeholder="https://… or mailto:…" name="url"
      check={(v) => {
        if (!v.trim()) return { level: "warn", text: "Add an address so the button goes somewhere." };
        const s = safeHref(v);
        if (!s) return { level: "error", text: "Use a web address (https://…) or an email (mailto:…). Until it is one, the link has no address." };
        if (s !== v.trim()) return { level: "", text: `Will open ${s}` };
        return null;
      }}
      onChange={(v) => type(v, safeHref(v) ? v.trim() : "")} />
  );
}

function CommissionFields({ slotId }: { slotId: string }) {
  const { page } = useStudio();
  const link = page.links[slotId];
  if (!link) return null;
  const editLink = (fn: (l: LinkContent) => void) => store.change(({ page: p }) => { const l = p.links[slotId]; if (l) fn(l); });
  return (
    <>
      <Segmented label="Commission status" full value={link.status || "open"} onChange={(v: CommissionStatus) => editLink((l) => { l.status = v; })}
        options={[{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }, { value: "waitlist", label: "Waitlist" }]} />
      <div style={{ marginTop: 12 }}>
        <TextField label="Note" value={link.statusNote || ""} max={80} placeholder="Booking for spring 2027." name="status-note" onChange={(v) => editLink((l) => { l.statusNote = v; })} />
      </div>
    </>
  );
}

/**
 * One slot of a built-in scene: the link's words and address, on or off, and the commission
 * status where the slot has one. The drawing itself is not editable, so there is no name
 * field, placement, frames or tap area here (development plan section 2.3).
 */
function SlotInspector({ layer }: { layer: ObjectLayer }) {
  const { scene, page, rev } = useStudio();
  const slot = slotOf(scene, layer);
  const theme = thumbTheme(page);
  const thumb = useMemo(() => drawingThumb(scene, page, layer, `insp-${layer.id}`), [rev, layer.id]); // documents mutate in place
  if (!slot) return null;
  const link = page.links[slot.id];
  const on = link?.enabled !== false;
  return (
    <div>
      <div className="insp-head">
        <span className="layer-thumb">{thumb ? <span className="stage thumb-scope" data-theme={theme} dangerouslySetInnerHTML={{ __html: thumb }} /> : <Shapes aria-hidden="true" strokeWidth={1.75} />}</span>
        <div className="insp-name">
          <h2 className="insp-title" data-ui="slot-title">{slot.label}</h2>
          <p className="insp-meta">{KIND_LABELS[slot.kind]} link</p>
        </div>
      </div>
      <Section title="Link" action={link && canTurnOff(scene, slot)
        ? <Switch label={`Show ${slot.label} on the page`} checked={on} onChange={() => actions.toggleHidden(layer.id)} id="slot-on" /> : undefined}>
        {link ? (
          <>
            {on ? null : <p className="section-note first">Off: the drawing and its line in the plain list are left out of the page. What you typed is kept.</p>}
            <LinkFields slotId={slot.id} />
          </>
        ) : (
          <>
            <p className="field-hint">This page has nothing for {slot.label} yet.</p>
            <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => store.change(({ page: p }) => { p.links[slot.id] = defaultLink(slot); })}>Set up this link</button>
          </>
        )}
      </Section>
      {slot.statusAware && link ? <Section title="Commissions"><CommissionFields slotId={slot.id} /></Section> : null}
    </div>
  );
}

// ------------------------------------------------------------------ a drawing

function LayerInspector({ layer }: { layer: Layer }) {
  const { scene, page, rev } = useStudio();
  const slot = slotOf(scene, layer);
  const link = slot ? page.links[slot.id] : undefined;
  const clickable = layer.type === "object";
  const name = layer.name || layer.id;
  const t = layer.transform || { x: 0, y: 0 };
  const theme = thumbTheme(page);
  const thumb = useMemo(() => drawingThumb(scene, page, layer, `insp-${layer.id}`), [rev, layer.id]); // documents mutate in place
  const order = scene.layers.filter((l) => l.type !== "background");
  const front = order[order.length - 1]?.id === layer.id, back = order[0]?.id === layer.id;

  const edit = (fn: (l: Layer) => void) => store.change(({ scene: s }) => { const l = getLayer(s, layer.id); if (l) fn(l); });

  return (
    <div>
      <div className="insp-head">
        <span className="layer-thumb">{thumb ? <span className="stage thumb-scope" data-theme={theme} dangerouslySetInnerHTML={{ __html: thumb }} /> : <Shapes aria-hidden="true" strokeWidth={1.75} />}</span>
        <div className="insp-name">
          <input className="input" aria-label="Drawing name" value={name} maxLength={40} data-ui="layer-name"
            onChange={(e) => {
              const v = e.target.value;
              store.change(({ scene: s, page: p }) => {
                const l = getLayer(s, layer.id);
                if (!l) return;
                const was = l.name;
                l.name = v;
                const sl = slotOf(s, l);
                if (sl) {
                  sl.label = v || l.id;
                  const lk = p.links[sl.id];
                  if (lk && v && (lk.title === was || !lk.title)) lk.title = v; // an untouched title follows the name
                }
              });
            }} />
          <p className="insp-meta" title={assetSummary(scene, layer)}>{assetSummary(scene, layer)}</p>
        </div>
        <div className="insp-actions">
          <IconButton size="sm" icon={ArrowUp} label="Bring forward" shortcut="Alt+↑" disabled={front} onClick={() => actions.reorder(layer.id, 1)} />
          <IconButton size="sm" icon={ArrowDown} label="Send back" shortcut="Alt+↓" disabled={back} onClick={() => actions.reorder(layer.id, -1)} />
          <IconButton size="sm" icon={Trash2} label="Delete" shortcut="Del" className="danger" onClick={() => actions.remove(layer.id)} data-ui="delete" />
        </div>
      </div>

      <Section title="Placement">
        <div className="nums">
          <NumberField label="X" prefix="X" value={t.x} onCommit={(v) => actions.moveTo(layer.id, "x", v)} name="x" />
          <NumberField label="Y" prefix="Y" value={t.y} onCommit={(v) => actions.moveTo(layer.id, "y", v)} name="y" />
          <NumberField label="Rotation" prefix={<RotateCw aria-hidden="true" strokeWidth={1.75} />} value={t.rotate || 0} suffix="°" min={-180} max={180} onCommit={(v) => actions.rotateTo(layer.id, v)} name="rotate" />
          <NumberField label="Size" prefix={<Maximize2 aria-hidden="true" strokeWidth={1.75} />} value={Math.round((t.scale ?? 1) * 100)} suffix="%" step={1} min={3} max={2000} onCommit={(v) => actions.scaleTo(layer.id, v / 100)} name="size" />
        </div>
        <p className="section-note">Drag on the canvas, or drag a field's label. Arrows nudge the selected drawing.</p>
      </Section>

      <FramesSection layer={layer} />

      <Section title="Link" action={<Switch label="Clickable" checked={clickable} onChange={() => actions.toggleClickable(layer.id)} id="clickable" />}>
        {clickable && slot && link ? (
          <>
            <SelectField label="Kind" value={slot.kind} onChange={(v: SlotKind) => actions.setKind(slot.id, v)}
              options={(Object.entries(KIND_LABELS) as [SlotKind, string][]).map(([value, label]) => ({ value, label }))} />
            <LinkFields slotId={slot.id} />
          </>
        ) : (
          <p className="field-hint">Decoration for now: it boils with the rest, but nothing happens on tap. Make it clickable to give it a link, a hover lift, a drawn ring and a line in the plain list.</p>
        )}
      </Section>

      {clickable && slot?.statusAware && link ? (
        <Section title="Commissions"><CommissionFields slotId={slot.id} /></Section>
      ) : null}

      {clickable && layer.type === "object" ? (
        <Section title="Tap area">
          {layer.hotspot.shape === "auto" ? (
            <>
              <div className="range-row">
                <input type="range" min={0} max={48} step={1} value={layer.hotspot.pad} aria-label="Padding around the drawing"
                  onChange={(e) => edit((l) => { if (l.type === "object" && l.hotspot.shape === "auto") l.hotspot = { shape: "auto", pad: Number(e.target.value) }; })} />
                <output>{layer.hotspot.pad}</output>
              </div>
              <p className="section-note">Padding around the drawing. The ellipse is the ring visitors see on tap, and taps inside it count.</p>
            </>
          ) : (
            <>
              <p className="field-hint">A hand-placed tap area from the scene.</p>
              <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => edit((l) => { if (l.type === "object") l.hotspot = { shape: "auto", pad: 16 }; })}>Use an automatic tap area</button>
            </>
          )}
        </Section>
      ) : null}

      <UseAsSection layer={layer} />
    </div>
  );
}

// ------------------------------------------------------------------ the page

function PageInspector() {
  const { scene, page } = useStudio();
  // A built-in scene leaves the page its words, its palette and its motion. The lettering, the
  // typeface and the board belong to the scene, so those sections are not shown.
  const locked = isBuiltIn(scene);
  const pal = scene.theme.palettes.find((p) => p.id === page.theme.palette);
  return (
    <div>
      <div className="panel-head">
        <h2 className="panel-title">Page</h2>
        <span className="faint num" style={{ fontSize: 12 }}>scena.example/{page.handle}</span>
      </div>
      <Section title="Profile">
        <NameField name={page.profile.displayName} />
        <TextField label="Bio" value={page.profile.bio} max={LIMITS.bio} multiline name="bio" onChange={(v) => store.change(({ page: p }) => { p.profile.bio = v; })} />
        <HandleField handle={page.handle} />
      </Section>

      {locked ? null : <LetteringSection />}
      {locked ? null : <TypefaceSection />}

      <Section title="Palette">
        <div className="palettes" role="radiogroup" aria-label="Palette">
          {offeredPalettes(scene).map((p) => (
            <label className="pal" key={p.id} title={p.name || p.id}>
              <input type="radio" name="palette" value={p.id} checked={p.id === page.theme.palette} aria-label={p.name || p.id}
                onChange={() => store.change(({ page: pg }) => { pg.theme.palette = p.id; })} />
              <span className="pal-chip" aria-hidden="true">
                <span style={{ background: p.light.paper }}>{(["line", "accent1", "accent2"] as const).map((r) => <i key={r} style={{ background: p.light[r] }} />)}</span>
                <span style={{ background: p.dark.paper }}>{(["line", "accent1", "accent2"] as const).map((r) => <i key={r} style={{ background: p.dark[r] }} />)}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="pal-caption">{pal?.name || pal?.id}</p>
        <p className="section-note">Two-colour riso pairs, each checked for contrast in light and dark.</p>
      </Section>

      <Section title="Appearance">
        <div className="field-row">
          <span className="field-label">Light or dark</span>
          <Segmented label="Page appearance" iconOnly value={page.theme.mode} onChange={setAppearance} options={APPEARANCE} />
        </div>
        <div className="field-row" style={{ marginTop: 12 }}>
          <span className="field-label">Motion</span>
          <Segmented label="Motion" value={page.motion} onChange={(v: Motion) => store.change(({ page: p }) => { p.motion = v; })}
            options={[{ value: "auto", label: "Auto" }, { value: "reduced", label: "Reduced" }, { value: "off", label: "Off" }]} />
        </div>
        <p className="section-note">Auto boils the lines and respects each visitor's reduced-motion setting. Reduced boils slowly. Off keeps every line still.</p>
      </Section>

      {locked ? null : (
        <Section title="Canvas">
          {/* the top bar has no room for the scene name on a phone */}
          <div className="field show-narrow">
            <label className="field-label" htmlFor="scene-name-narrow"><span>Scene name</span></label>
            <SceneNameInput className="input" id="scene-name-narrow" />
          </div>
          <SelectField label="Surface" value={currentSurface(scene)} onChange={(v: Surface) => actions.setSurface(v)} options={SURFACES.map((s) => ({ value: s.id, label: s.label }))} />
          <SelectField label="Size" value={`${scene.canvas.width}x${scene.canvas.height}`} onChange={(v) => actions.setCanvas(v)}
            options={CANVASES.map((c) => ({ value: c.id, label: c.label }))} />
        </Section>
      )}

      <Section title="Words">
        <TextField label="Prompt under the drawing" value={page.copy?.hint || ""} max={120} placeholder={scene.copy?.hint || "Tap anything in the drawing."}
          onChange={(v) => store.change(({ page: p }) => { p.copy = { ...(p.copy || {}), hint: v }; })} />
        <TextField label="Plain list heading" value={page.fallbackList.heading || ""} max={60} placeholder={scene.fallback.heading || "Or skip the drawing"} name="list-heading"
          onChange={(v) => store.change(({ page: p }) => { p.fallbackList.heading = v; })} />
        <TextField label="Description for screen readers" value={page.copy?.sceneLabel || ""} max={200} multiline placeholder={scene.copy?.sceneLabel || "My desk. Each object opens one of my links."}
          onChange={(v) => store.change(({ page: p }) => { p.copy = { ...(p.copy || {}), sceneLabel: v }; })} />
      </Section>

      {locked ? (
        <Section title="Scene">
          <p className="field-hint" data-ui="scene-note">
            {scene.name}{scene.author.displayName ? `, drawn by ${scene.author.displayName}` : ""}. A ready-made scene: its drawings stay as they were made, and the links, the words and the colours are yours.
          </p>
        </Section>
      ) : (
        <Section title="Keyboard">
          <ul className="kbd-list">
            <li><span>Select a drawing</span><kbd>Tab</kbd></li>
            <li><span>Nudge</span><kbd>Arrows</kbd></li>
            <li><span>Rotate</span><kbd>[ ]</kbd></li>
            <li><span>Resize</span><kbd>− +</kbd></li>
            <li><span>Undo</span><kbd>{MOD}Z</kbd></li>
            <li><span>Zoom to fit / 100%</span><kbd>Shift+1 / Shift+0</kbd></li>
          </ul>
        </Section>
      )}
    </div>
  );
}

/** A page needs a name, so an emptied field keeps the last one in the document and says why. */
function NameField({ name }: { name: string }) {
  const [draft, type] = useDraft(name, (v) => store.change(({ page: p }) => { p.profile.displayName = v; p.seo.title = ""; }));
  return (
    <TextField label="Name" value={draft} max={LIMITS.displayName} name="display-name"
      check={(v) => (v.trim() ? null : { level: "error", text: `A page needs a name. It keeps "${name}" until you type one.` })}
      onChange={(v) => type(v, v.trim() ? v : undefined)} />
  );
}

/** The page address is stored only when valid; the field keeps what was typed and says why. */
function HandleField({ handle }: { handle: string }) {
  const [draft, setDraft] = useState(handle);
  useEffect(() => { setDraft(handle); }, [handle]);
  return (
    <TextField label="Page address" value={draft} max={30} hint="Also the export file name."
      check={(v) => (HANDLE.test(v) ? null : { level: "error", text: "2 to 30 characters: lowercase letters, digits, - and _." })}
      onChange={(v) => { setDraft(v); if (HANDLE.test(v)) store.change(({ page }) => { page.handle = v; }); }} />
  );
}

