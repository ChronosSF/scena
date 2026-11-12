import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { pageCss, resolvePalette } from "@scena/renderer";
import { store, useStudio, type Tab } from "../store.ts";
import * as actions from "../actions.ts";
import { useNarrow } from "../hooks.ts";
import { TopBar } from "./TopBar.tsx";
import { LayersPanel } from "./LayersPanel.tsx";
import { LinksPanel } from "./LinksPanel.tsx";
import { isBuiltIn } from "../model.ts";
import { Workspace } from "./Workspace.tsx";
import { Inspector } from "./Inspector.tsx";
import { ExportDialog, FramesChoiceDialog, ImportErrorsDialog, ReplaceDialog, ResetDialog, SetAsideDialog } from "./Dialogs.tsx";
import { Feedback } from "./Feedback.tsx";
import { TooltipProvider, hasFiles } from "./ui.tsx";

const inField = (t: EventTarget | null) => !!(t as Element | null)?.closest?.("input, textarea, select, [contenteditable]");

export function App() {
  const { sel, view, rev, forceMotion, tab, scene, page } = useStudio();
  // A built-in scene is filled in, not designed: its links instead of layers, and a canvas that
  // only selects (model.ts, isBuiltIn).
  const locked = isBuiltIn(scene);
  const narrow = useNarrow();
  const [exportOpen, setExportOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [setAsideOpen, setSetAsideOpen] = useState(store.setAsideOnLoad); // said once, as soon as it happens; the More menu has it after that
  const [problems, setProblems] = useState<string[]>([]);
  const [dropping, setDropping] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  // The page CSS, scoped to .stage. It styles the canvas and the layer thumbnails.
  const stageCss = useMemo(
    () => pageCss(scene, resolvePalette(scene, page), { root: ".stage", body: ".stage", scope: ".stage ", editor: !locked, forceMotion }),
    [rev, forceMotion, locked], // documents are mutated in place
  );

  // On a phone, picking a drawing on the canvas brings its settings up; picking it in the list stays in the list.
  const prevSel = useRef(sel);
  useEffect(() => {
    if (narrow && sel && sel !== prevSel.current && !document.activeElement?.closest("#panel-layers")) store.set({ tab: "inspect" });
    prevSel.current = sel;
  }, [sel, narrow]);

  // Undo and redo, and the zoom shortcuts. Text fields keep their own undo.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (inField(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && !e.altKey && (k === "z" || k === "y")) {
        e.preventDefault();
        if (k === "y" || e.shiftKey) actions.redo(); else actions.undo();
        return;
      }
      if (!mod && !e.altKey && e.shiftKey && store.getSnapshot().view === "edit") {
        if (e.code === "Digit1") { e.preventDefault(); store.set({ zoom: "fit" }); }
        else if (e.code === "Digit0") { e.preventDefault(); store.set({ zoom: 1 }); }
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // Drop files anywhere; over the canvas they land where they were dropped.
  useEffect(() => {
    let depth = 0;
    // a built-in scene takes no drawings: no veil invites the drop, and addFiles says why
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDropping(!isBuiltIn(store.getSnapshot().scene)); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDropping(false); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      depth = 0;
      setDropping(false);
      if (e.defaultPrevented || !e.dataTransfer?.files?.length) return; // the Frames section took it
      e.preventDefault();
      const inEdit = store.getSnapshot().view === "edit";
      const at = inEdit && (e.target as Element).closest?.(".desk") ? actions.canvasPoint(e.clientX, e.clientY) : null;
      if (!inEdit) store.set({ view: "edit" });
      void actions.addFiles([...e.dataTransfer.files], at);
    };
    addEventListener("dragenter", enter);
    addEventListener("dragleave", leave);
    addEventListener("dragover", over);
    addEventListener("drop", drop);
    return () => {
      removeEventListener("dragenter", enter);
      removeEventListener("dragleave", leave);
      removeEventListener("dragover", over);
      removeEventListener("drop", drop);
    };
  }, []);

  const tabs: { id: Tab; label: string; panel: string }[] = [
    { id: "layers", label: locked ? "Links" : "Layers", panel: "panel-layers" },
    { id: "inspect", label: !sel ? "Page" : locked ? "Link" : "Drawing", panel: "inspector" },
  ];
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === tab);
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    store.set({ tab: tabs[next]!.id });
    document.getElementById(`tab-${tabs[next]!.id}`)?.focus();
  };

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <style>{stageCss}</style>
      <div className={`app${dropping ? " dropping" : ""}`} data-view={view}>
        <a className="skip" href="#stage">Skip to the canvas</a>
        <a className="skip" href="#inspector">Skip to the inspector</a>
        <TopBar onExport={() => setExportOpen(true)} onImport={() => importInput.current?.click()} onReset={() => setResetOpen(true)} onSetAside={() => setSetAsideOpen(true)} />
        {locked
          ? <LinksPanel hidden={narrow && tab !== "layers"} tabbed={narrow} />
          : <LayersPanel hidden={narrow && tab !== "layers"} tabbed={narrow} />}
        <Workspace />
        {narrow && view === "edit" ? (
          <div className="tabs" role="tablist" aria-label="Panels" onKeyDown={onTabKey}>
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" className="tab" id={`tab-${t.id}`} aria-controls={t.panel}
                aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onClick={() => store.set({ tab: t.id })}>
                {t.label}
              </button>
            ))}
          </div>
        ) : null}
        <Inspector hidden={narrow && tab !== "inspect"} tabbed={narrow} />
        <div className="drop-veil" aria-hidden="true"><p>Drop to add your drawings</p></div>
      </div>
      <input ref={importInput} type="file" id="import-file" accept=".json,application/json" multiple hidden
        onChange={async (e) => {
          const fs = [...(e.target.files || [])];
          e.target.value = "";
          if (fs.length) setProblems(await actions.importFiles(fs));
        }} />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} onImport={() => importInput.current?.click()} />
      <ResetDialog open={resetOpen} onClose={() => setResetOpen(false)} />
      <SetAsideDialog open={setAsideOpen} onClose={() => setSetAsideOpen(false)} />
      <ImportErrorsDialog problems={problems} onClose={() => setProblems([])} />
      <FramesChoiceDialog />
      <ReplaceDialog />
      <Feedback />
    </TooltipProvider>
  );
}
