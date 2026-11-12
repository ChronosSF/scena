import { BookOpen, Check, Download, Ellipsis, FileWarning, Import, LayoutTemplate, Monitor, Moon, PencilRuler, Play, Redo2, RotateCcw, Smartphone, Sun, SunMoon, TriangleAlert, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ThemeMode } from "@scena/scene";
import { store, useStudio, type StudioState } from "../store.ts";
import { isBuiltIn } from "../model.ts";
import { openPicker } from "../ui.ts";
import * as actions from "../actions.ts";
import { BudgetPill } from "./BudgetPopover.tsx";
import { Button, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Segmented, Tip } from "./ui.tsx";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

const SAVE_WORDS: Record<StudioState["saveStatus"], { short: string; tip: string }> = {
  saved: { short: "Saved in this browser", tip: "Saved in this browser" },
  "too-big": { short: "Not saved: too big for browser storage", tip: "Not saved: too big for browser storage. Export to keep your work." },
  "not-valid": { short: "Not saved: something here would not open again", tip: "Not saved: something here would not open again, so your last saved work is kept. Undo the last change, or export to keep this." },
};

export const APPEARANCE = [
  { value: "auto", label: "Match the visitor's device", icon: SunMoon },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;
export const setAppearance = (v: ThemeMode) => store.change(({ page }) => { page.theme.mode = v; });

/** The product mark: an outline and a fill, slightly off register. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="11.5" cy="11.5" r="6.5" fill="var(--ui-accent)" />
      <circle cx="8.5" cy="8.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * The scene name, edited in place. The format needs a name, so an emptied field keeps the
 * last name in the document and puts it back on blur.
 */
export function SceneNameInput({ className, id }: { className: string; id?: string }) {
  const { scene } = useStudio();
  const [draft, setDraft] = useState(scene.name);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(scene.name); }, [scene.name, editing]);
  return (
    <input className={className} id={id} aria-label={id ? undefined : "Scene name"} value={draft} maxLength={60}
      size={Math.max(4, Math.min(22, draft.length))}
      onFocus={() => setEditing(true)}
      onBlur={() => { setEditing(false); setDraft(scene.name); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }}
      onChange={(e) => { setDraft(e.target.value); if (e.target.value.trim()) actions.renameScene(e.target.value); }} />
  );
}

export function TopBar({ onExport, onImport, onReset, onSetAside }: { onExport: () => void; onImport: () => void; onReset: () => void; onSetAside: () => void }) {
  const { view, canUndo, canRedo, saveStatus, setAside, scene, phone, page } = useStudio();
  const more = useRef<HTMLButtonElement>(null);
  return (
    <header className="bar">
      <div className="bar-start">
        <div className="brand"><BrandMark /><span className="hide-narrow">Studio</span></div>
        <span className="crumb-sep hide-narrow" aria-hidden="true">/</span>
        {/* a built-in scene keeps its name */}
        {isBuiltIn(scene) ? <span className="scene-name hide-narrow" data-ui="scene-name">{scene.name}</span> : <SceneNameInput className="name-input hide-narrow" />}
        <span className="bar-divider hide-narrow" aria-hidden="true" />
        <IconButton icon={Undo2} label="Undo" shortcut={`${MOD}Z`} disabled={!canUndo} onClick={actions.undo} data-ui="undo" />
        <IconButton icon={Redo2} label="Redo" shortcut={`${MOD}Shift+Z`} disabled={!canRedo} onClick={actions.redo} data-ui="redo" />
      </div>

      <div className="bar-center">
        <div className="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "edit"} data-ui="view-edit" onClick={() => store.set({ view: "edit" })}><PencilRuler aria-hidden="true" strokeWidth={1.75} /><span className="hide-narrow">Edit</span><span className="show-narrow sr-only">Edit</span></button>
          <button type="button" aria-pressed={view === "preview"} data-ui="view-preview" onClick={() => store.set({ view: "preview" })}><Play aria-hidden="true" strokeWidth={1.75} /><span className="hide-narrow">Preview</span><span className="show-narrow sr-only">Preview</span></button>
        </div>
        {view === "preview" ? (
          <>
            <Segmented label="Device" iconOnly value={phone ? "phone" : "full"} onChange={(v) => store.set({ phone: v === "phone" })}
              options={[{ value: "phone", label: "Phone", icon: Smartphone }, { value: "full", label: "Full width", icon: Monitor }]} />
            <span className="hide-narrow">
              <Segmented label="Page appearance" iconOnly value={page.theme.mode} onChange={setAppearance} options={APPEARANCE} />
            </span>
          </>
        ) : null}
      </div>

      <div className="bar-end">
        <BudgetPill />
        <Tip label={SAVE_WORDS[saveStatus].tip}>
          <span className={`save-state hide-narrow${saveStatus === "saved" ? "" : " warn"}`} role="status" data-save={saveStatus}>
            {saveStatus === "saved" ? <Check aria-hidden="true" size={16} strokeWidth={1.75} /> : <TriangleAlert aria-hidden="true" size={16} strokeWidth={1.75} />}
            <span className="sr-only">{SAVE_WORDS[saveStatus].short}</span>
          </span>
        </Tip>
        <Button className="hide-narrow" variant="ghost" icon={Import} onClick={onImport} data-ui="import"><span className="squeeze">Import</span></Button>
        <Button variant="primary" icon={Download} onClick={onExport} data-ui="export"><span className="hide-narrow">Export</span><span className="show-narrow sr-only">Export</span></Button>
        <Menu>
          <Tip label="More">
            <MenuTrigger asChild>
              <button type="button" className="icon-btn" aria-label="More" data-ui="more" ref={more}><Ellipsis aria-hidden="true" strokeWidth={1.75} /></button>
            </MenuTrigger>
          </Tip>
          <MenuContent align="end">
            <MenuItem icon={Import} onSelect={onImport} data-ui="menu-import">Import scene or page…</MenuItem>
            {/* The menu hands the focus back to its button a moment after the picker has opened, which is too
                late: the open picker holds it. So the picker is told where the focus goes when it closes. */}
            <MenuItem icon={LayoutTemplate} onSelect={() => openPicker(undefined, more.current)} data-ui="menu-scenes">Choose a ready-made scene…</MenuItem>
            <MenuItem icon={BookOpen} onSelect={() => void actions.openDesk()} data-ui="menu-desk">Open Pia's finished desk</MenuItem>
            {setAside ? <MenuItem icon={FileWarning} onSelect={onSetAside} data-ui="menu-aside">Saved work that did not open…</MenuItem> : null}
            <MenuSeparator />
            <MenuItem icon={RotateCcw} onSelect={onReset} danger data-ui="menu-reset">Start over…</MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </header>
  );
}
