import { useEffect, useMemo, useRef } from "react";
import { renderPage } from "@scena/renderer";
import { ADDRESS_PREFIX } from "@scena/scene";
import { addressOf, store, useStudio } from "../store.ts";
import { useDebounced, useNarrow } from "../hooks.ts";
import { tappedObject } from "../preview-message.ts";
import * as actions from "../actions.ts";

/**
 * The exact exported page in a sandboxed iframe, shown in a phone or a browser window, with the
 * inspector beside it. Links show where they would go instead of leaving. A tap on a drawing
 * opens its panel in the page, as it does for a visitor, and brings up that link's form in the
 * inspector (development plan 2.3). On a narrow screen the page fills a pane pinned above the
 * form, without a device around it: the screen is the phone. The device and appearance
 * controls live in the top bar.
 */
export function Preview() {
  const studio = useStudio();
  const { scene, page, docRev, sel, phone, forceMotion } = studio;
  const shown = addressOf(studio);
  const narrow = useNarrow();
  const frame = useRef<HTMLIFrameElement>(null);
  // The drawing a tap in this Preview brought up. Each edit renders the page again and the frame
  // reloads, so the page is then rendered with that drawing selected: its panel stays open, with
  // the words being typed in it. It is forgotten as soon as the selection changes any other way
  // (a press around the page, Page settings, undo), and this Preview starts without it.
  const tapped = useRef<{ slot: string; layer: string } | null>(null);
  useEffect(() => { if (tapped.current && tapped.current.layer !== sel) tapped.current = null; }, [sel]);

  // The page is rendered again only when the documents change (documents are mutated in place, so
  // their settled revision is the dependency) or motion is forced, never for the selection alone:
  // a tap does not reload the frame. The tapped drawing is read here, as the page is rendered.
  // A change of device or of screen width puts a new frame in the document, which loads the page
  // afresh: it is rendered again for that too, so the new frame shows the selection as it is now
  // and not as it was at the last edit.
  const settled = useDebounced(docRev, 120);
  const html = useMemo(() => {
    const kept = tapped.current && tapped.current.layer === store.getSnapshot().sel ? tapped.current.slot : undefined;
    return renderPage(scene, page, { demo: true, forceMotion, editorPreview: true, ...(kept ? { selected: kept } : {}) }).html;
  }, [settled, forceMotion, narrow, phone]);

  // The page in the frame says which drawing was tapped. The frame shows documents a person
  // supplied, so the message is checked first (preview-message.ts): it has to come from this
  // frame and name a slot of the open scene, and nothing else in it is used.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const hit = tappedObject({ source: e.source, origin: e.origin, data: e.data }, frame.current?.contentWindow ?? null, store.getSnapshot().scene);
      if (!hit) return;
      tapped.current = { slot: hit.slot.id, layer: hit.layer.id };
      actions.editLink(hit.layer.id);
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, []);

  const iframe = <iframe id="preview" ref={frame} title="Preview of the published page" sandbox="allow-scripts" srcDoc={html} />;
  if (narrow) return <div className="preview pinned">{iframe}</div>;
  return (
    <div className="preview">
      {phone ? (
        <div className="device">{iframe}</div>
      ) : (
        <div className="browser">
          <div className="browser-bar" aria-hidden="true">
            <span className="browser-dots"><i /><i /><i /></span>
            <span className="browser-url">{shown === null ? null : <>{ADDRESS_PREFIX}{shown}</>}</span>
            <span style={{ width: 42 }} />
          </div>
          {iframe}
        </div>
      )}
    </div>
  );
}
