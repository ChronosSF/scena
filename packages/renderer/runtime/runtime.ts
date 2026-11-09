// Page runtime. Browser code, compiled and minified by scripts/build-runtime.ts into
// src/runtime.generated.ts; renderPage() inlines it, hashed for the page CSP.
// Budget: 5 KB minified. It reads its data from <script type="application/json" id="sd">
// (see RuntimeData in src/render.ts).

interface Link { t: string; d: string; c: string; u: string; s?: string; sc?: string; m?: string }
interface Data {
  links: Record<string, Link>;
  boil: { s: number[]; i: number } | null;
  motion: "auto" | "reduced" | "off";
  demo: boolean;
  /** studio preview only: ignore the OS reduced-motion setting */
  force?: 1;
}
type Nav = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

(() => {
  const d = document, R = d.documentElement, N = navigator as Nav, W = window, ds = R.dataset;
  const $ = (i: string) => d.getElementById(i)!;
  const D: Data = JSON.parse($("sd").textContent || "{}");
  const L = D.links, B = D.boil;
  const objs = [...d.querySelectorAll<SVGGElement>(".obj")];
  const turbs = [...d.querySelectorAll<SVGFETurbulenceElement>("filter.boil feTurbulence")];
  const mq = W.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- line boil, with the capability gate from plan section 8.2 ---------- */
  let seeds = B ? B.s : [], ms = B ? B.i : 0, k = 0, timer = 0, seen = true, last = Date.now(), idler = 0;
  let measured = false, measuring = false, tries = 0;
  const sd = !!(N.connection && N.connection.saveData), frames = d.querySelector(".frs");
  let off = !B || !turbs.length || D.motion == "off" || sd;
  // Lite mode: 4 cores or fewer and 4 GB or less; "reduced" motion uses it too, slower.
  if (!off && (D.motion == "reduced" || ((N.hardwareConcurrency || 8) <= 4 && (N.deviceMemory || 8) <= 4))) {
    seeds = seeds.slice(0, 2);
    ms = D.motion == "reduced" ? 400 : 250;
    turbs.forEach((t) => t.setAttribute("numOctaves", "1"));
    ds.lite = "1";
  }
  const tick = () => {
    k = (k + 1) % seeds.length;
    turbs.forEach((t) => t.setAttribute("seed", String(seeds[k])));
  };
  // Boil only while visible, on screen, motion allowed, and touched in the last 45 s.
  const ok = () => !off && !(mq.matches && !D.force) && !d.hidden && seen && Date.now() - last < 45e3;
  const sync = (): void => {
    // frame flips (CSS) pause with the boil; Save-Data holds frame 1
    if (frames) ds.fr = sd ? "off" : d.hidden || !seen || Date.now() - last >= 45e3 ? "paused" : "on";
    if (!ok()) {
      clearInterval(timer);
      timer = 0;
      if (!measuring) ds.boil = off ? "static" : "paused";
      return;
    }
    if (timer || measuring) return;
    if (!measured) return measure();
    timer = setInterval(() => (ok() ? tick() : sync()), ms);
    ds.boil = "on";
  };
  // Time five seed changes (after load and one warm-up frame); go static if a frame averages
  // over 40 ms twice in a row, so load-time jank on a capable phone does not switch it off.
  const measure = () => {
    measuring = true;
    ds.boil = "measuring";
    let n = -1, sum = 0, t0 = 0;
    const f = () => {
      const t = performance.now();
      if (t0 && t - t0 < 1e3) {
        if (n >= 0) sum += t - t0;
        n++;
      }
      if (n < 5) {
        t0 = t;
        tick();
        requestAnimationFrame(f);
        return;
      }
      measuring = false;
      ds.boilMs = (sum / n).toFixed(1);
      if (sum / n > 40 && !tries++) {
        setTimeout(sync, 2e3);
        return;
      }
      measured = true;
      if (sum / n > 40) off = true;
      sync();
    };
    const go = () => requestAnimationFrame(f);
    if (d.readyState == "complete") go();
    else W.addEventListener("load", go);
  };
  const poke = () => {
    const idle = Date.now() - last >= 45e3;
    last = Date.now();
    if (idle) sync();
    clearTimeout(idler);
    idler = setTimeout(sync, 45e3 + 99);
  };
  ["pointerdown", "pointermove", "keydown", "scroll", "focusin", "touchstart"].forEach((e) => W.addEventListener(e, poke, { passive: true, capture: true }));
  d.addEventListener("visibilitychange", sync);
  if (mq.addEventListener) mq.addEventListener("change", sync);
  const svg = d.querySelector(".desk svg");
  if (W.IntersectionObserver && svg) new IntersectionObserver((e) => {
    seen = e[e.length - 1]!.isIntersecting;
    sync();
  }).observe(svg);
  sync();
  idler = setTimeout(sync, 45e3 + 99); // the 45 s idle pause, also for scenes without a boil

  /* ---------- selection and the tag panel ---------- */
  const hint = $("hint"), body = $("tb"), tt = $("tt"), ts = $("ts"), tx = $("tx"), btn = $("tbtn") as HTMLAnchorElement;
  const sel = (key: string | undefined) => {
    const l = key ? L[key] : undefined;
    if (!key || !l) return;
    objs.forEach((o) => {
      const on = o.dataset.k == key;
      o.classList.toggle("selected", on);
      o.setAttribute("aria-pressed", String(on));
      // "once-on-tap" frames: play again from frame 1 on every tap
      if (on) o.querySelectorAll(".fro").forEach((f) => {
        f.classList.remove("play");
        f.getBoundingClientRect();
        f.classList.add("play");
      });
    });
    hint.hidden = true;
    body.hidden = false;
    tt.textContent = l.t;
    ts.textContent = l.s || "";
    ts.hidden = !l.s;
    ts.className = "stat s-" + (l.sc || "");
    tx.textContent = l.d;
    btn.textContent = l.c;
    btn.href = l.u || "#";
    btn.dataset.k = key;
  };
  objs.forEach((o) => {
    o.addEventListener("click", () => sel(o.dataset.k));
    o.addEventListener("keydown", (e) => {
      if (e.key == "Enter" || e.key == " ") {
        e.preventDefault();
        sel(o.dataset.k);
      }
    });
  });
  // Hit areas sit under the art, so a tap near a drawing still finds it.
  d.querySelectorAll<SVGElement>(".hit").forEach((h) => {
    const key = h.dataset.k, o = objs.find((x) => x.dataset.k == key);
    h.addEventListener("click", () => sel(key));
    if (o) {
      h.addEventListener("pointerenter", () => o.classList.add("hov"));
      h.addEventListener("pointerleave", () => o.classList.remove("hov"));
    }
  });

  /* ---------- demo pages: explain the link instead of leaving ---------- */
  if (D.demo) {
    const toast = $("toast");
    let tm = 0;
    d.addEventListener("click", (e) => {
      const a = (e.target as Element).closest && (e.target as Element).closest<HTMLElement>("a[data-k]");
      const l = a && L[a.dataset.k || ""];
      if (!l) return;
      e.preventDefault();
      toast.textContent = l.m || "";
      toast.classList.add("show");
      clearTimeout(tm);
      tm = setTimeout(() => toast.classList.remove("show"), 2800);
    });
  }
})();
