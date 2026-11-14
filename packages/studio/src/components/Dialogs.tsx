import { useEffect, useMemo, useState } from "react";
import { Copy, Download, FileCode2, FileJson, Film, Upload } from "lucide-react";
import { renderPage } from "@scena/renderer";
import { store, useStudio } from "../store.ts";
import * as actions from "../actions.ts";
import { gzipSize, kb } from "../util.ts";
import { useUi } from "../ui.ts";
import { Dialog } from "./Dialog.tsx";
import { Button } from "./ui.tsx";

export function ExportDialog({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: () => void }) {
  const { scene, page } = useStudio();
  const [size, setSize] = useState("");
  // measured each time the dialog opens
  useEffect(() => {
    if (!open) return;
    const html = renderPage(scene, page).html;
    setSize(kb(html.length));
    void gzipSize(html).then((gz) => { if (gz) setSize(`${kb(html.length)} · ${kb(gz)} gzipped`); });
  }, [open]);
  const handle = page.handle || "page";
  return (
    <Dialog open={open} onClose={onClose} labelledBy="export-h">
      <div className="dlg-body">
        <h2 className="dlg-title" id="export-h">Export</h2>
        <p className="dlg-text">The page is one HTML file with the drawings, styles and a small script inside. No external scripts; it works on any static host.</p>
        <div className="dl-list">
          <button type="button" className="dl-item" onClick={actions.downloadPage} data-ui="dl-page">
            <span className="dl-icon"><FileCode2 aria-hidden="true" strokeWidth={1.75} /></span>
            <span><span className="dl-title">Page</span><br /><span className="dl-sub">{handle}.html · {size}</span></span>
            <Download className="dl-go" aria-hidden="true" strokeWidth={1.75} />
          </button>
          <button type="button" className="dl-item" onClick={actions.downloadScene} data-ui="dl-scene">
            <span className="dl-icon"><FileJson aria-hidden="true" strokeWidth={1.75} /></span>
            <span><span className="dl-title">Scene</span><br /><span className="dl-sub">{scene.id}.scene.json · drawings, tap areas, palettes</span></span>
            <Download className="dl-go" aria-hidden="true" strokeWidth={1.75} />
          </button>
          <button type="button" className="dl-item" onClick={actions.downloadPageData} data-ui="dl-data">
            <span className="dl-icon"><FileJson aria-hidden="true" strokeWidth={1.75} /></span>
            <span><span className="dl-title">Page data</span><br /><span className="dl-sub">{handle}.page.json · your words and links</span></span>
            <Download className="dl-go" aria-hidden="true" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div className="dlg-foot">
        <Button variant="ghost" icon={Upload} onClick={() => { onClose(); onImport(); }}>Import JSON…</Button>
        <span className="spacer" />
        <Button variant="primary" onClick={onClose} data-ui="dlg-done">Done</Button>
      </div>
    </Dialog>
  );
}

/** Several drawings dropped or chosen at once: the frames of one animation, or separate drawings? */
export function FramesChoiceDialog() {
  const { ask } = useUi();
  const n = ask?.count || 0;
  return (
    <Dialog open={!!ask} onClose={() => ask?.resolve(null)} labelledBy="frames-q-h">
      <div className="dlg-body">
        <h2 className="dlg-title" id="frames-q-h">Add {n} drawings</h2>
        <p className="dlg-text">Are these the frames of one animation? Frames sit on top of each other and flip, like a hand-drawn loop.</p>
        <div className="dl-list">
          <button type="button" className="dl-item" onClick={() => ask?.resolve("frames")} data-ui="choice-frames">
            <span className="dl-icon"><Film aria-hidden="true" strokeWidth={1.75} /></span>
            <span><span className="dl-title">One drawing with {n} frames</span><br /><span className="dl-sub">Flips at 6 fps; change the speed and when it plays later</span></span>
          </button>
          <button type="button" className="dl-item" onClick={() => ask?.resolve("separate")} data-ui="choice-separate">
            <span className="dl-icon"><Copy aria-hidden="true" strokeWidth={1.75} /></span>
            <span><span className="dl-title">{n} separate drawings</span><br /><span className="dl-sub">Each lands on the canvas on its own</span></span>
          </button>
        </div>
      </div>
      <div className="dlg-foot"><span className="spacer" /><Button variant="ghost" onClick={() => ask?.resolve(null)}>Cancel</Button></div>
    </Dialog>
  );
}

/**
 * Opening another scene replaces the one on the canvas, and autosave follows at once, so the
 * studio asks first when there is work there (actions.ts, openDesk and openBuiltIn). It can
 * open over the scene picker, which stays where it was if the answer is no.
 */
export function ReplaceDialog() {
  const { replace } = useUi();
  return (
    <Dialog open={!!replace} onClose={() => replace?.resolve(false)} labelledBy="replace-h">
      <div className="dlg-body">
        <h2 className="dlg-title" id="replace-h">Open {replace?.what}?</h2>
        <p className="dlg-text">This replaces the drawings and the page you have here, in this browser. Export first if you want to keep them; Undo can bring them back until you close the studio.</p>
      </div>
      <div className="dlg-foot">
        <span className="spacer" />
        <Button variant="ghost" onClick={() => replace?.resolve(false)} data-ui="replace-cancel">Cancel</Button>
        <Button variant="primary" onClick={() => replace?.resolve(true)} data-ui="replace-ok">Open it</Button>
      </div>
    </Dialog>
  );
}

export function ResetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="reset-h">
      <div className="dlg-body">
        <h2 className="dlg-title" id="reset-h">Start over?</h2>
        <p className="dlg-text">This clears the canvas in this browser. Export first if you want to keep it; Undo can bring it back.</p>
      </div>
      <div className="dlg-foot">
        <Button onClick={() => { void actions.openDesk({ ask: false }); onClose(); }}>Open Pia's desk</Button>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => { actions.startBlank(); onClose(); }} data-ui="reset-blank">Empty canvas</Button>
      </div>
    </Dialog>
  );
}

/**
 * Saved work that this version could not open. It is kept in the browser, not deleted
 * (store.ts, openSaved); this is where the user learns why, gets the files, or lets it go.
 */
export function SetAsideDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setAside } = useStudio();
  const work = useMemo(() => (open && setAside ? store.setAsideWork() : null), [open, setAside]);
  const problems = work?.problems || [];
  const asFiles = !!work && !!work.scene && !!work.page;
  return (
    <Dialog open={!!work} onClose={onClose} labelledBy="aside-h">
      <div className="dlg-body">
        <h2 className="dlg-title" id="aside-h">Saved work did not open</h2>
        <p className="dlg-text">This version of the studio could not open the work saved in this browser, so it started with an empty canvas. Nothing was deleted: the saved work is kept here until you discard it. To bring it back, download it, correct it and import it.</p>
        {problems.length ? (
          <ul className="errors">
            {problems.slice(0, 6).map((p, i) => <li key={i}>{p}</li>)}
            {problems.length > 6 ? <li>…and {problems.length - 6} more</li> : null}
          </ul>
        ) : null}
        <div className="dl-list">
          <button type="button" className="dl-item" onClick={() => actions.downloadSetAside("scene")} data-ui="aside-scene">
            <span className="dl-icon"><FileJson aria-hidden="true" strokeWidth={1.75} /></span>
            <span><span className="dl-title">{asFiles ? "Scene" : "Saved text"}</span><br /><span className="dl-sub">{asFiles ? "set-aside.scene.json · drawings, tap areas, palettes" : "set-aside-work.txt · it does not read as JSON"}</span></span>
            <Download className="dl-go" aria-hidden="true" strokeWidth={1.75} />
          </button>
          {asFiles ? (
            <button type="button" className="dl-item" onClick={() => actions.downloadSetAside("page")} data-ui="aside-page">
              <span className="dl-icon"><FileJson aria-hidden="true" strokeWidth={1.75} /></span>
              <span><span className="dl-title">Page data</span><br /><span className="dl-sub">set-aside.page.json · words and links</span></span>
              <Download className="dl-go" aria-hidden="true" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="dlg-foot">
        <Button variant="ghost" onClick={() => { actions.discardSetAside(); onClose(); }} data-ui="aside-discard">Discard saved work</Button>
        <span className="spacer" />
        <Button variant="primary" onClick={onClose} data-ui="aside-close">Close</Button>
      </div>
    </Dialog>
  );
}

export function ImportErrorsDialog({ problems, onClose }: { problems: string[]; onClose: () => void }) {
  return (
    <Dialog open={problems.length > 0} onClose={onClose} labelledBy="import-h">
      <div className="dlg-body">
        <h2 className="dlg-title" id="import-h">That import did not work</h2>
        <p className="dlg-text">Nothing was changed. Here is what we found:</p>
        <ul className="errors">
          {problems.slice(0, 12).map((p, i) => <li key={i}>{p}</li>)}
          {problems.length > 12 ? <li>…and {problems.length - 12} more</li> : null}
        </ul>
      </div>
      <div className="dlg-foot"><Button variant="primary" onClick={onClose}>OK</Button></div>
    </Dialog>
  );
}
