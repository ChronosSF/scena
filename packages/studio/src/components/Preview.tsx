import { useMemo } from "react";
import { renderPage } from "@scena/renderer";
import { useStudio } from "../store.ts";
import { useDebounced } from "../hooks.ts";

/**
 * The exact exported page in a sandboxed iframe, shown in a phone or a browser window.
 * Links show where they would go instead of leaving. The device and appearance controls
 * live in the top bar.
 */
export function Preview() {
  const { scene, page, rev, phone, forceMotion } = useStudio();
  const settled = useDebounced(rev, 120);
  // documents are mutated in place, so the settled revision is the dependency
  const html = useMemo(() => renderPage(scene, page, { demo: true, forceMotion }).html, [settled, forceMotion]);
  const frame = <iframe id="preview" title="Preview of the published page" sandbox="allow-scripts" srcDoc={html} />;
  return (
    <div className="preview">
      {phone ? (
        <div className="device">{frame}</div>
      ) : (
        <div className="browser">
          <div className="browser-bar" aria-hidden="true">
            <span className="browser-dots"><i /><i /><i /></span>
            <span className="browser-url">scena.example/{page.handle}</span>
            <span style={{ width: 42 }} />
          </div>
          {frame}
        </div>
      )}
    </div>
  );
}
