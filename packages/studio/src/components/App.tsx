import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { pageCss, resolvePalette } from "@scena/renderer";
import { store, useStudio, type Tab } from "../store.ts";
import { hostHooks, type StudioAddress, type StudioControl, type StudioSaving } from "../host.ts";
import { toast } from "../ui.ts";
import * as actions from "../actions.ts";
import { useNarrow } from "../hooks.ts";
import { TopBar } from "./TopBar.tsx";
import { LayersPanel } from "./LayersPanel.tsx";
import { LinksPanel } from "./LinksPanel.tsx";
import { isBuiltIn } from "../model.ts";
import { Workspace } from "./Workspace.tsx";
import { Inspector } from "./Inspector.tsx";
import { ExportDialog, FramesChoiceDialog, ImportErrorsDialog, ReplaceDialog, ResetDialog, SetAsideDialog } from "./Dialogs.tsx";
import { ScenePicker } from "./ScenePicker.tsx";
import { Feedback } from "./Feedback.tsx";
import { TooltipProvider, hasFiles } from "./ui.tsx";

const inField = (t: EventTarget | null) => !!(t as Element | null)?.closest?.("input, textarea, select, [contenteditable]");

export interface StudioProps {
  /**
   * What the app that mounts the studio shows about the person's account, at the end of the top
   * bar: the web app's sign-in link, or who is signed in and a way to sign out. The studio
   * knows nothing about accounts; the single-file build has none and leaves this out.
   *
   * The bar says what it has room for through two class names (studio.css): give a line of
   * text that needs a wide window `account-wide`, and the words inside a link or a button
   * `account-words`, as a direct child of it next to its icon. Neither is shown where the bar
   * is too narrow, so each control needs a name of its own (an `aria-label`).
   */
  account?: ReactNode;
  /**
   * A second place the host keeps the work, beside this browser (the web app: the person's
   * account). The studio still saves the work in this browser as it always has; with this it
   * also tells the host of each change and each save, shows the host's words in its save
   * indicator, and lets the host open other work in place of what is open, keeping that aside
   * (host.ts says what each part does). The single-file build leaves it out, and the indicator
   * then says "Saved in this browser", as it always has.
   */
  saving?: StudioSaving;
  /**
   * The page's address, where the host gives pages their addresses (the web app, from the
   * person's account; host.ts says what each part is). The inspector's "Page address" field
   * becomes a row that shows it, with the host's control beside it; the frame label, the
   * Preview's address bar, the Page panel's head and the export's file names show it, or none;
   * and the draft carries it. The single-file build leaves it out, and the field stays, the
   * draft's handle being the address, as it always was.
   */
  address?: StudioAddress;
}

/** What the host may ask of the studio (host.ts). */
const control: StudioControl = {
  work: () => store.work(),
  replace: (work, why) => store.replaceForHost(work, why),
  say: (text, tone = "") => toast(text, tone),
};

export function App({ account, saving, address }: StudioProps = {}) {
  const { sel, view, rev, forceMotion, tab, scene, page, asideN } = useStudio();

  // The host's callbacks, for the store to call (host.ts). The latest props are read each time,
  // so the host may hand in new ones with each render; with no host there are none.
  const host = useRef(saving);
  useLayoutEffect(() => { host.current = saving; });
  const hosted = !!saving;
  useEffect(() => {
    if (!hosted) return;
    hostHooks.changed = (work) => host.current?.onChange?.(work);
    hostHooks.saved = (work) => host.current?.onSaved?.(work);
    host.current?.onOpen?.(control);
    return () => { hostHooks.changed = null; hostHooks.saved = null; };
  }, [hosted]);
  // The host's address, for what shows it and for the draft (store.ts, setAddress): before the
  // first paint, so that no address the page does not have is shown for a frame.
  const handle = address ? address.handle : undefined;
  useLayoutEffect(() => { store.setAddress(handle); }, [handle]);
  // A built-in scene is filled in, not designed: its links instead of layers, and a canvas that
  // only selects (model.ts, isBuiltIn).
  const locked = isBuiltIn(scene);
  const narrow = useNarrow();
  const [exportOpen, setExportOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [setAsideOpen, setSetAsideOpen] = useState(store.setAsideOnLoad); // said once, as soon as it happens; the More menu has it after that
  // The same when the host sets the open work aside to open its own (host.ts, replace): once,
  // as the count goes up. The store outlives this component (an app may show another of its
  // pages and come back), so the count seen as it mounts is not news.
  const asideSeen = useRef(asideN);
  useEffect(() => {
    if (asideN === asideSeen.current) return;
    asideSeen.current = asideN;
    setSetAsideOpen(true);
  }, [asideN]);
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
        <TopBar onExport={() => setExportOpen(true)} onImport={() => importInput.current?.click()} onReset={() => setResetOpen(true)} onSetAside={() => setSetAsideOpen(true)} account={account} saving={saving?.words ?? null} />
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
        {/* in Preview the inspector is beside the page, or under it on a phone, with no tabs */}
        <Inspector hidden={narrow && view === "edit" && tab !== "inspect"} tabbed={narrow && view === "edit"} address={address} />
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
      <ScenePicker />
      <ReplaceDialog />
      <Feedback />
    </TooltipProvider>
  );
}
