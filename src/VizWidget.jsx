// Visual Explainers — the renderer. Takes a *validated* viz spec (curves already
// carry a parsed `_ast`) and draws a refined, themed, interactive SVG plot: drag
// a parameter slider and the curves + readouts recompute live. Custom SVG (no
// chart library → no bundle bloat, no generic tooltip "slop"), themed entirely
// from theme.js tokens, RTL-aware. Lazy-loaded by RichText, so it never weighs on
// the main bundle. All math goes through the vetted, no-eval engine in viz-spec.js.
import React, { useMemo, useState, useRef, useEffect, useId } from "react";
import { PAL, RADIUS, EASE, alpha } from "./theme.js";
import { tr, localeFor } from "./locale.js";
import Surface3DView from "./Surface3DView.jsx";
import {
  sampleCurve,
  evalExpr,
  distPdf,
  distRange,
  graphLayout,
  eigen2x2,
  inRegion,
  regionBBox,
  regionBoundary,
  estimateDoubleIntegral,
  evalLogic,
  inclineVertices,
  inclineBlock,
  circuitJunctions,
} from "./viz-spec.js";

const COLOR = {
  accent: PAL.accent,
  success: PAL.success,
  warning: PAL.warning,
  textMuted: PAL.textMuted,
  evPurple: PAL.evPurple || "#B07CD9",
  evTeal: PAL.evTeal || "#19C6C6",
  evOrange: PAL.evOrange || "#EF922E",
  evGreen: PAL.evGreen || "#5CB85C",
};

const W = 560,
  H = 300,
  M = { t: 16, r: 18, b: 42, l: 50 };
const PW = W - M.l - M.r,
  PH = H - M.t - M.b;

function fmt(n) {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a !== 0 && (a < 0.01 || a >= 100000)) return n.toExponential(1);
  return (Math.round(n * 100) / 100).toLocaleString(localeFor(), {
    maximumFractionDigits: 2,
  });
}

// A Hebrew label with a parenthesized numeric coordinate like "(1,0)" bidi-mangles in an
// SVG <text> (the neutral parens/commas around the digits get reordered by the surrounding
// RTL run → "1),0("). Wrap each such coordinate in a Unicode LTR isolate (LRI…PDI) so it
// stays intact. Narrow on purpose: only all-numeric "(… digits …)" groups — equations like
// "(x-1)²" (strong-LTR letters) and single letters already render fine and are left alone.
const COORD_RE = /\([\s\d.,+\-]*\d[\s\d.,+\-]*\)/g;
const isoCoord = (s) =>
  typeof s === "string" ? s.replace(COORD_RE, (m) => `⁦${m}⁩`) : s;

// Clip a ray from a box centre toward (tx,ty) to the box border (shared by the
// diagram + memory-sim renderers for arrow endpoints). Box: { cx, cy, w, h }.
function border(box, tx, ty) {
  const dx = tx - box.cx,
    dy = ty - box.cy;
  const hw = box.w / 2 + 2,
    hh = box.h / 2 + 2;
  const s = Math.min(
    dx === 0 ? Infinity : hw / Math.abs(dx),
    dy === 0 ? Infinity : hh / Math.abs(dy),
  );
  return {
    x: box.cx + dx * (Number.isFinite(s) ? s : 0),
    y: box.cy + dy * (Number.isFinite(s) ? s : 0),
  };
}

// Nudge overlapping node boxes apart (a few bounded passes) so model-supplied
// positions that collide don't render on top of each other. Stable: nodes that
// don't overlap never move, so well-placed diagrams render exactly as before.
function deOverlap(boxes, bx) {
  const arr = Object.values(boxes),
    GAP = 10;
  for (let iter = 0; iter < 24; iter += 1) {
    let moved = false;
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = i + 1; j < arr.length; j += 1) {
        const a = arr[i],
          b = arr[j];
        const dx = b.cx - a.cx,
          dy = b.cy - a.cy;
        const ox = (a.w + b.w) / 2 + GAP - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + GAP - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          moved = true;
          if (ox < oy) {
            const s = dx < 0 ? -1 : 1,
              p = ox / 2;
            a.cx -= p * s;
            b.cx += p * s;
          } else {
            const s = dy < 0 ? -1 : 1,
              p = oy / 2;
            a.cy -= p * s;
            b.cy += p * s;
          }
        }
      }
    }
    arr.forEach((box) => {
      box.cx = Math.max(bx.x0 + box.w / 2, Math.min(bx.x1 - box.w / 2, box.cx));
      box.cy = Math.max(bx.y0 + box.h / 2, Math.min(bx.y1 - box.h / 2, box.cy));
    });
    if (!moved) break;
  }
}

// Dispatch by kind: plots (parametric-plot / function-compare), node-edge diagram,
// or the stepped memory-sim (Java stack/heap walkthrough).
export default function VizWidget({ spec, saveable = false }) {
  if (spec?.kind === "memory-sim")
    return <MemSimView spec={spec} saveable={saveable} />;
  if (spec?.kind === "bracket-sim")
    return <BracketSimView spec={spec} saveable={saveable} />;
  if (spec?.kind === "diagram")
    return <DiagramView spec={spec} saveable={saveable} />;
  if (spec?.kind === "graph")
    return <GraphView spec={spec} saveable={saveable} />;
  if (spec?.kind === "chart")
    return <ChartView spec={spec} saveable={saveable} />;
  if (spec?.kind === "distribution")
    return <DistributionView spec={spec} saveable={saveable} />;
  if (spec?.kind === "table")
    return <TableView spec={spec} saveable={saveable} />;
  if (spec?.kind === "tree")
    return <TreeView spec={spec} saveable={saveable} />;
  if (spec?.kind === "geometry2d")
    return <Geometry2DView spec={spec} saveable={saveable} />;
  if (spec?.kind === "transform2d")
    return <Transform2DView spec={spec} saveable={saveable} />;
  if (spec?.kind === "slope-field")
    return <SlopeFieldView spec={spec} saveable={saveable} />;
  if (spec?.kind === "surface3d")
    return <Surface3DView spec={spec} saveable={saveable} />;
  if (spec?.kind === "numberline")
    return <NumberlineView spec={spec} saveable={saveable} />;
  if (spec?.kind === "timeline")
    return <TimelineView spec={spec} saveable={saveable} />;
  if (spec?.kind === "venn")
    return <VennView spec={spec} saveable={saveable} />;
  if (spec?.kind === "logic-circuit")
    return <LogicCircuitView spec={spec} saveable={saveable} />;
  if (spec?.kind === "circuit")
    return <CircuitView spec={spec} saveable={saveable} />;
  return <PlotView spec={spec} saveable={saveable} />;
}

// Shared chrome for every non-plot kind: the bordered, titled card + the footer
// (optional "Save to Practice"). Keeps each view
// focused on its SVG while guaranteeing a consistent, refined frame.
function VizCard({
  title,
  ariaLabel,
  saveable,
  spec,
  children,
  footerLeft = null,
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        border: `1px solid ${PAL.borderSoft}`,
        borderRadius: RADIUS.lg,
        background: PAL.navyBubbleAI || PAL.surface,
        padding: 14,
        margin: "10px 0",
        maxWidth: "100%",
      }}
    >
      {title && (
        <div
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: PAL.text,
            marginBottom: 8,
          }}
        >
          {title}
        </div>
      )}
      {children}
      {(footerLeft || saveable) && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 9,
            borderTop: `1px solid ${PAL.borderSoft}`,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              minWidth: 0,
              alignItems: "center",
            }}
          >
            {footerLeft}
          </div>
          {saveable && (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                whiteSpace: "nowrap",
              }}
            >
              <ExportImageButton spec={spec} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// A small color-swatch + label legend, shared by chart / scatter / etc.
function Legend({ items }) {
  if (!items || items.length < 2) return null;
  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 6 }}
    >
      {items.map((it, i) => (
        <span
          key={i}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11.5,
            color: PAL.textMuted,
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 3,
              background: it.color,
            }}
          />{" "}
          {it.label}
        </span>
      ))}
    </div>
  );
}

// Categorical/scatter chart palette (resolved tokens), for auto-coloring pie slices
// and any series the model left uncolored.
const CHART_PALETTE = [
  "accent",
  "evTeal",
  "warning",
  "evPurple",
  "evGreen",
  "evOrange",
  "success",
  "textMuted",
].map((k) => COLOR[k]);

// A tiny image glyph for the export button (lucide isn't imported into this lazy module).
function ImageIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

// Rasterize a rendered viz to a PNG Blob. Two paths: the Plotly 3D scene (surface3d)
// exports via Plotly.toImage; every SVG kind is cloned, given an opaque card-colored
// background (so it isn't a transparent rectangle in a doc), and painted onto a 2× canvas.
async function vizNodeToPngBlob(root) {
  const plot = root.querySelector(".js-plotly-plot");
  if (plot && window.Plotly) {
    const r = plot.getBoundingClientRect();
    const url = await window.Plotly.toImage(plot, {
      format: "png",
      width: Math.round(r.width) || 900,
      height: Math.round(r.height) || 480,
      scale: 2,
    });
    return await (await fetch(url)).blob();
  }
  // largest SVG that isn't a button's own icon
  const svg = [...root.querySelectorAll("svg")]
    .filter((s) => !s.closest("button"))
    .sort(
      (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
    )[0];
  if (!svg) throw new Error("no-viz-node");
  const rect = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width)),
    h = Math.max(1, Math.round(rect.height));
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.setAttribute("font-family", "Heebo, system-ui, sans-serif");
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const loaded = new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error("svg-load"));
  });
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  await loaded;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAL.navyBubbleAI || PAL.surface || "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("no-blob"))), "image/png"),
  );
}

// Hand the PNG to the platform so a student can drop it into notes / a doc / Photos:
// the native share sheet on phones & tablets (Save to Photos, paste anywhere), the
// clipboard on desktop (paste into a doc), and a file download as the universal fallback.
async function shareOrCopyImage(blob, filename, title) {
  const file = new File([blob], filename, { type: "image/png" });
  const coarse =
    window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  if (coarse && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if (e && e.name === "AbortError")
        return "cancelled"; /* else fall through */
    }
  }
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new window.ClipboardItem({ "image/png": blob }),
      ]);
      return "copied";
    } catch {
      /* clipboard blocked/unsupported → download */
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return "downloaded";
}

function vizFilename(spec) {
  const base = String((spec && spec.title) || "")
    .replace(/[^\w֐-׿ -]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return `${base || "studai-graph"}.png`;
}

// Save-image button — replaces the old save-to-practice action. Finds THIS card's rendered
// viz (walks up from the button to the nearest node holding the SVG / Plotly scene, skipping
// the button's own icon) and exports it as a PNG via shareOrCopyImage.
function ExportImageButton({ spec }) {
  const btnRef = useRef(null);
  const [state, setState] = useState(""); // "" | busy | copied | shared | downloaded | err
  const run = async () => {
    setState("busy");
    try {
      let node = btnRef.current ? btnRef.current.parentElement : null;
      while (
        node &&
        !(
          node.querySelector(".js-plotly-plot") ||
          [...node.querySelectorAll("svg")].some((s) => !s.closest("button"))
        )
      )
        node = node.parentElement;
      if (!node) throw new Error("no-node");
      const blob = await vizNodeToPngBlob(node);
      const res = await shareOrCopyImage(
        blob,
        vizFilename(spec),
        String((spec && spec.title) || tr("גרף StudAI", "StudAI graph")),
      );
      if (res === "cancelled") {
        setState("");
        return;
      }
      setState(res);
    } catch {
      setState("err");
    }
    setTimeout(() => setState(""), 2400);
  };
  const ok = state === "copied" || state === "shared" || state === "downloaded";
  const label =
    state === "copied"
      ? tr("הועתק ✓", "Copied ✓")
      : state === "shared"
        ? tr("שותף ✓", "Shared ✓")
        : state === "downloaded"
          ? tr("נשמר ✓", "Saved ✓")
          : state === "err"
            ? tr("לא הצליח", "Failed")
            : state === "busy"
              ? tr("מכינים…", "Preparing…")
              : tr("שמירת תמונה", "Save image");
  return (
    <button
      ref={btnRef}
      type="button"
      onClick={run}
      disabled={state === "busy"}
      className="tap"
      aria-label={tr("שמירת תמונה של הגרף", "Save an image of the graph")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        border: `1px solid ${PAL.borderSoft}`,
        background: "transparent",
        color: ok ? PAL.success : state === "err" ? PAL.warning : PAL.textMuted,
        borderRadius: 8,
        padding: "4px 9px",
        fontSize: 11,
        fontWeight: 700,
        cursor: state === "busy" ? "default" : "pointer",
        fontFamily: "system-ui, sans-serif",
        whiteSpace: "nowrap",
      }}
    >
      <ImageIcon />
      {label}
    </button>
  );
}

function useReducedMotion() {
  // Match static markup on the first client render, then respect the live preference.
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function PlotView({ spec, saveable = false }) {
  const plotClip = useId();
  const [vals, setVals] = useState(() => {
    const v = {};
    (spec.params || []).forEach((p) => {
      v[p.var] = p.default;
    });
    return v;
  });
  const reduceMotion = useReducedMotion();

  // Optional time animation: sweep ONE param over its [min,max] on a loop (rAF-driven) so the
  // curves recompute per frame — a traveling wave, a phase sweep, damping over time. The
  // animated param's slider doubles as the scrubber; Pause or dragging it stops the clock.
  const anim = spec.animate || null;
  const animP = anim
    ? (spec.params || []).find((p) => p.var === anim.param)
    : null;
  const rafRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!animP || !playing) return undefined;
    const lo = animP.min,
      span = animP.max - animP.min,
      dur = anim.period * 1000;
    let startT = null,
      startPhase = 0;
    const tick = (now) => {
      if (startT == null) {
        startT = now;
        startPhase = span ? (vals[animP.var] - lo) / span : 0;
      }
      const cyc = startPhase + (now - startT) / dur; // elapsed cycles since play began
      const frac =
        anim.loop === "bounce"
          ? (() => {
              const m = ((cyc % 2) + 2) % 2;
              return m <= 1 ? m : 2 - m;
            })() // ping-pong
          : ((cyc % 1) + 1) % 1; // sawtooth
      setVals((v) => ({ ...v, [animP.var]: lo + frac * span }));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // vals is intentionally read only at start (resume from current position), not a dep
  }, [playing, animP, anim]); // eslint-disable-line react-hooks/exhaustive-deps

  const computed = useMemo(() => {
    const xMin = spec.x.min,
      xMax = spec.x.max;
    const series = spec.curves.map((c) => ({
      curve: c,
      pts: sampleCurve(c._ast, spec.x.var, xMin, xMax, vals, 140),
    }));
    // Y-range: fixed from the spec, else auto from the current finite samples.
    let yMin = spec.y && Number.isFinite(spec.y.min) ? spec.y.min : Infinity;
    let yMax = spec.y && Number.isFinite(spec.y.max) ? spec.y.max : -Infinity;
    if (!(
      spec.y &&
      Number.isFinite(spec.y.min) &&
      Number.isFinite(spec.y.max)
    )) {
      series.forEach((s) =>
        s.pts.forEach((p) => {
          if (p.y != null) {
            yMin = Math.min(yMin, p.y);
            yMax = Math.max(yMax, p.y);
          }
        }),
      );
      if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
        yMin = 0;
        yMax = 1;
      }
      if (yMin === yMax) {
        yMin -= 1;
        yMax += 1;
      }
      const pad = (yMax - yMin) * 0.08;
      yMin -= pad;
      yMax += pad;
    }
    const sx = (x) => M.l + ((x - xMin) / (xMax - xMin)) * PW;
    const sy = (y) => M.t + (1 - (y - yMin) / (yMax - yMin)) * PH;
    const paths = series.map((s) => {
      let d = "";
      let pen = false;
      s.pts.forEach((p) => {
        if (p.y == null) {
          pen = false;
          return;
        }
        const X = sx(p.x).toFixed(1),
          Y = sy(p.y).toFixed(1);
        d += `${pen ? "L" : "M"}${X} ${Y} `;
        pen = true;
      });
      return {
        d,
        color: COLOR[s.curve.color] || PAL.accent,
        label: s.curve.label || "",
      };
    });
    // Shaded regions (area under a curve, or between two curves). Reuses the curves'
    // samples — no extra math — clamped into the plot box. Drawn UNDER the strokes.
    const clampY = (y) => Math.max(yMin, Math.min(yMax, y));
    const inRange = (p, lo, hi) =>
      p.y != null && p.x >= lo - 1e-9 && p.x <= hi + 1e-9;
    const regions = (spec.regions || [])
      .map((reg) => {
        const ptsA = (series[reg.curve]?.pts || []).filter((p) =>
          inRange(p, reg.from, reg.to),
        );
        if (ptsA.length < 2) return null;
        let d = "";
        if (reg.type === "between" && reg.curve2 != null) {
          const ptsB = (series[reg.curve2]?.pts || []).filter((p) =>
            inRange(p, reg.from, reg.to),
          );
          if (ptsB.length < 2) return null;
          d =
            `M${sx(ptsA[0].x).toFixed(1)} ${sy(clampY(ptsA[0].y)).toFixed(1)} ` +
            ptsA
              .slice(1)
              .map(
                (p) => `L${sx(p.x).toFixed(1)} ${sy(clampY(p.y)).toFixed(1)} `,
              )
              .join("");
          for (let i = ptsB.length - 1; i >= 0; i -= 1)
            d += `L${sx(ptsB[i].x).toFixed(1)} ${sy(clampY(ptsB[i].y)).toFixed(1)} `;
          d += "Z";
        } else {
          const base = clampY(0);
          d =
            `M${sx(ptsA[0].x).toFixed(1)} ${sy(clampY(ptsA[0].y)).toFixed(1)} ` +
            ptsA
              .slice(1)
              .map(
                (p) => `L${sx(p.x).toFixed(1)} ${sy(clampY(p.y)).toFixed(1)} `,
              )
              .join("");
          d += `L${sx(ptsA[ptsA.length - 1].x).toFixed(1)} ${sy(base).toFixed(1)} L${sx(ptsA[0].x).toFixed(1)} ${sy(base).toFixed(1)} Z`;
        }
        return {
          d,
          color: COLOR[reg.color] || PAL.accent,
          label: reg.label,
          lx: sx((reg.from + reg.to) / 2),
        };
      })
      .filter(Boolean);
    const ticks = (lo, hi, n) =>
      Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
    return {
      xMin,
      xMax,
      yMin,
      yMax,
      sx,
      sy,
      paths,
      series,
      regions,
      xTicks: ticks(xMin, xMax, 5),
      yTicks: ticks(yMin, yMax, 4),
    };
  }, [spec, vals]);

  // Live readouts: each curve's value at the x-midpoint, for a concrete number.
  const readouts = spec.curves.map((c) => {
    const xMid = (spec.x.min + spec.x.max) / 2;
    return {
      label: c.label || c.expr,
      y: evalExpr(c._ast, { ...vals, [spec.x.var]: xMid }),
      color: COLOR[c.color] || PAL.accent,
    };
  });
  const trans = reduceMotion ? "none" : `d .12s ${EASE}`;

  return (
    <div
      role="img"
      aria-label={`${spec.title || tr("המחשה", "Illustration")} — ${tr("תרשים אינטראקטיבי", "interactive chart")}`}
      style={{
        border: `1px solid ${PAL.borderSoft}`,
        borderRadius: RADIUS.lg,
        background: PAL.navyBubbleAI || PAL.surface,
        padding: 14,
        margin: "10px 0",
        maxWidth: "100%",
      }}
    >
      {spec.title && (
        <div
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: PAL.text,
            marginBottom: 4,
          }}
        >
          {spec.title}
        </div>
      )}

      {/* legend */}
      {spec.curves.length > 1 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 6,
          }}
        >
          {readouts.map((r, i) => (
            <span
              key={i}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11.5,
                color: PAL.textMuted,
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 3,
                  background: r.color,
                }}
              />{" "}
              {r.label}
            </span>
          ))}
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block", direction: "ltr", overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <clipPath id={plotClip}>
            <rect x={M.l} y={M.t} width={PW} height={PH} />
          </clipPath>
        </defs>
        {/* gridlines + y ticks */}
        {computed.yTicks.map((ty, i) => {
          const Y = computed.sy(ty);
          return (
            <g key={`y${i}`}>
              <line
                x1={M.l}
                y1={Y}
                x2={W - M.r}
                y2={Y}
                stroke={PAL.border}
                strokeWidth="1"
                opacity="0.5"
              />
              <text
                x={M.l - 8}
                y={Y + 3.5}
                textAnchor="end"
                fontSize="10"
                fill={PAL.textFaint}
              >
                {fmt(ty)}
              </text>
            </g>
          );
        })}
        {/* x ticks */}
        {computed.xTicks.map((tx, i) => {
          const X = computed.sx(tx);
          return (
            <g key={`x${i}`}>
              <line
                x1={X}
                y1={M.t}
                x2={X}
                y2={H - M.b}
                stroke={PAL.border}
                strokeWidth="1"
                opacity="0.28"
              />
              <text
                x={X}
                y={H - M.b + 16}
                textAnchor="middle"
                fontSize="10"
                fill={PAL.textFaint}
              >
                {fmt(tx)}
              </text>
            </g>
          );
        })}
        {/* axis labels */}
        {spec.x.label && (
          <text
            x={M.l + PW / 2}
            y={H - 6}
            textAnchor="middle"
            fontSize="11"
            fill={PAL.textMuted}
          >
            {spec.x.label}
          </text>
        )}
        {spec.y && spec.y.label && (
          <text
            transform={`translate(13 ${M.t + PH / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize="11"
            fill={PAL.textMuted}
          >
            {spec.y.label}
          </text>
        )}
        {/* shaded regions (under the curves) */}
        {computed.regions.map((r, i) => (
          <g key={`reg${i}`}>
            <path
              d={r.d}
              fill={r.color}
              fillOpacity="0.17"
              stroke="none"
              style={{ transition: trans }}
            />
            {r.label && (
              <text
                x={r.lx}
                y={M.t + 13}
                textAnchor="middle"
                fontSize="10.5"
                fontWeight="700"
                fill={r.color}
              >
                {r.label}
              </text>
            )}
          </g>
        ))}
        {/* curves */}
        {computed.paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            clipPath={`url(#${plotClip})`}
            fill="none"
            stroke={p.color}
            strokeWidth="2.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ transition: trans }}
          />
        ))}
      </svg>

      {/* play/pause for the animated param (its slider below doubles as the scrubber) */}
      {animP && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 10,
          }}
        >
          <button
            type="button"
            className="tap"
            onClick={() => setPlaying((r) => !r)}
            aria-pressed={playing}
            aria-label={playing ? tr("השהיה", "Pause") : tr("הפעלה", "Play")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
              border: `1px solid ${playing ? PAL.accent : PAL.borderSoft}`,
              background: playing ? alpha(PAL.accent, 0.16) : "transparent",
              color: playing ? PAL.text : PAL.textMuted,
              borderRadius: 999,
              padding: "5px 13px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 11 }}>
              {playing ? "❚❚" : "▶"}
            </span>
            {playing ? tr("מנגן", "Playing") : tr("הפעלה", "Play")}
          </button>
          <span style={{ fontSize: 11.5, color: PAL.textFaint }}>
            {tr("אנימציה של", "animating")}{" "}
            <b style={{ color: PAL.textMuted }}>{animP.label || animP.var}</b>
          </span>
        </div>
      )}

      {/* sliders (the animated param's slider is the scrubber — dragging it pauses) */}
      {(spec.params || []).length > 0 && (
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {spec.params.map((p) => {
            const isAnim = animP && p.var === animP.var;
            return (
              <label
                key={p.var}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 12.5,
                }}
              >
                <span
                  style={{
                    color: isAnim ? PAL.accent : PAL.textMuted,
                    minWidth: 0,
                    fontWeight: 600,
                  }}
                >
                  {isAnim ? "▸ " : ""}
                  {p.label || p.var}
                </span>
                <input
                  type="range"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={vals[p.var]}
                  onChange={(e) => {
                    if (isAnim) setPlaying(false);
                    setVals((v) => ({ ...v, [p.var]: Number(e.target.value) }));
                  }}
                  style={{
                    accentColor: PAL.accent,
                    width: "100%",
                    cursor: "pointer",
                  }}
                  aria-label={p.label || p.var}
                />
                <b
                  style={{
                    color: PAL.text,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmt(vals[p.var])}
                  {p.unit ? ` ${p.unit}` : ""}
                </b>
              </label>
            );
          })}
        </div>
      )}

      {/* formulas + honesty label (same trust ethos as citations) */}
      <div
        style={{
          marginTop: 10,
          paddingTop: 9,
          borderTop: `1px solid ${PAL.borderSoft}`,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 10, minWidth: 0 }}
        >
          {spec.curves.map((c, i) => (
            <code
              key={i}
              dir="ltr"
              style={{
                fontSize: 11.5,
                color: PAL.textMuted,
                background: PAL.bg,
                borderRadius: 6,
                padding: "2px 7px",
                direction: "ltr",
              }}
            >
              {c.label ? `${c.label} = ` : ""}
              {c.expr}
            </code>
          ))}
        </div>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            whiteSpace: "nowrap",
          }}
        >
          {saveable && <ExportImageButton spec={spec} />}{" "}
        </span>
      </div>
    </div>
  );
}

// distribution — a named probability distribution as its density curve, with an optional
// shaded tail/interval (a p-value, rejection region, confidence area) and vertical marks (a
// critical value, an observed statistic, the mean). The density comes from the vetted pure
// distPdf — the model supplies only a dist enum + numeric params, so there is nothing to eval.
function distFormula(dist, p) {
  if (dist === "normal") return `N(μ=${fmt(p.mu)}, σ=${fmt(p.sigma)})`;
  if (dist === "t") return `t(df=${fmt(p.df)})`;
  if (dist === "chisq") return `χ²(df=${fmt(p.df)})`;
  if (dist === "exponential") return `Exp(λ=${fmt(p.lambda)})`;
  if (dist === "uniform") return `U(${fmt(p.a)}, ${fmt(p.b)})`;
  return dist;
}

function DistributionView({ spec, saveable = false }) {
  const { dist, params, shade, marks } = spec;
  const computed = useMemo(() => {
    const [xMin, xMax] = Array.isArray(spec.xRange)
      ? spec.xRange
      : distRange(dist, params);
    const N = 200;
    const pts = [];
    let yMax = 0;
    for (let i = 0; i <= N; i += 1) {
      const x = xMin + ((xMax - xMin) * i) / N;
      const y = distPdf(dist, params, x);
      const yy = Number.isFinite(y) && y > 0 ? y : 0;
      pts.push({ x, y: yy });
      if (yy > yMax) yMax = yy;
    }
    const yTop = yMax > 0 ? yMax * 1.15 : 1;
    const sx = (x) => M.l + ((x - xMin) / (xMax - xMin)) * PW;
    const sy = (y) => M.t + (1 - y / yTop) * PH;
    const baseY = sy(0);
    const line = pts
      .map(
        (p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`,
      )
      .join(" ");
    // Shaded probability region: clamp the (possibly open) tail into the window, trace the
    // density over it, then drop to the baseline — the same area-under technique the plots use.
    let shadePath = null,
      shadeLabelX = null;
    if (shade) {
      const lo = shade.from == null ? xMin : Math.max(xMin, shade.from);
      const hi = shade.to == null ? xMax : Math.min(xMax, shade.to);
      if (hi > lo) {
        const seg = pts.filter((p) => p.x >= lo - 1e-9 && p.x <= hi + 1e-9);
        if (seg.length >= 2) {
          shadePath =
            `M${sx(seg[0].x).toFixed(1)} ${baseY.toFixed(1)} ` +
            seg
              .map((p) => `L${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`)
              .join(" ") +
            ` L${sx(seg[seg.length - 1].x).toFixed(1)} ${baseY.toFixed(1)} Z`;
          shadeLabelX = sx((lo + hi) / 2);
        }
      }
    }
    const marked = (marks || []).map((m) => ({
      ...m,
      X: sx(m.x),
      Yc: sy(Math.max(0, distPdf(dist, params, m.x) || 0)),
      inRange: m.x >= xMin && m.x <= xMax,
    }));
    const ticks = Array.from(
      { length: 6 },
      (_, i) => xMin + ((xMax - xMin) * i) / 5,
    );
    return { sx, sy, baseY, line, shadePath, shadeLabelX, marked, ticks };
  }, [dist, params, shade, marks, spec.xRange]);

  const shadeColor = shade ? COLOR[shade.color] || PAL.warning : PAL.warning;
  return (
    <VizCard
      title={spec.title}
      ariaLabel={`${spec.title || tr("התפלגות", "Distribution")} — ${tr("התפלגות הסתברות", "probability distribution")}`}
      saveable={saveable}
      spec={spec}
      footerLeft={
        <code
          dir="ltr"
          style={{
            fontSize: 11.5,
            color: PAL.textMuted,
            background: PAL.bg,
            borderRadius: 6,
            padding: "2px 7px",
            direction: "ltr",
          }}
        >
          {distFormula(dist, params)}
        </code>
      }
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block", direction: "ltr", overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {computed.ticks.map((tx, i) => {
          const X = computed.sx(tx);
          return (
            <g key={`x${i}`}>
              <line
                x1={X}
                y1={M.t}
                x2={X}
                y2={H - M.b}
                stroke={PAL.border}
                strokeWidth="1"
                opacity="0.28"
              />
              <text
                x={X}
                y={H - M.b + 16}
                textAnchor="middle"
                fontSize="10"
                fill={PAL.textFaint}
              >
                {fmt(tx)}
              </text>
            </g>
          );
        })}
        <line
          x1={M.l}
          y1={computed.baseY}
          x2={W - M.r}
          y2={computed.baseY}
          stroke={PAL.textMuted}
          strokeWidth="1.4"
        />
        {computed.shadePath && (
          <g>
            <path
              d={computed.shadePath}
              fill={shadeColor}
              fillOpacity="0.22"
              stroke="none"
            />
            {shade.label && computed.shadeLabelX != null && (
              <text
                x={computed.shadeLabelX}
                y={M.t + 13}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill={shadeColor}
              >
                {shade.label}
              </text>
            )}
          </g>
        )}
        <path
          d={computed.line}
          fill="none"
          stroke={PAL.accent}
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {computed.marked
          .filter((m) => m.inRange)
          .map((m, i) => {
            const c = COLOR[m.color] || PAL.accent;
            return (
              <g key={`m${i}`}>
                <line
                  x1={m.X}
                  y1={m.Yc}
                  x2={m.X}
                  y2={computed.baseY}
                  stroke={c}
                  strokeWidth="1.8"
                  strokeDasharray="4 3"
                />
                <circle cx={m.X} cy={m.Yc} r="3.2" fill={c} />
                {m.label && (
                  <text
                    x={m.X}
                    y={computed.baseY + 28}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill={c}
                  >
                    {m.label}
                  </text>
                )}
              </g>
            );
          })}
      </svg>
    </VizCard>
  );
}

// Node-edge diagram (concept maps, processes, state machines). No expressions →
// no eval surface; positions are normalized 0..1 and the model lays them out.
function DiagramView({ spec, saveable = false }) {
  const DW = 560,
    DH = 320,
    PADX = 74,
    PADY = 32;
  const nx = (x) => PADX + x * (DW - 2 * PADX);
  const ny = (y) => PADY + y * (DH - 2 * PADY);
  const boxes = Object.create(null); // null-proto: a node id like "__proto__" keys an own entry
  spec.nodes.forEach((n) => {
    boxes[n.id] = {
      cx: nx(n.x),
      cy: ny(n.y),
      w: Math.min(184, Math.max(56, n.label.length * 7.4 + 22)),
      h: 36,
    };
  });
  deOverlap(boxes, { x0: 6, y0: 6, x1: DW - 6, y1: DH - 6 });
  return (
    <div
      role="img"
      aria-label={`${spec.title || tr("תרשים", "Diagram")} — ${tr("תרשים", "diagram")}`}
      style={{
        border: `1px solid ${PAL.borderSoft}`,
        borderRadius: RADIUS.lg,
        background: PAL.navyBubbleAI || PAL.surface,
        padding: 14,
        margin: "10px 0",
        maxWidth: "100%",
      }}
    >
      {spec.title && (
        <div
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: PAL.text,
            marginBottom: 6,
          }}
        >
          {spec.title}
        </div>
      )}
      <svg
        viewBox={`0 0 ${DW} ${DH}`}
        width="100%"
        style={{ display: "block", direction: "ltr", overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="viz-arrow"
            markerWidth="9"
            markerHeight="9"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L8,4 L0,8 z" fill={PAL.textMuted} />
          </marker>
        </defs>
        {spec.edges.map((e, i) => {
          const a = boxes[e.from],
            b = boxes[e.to];
          if (!a || !b) return null;
          const s = border(a, b.cx, b.cy),
            t = border(b, a.cx, a.cy);
          const mx = (s.x + t.x) / 2,
            my = (s.y + t.y) / 2;
          return (
            <g key={i}>
              <line
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={PAL.textMuted}
                strokeWidth="1.6"
                opacity="0.85"
                markerEnd="url(#viz-arrow)"
              />
              {e.label && (
                <>
                  <rect
                    x={mx - e.label.length * 3.4 - 4}
                    y={my - 9}
                    width={e.label.length * 6.8 + 8}
                    height={16}
                    rx="5"
                    fill={PAL.navyBubbleAI || PAL.surface}
                    opacity="0.95"
                  />
                  <text
                    x={mx}
                    y={my + 3}
                    textAnchor="middle"
                    fontSize="10.5"
                    fill={PAL.textMuted}
                  >
                    {e.label}
                  </text>
                </>
              )}
            </g>
          );
        })}
        {spec.nodes.map((n, i) => {
          const b = boxes[n.id],
            col = COLOR[n.color] || PAL.accent;
          return (
            <g key={i}>
              <rect
                x={b.cx - b.w / 2}
                y={b.cy - b.h / 2}
                width={b.w}
                height={b.h}
                rx="9"
                fill={col}
                fillOpacity="0.14"
                stroke={col}
                strokeWidth="1.7"
              />
              <text
                x={b.cx}
                y={b.cy + 4.5}
                textAnchor="middle"
                fontSize="12.5"
                fontWeight="600"
                fill={PAL.text}
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
      {saveable && (
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 9,
          }}
        >
          <ExportImageButton spec={spec} />
        </div>
      )}
    </div>
  );
}

// graph — a general network with deterministic auto-layout (from the pure graphLayout). Nodes are
// circles; edges are lines (arrowheads when directed) with an optional weight/label at the midpoint;
// an optional highlight set (a shortest path / MST / visited set) is drawn thicker in accent.
const GRA_W = 560,
  GRA_H = 360,
  GRA_PAD = 36,
  GRA_R = 19;
function GraphView({ spec, saveable = false }) {
  const directed = spec.directed;
  const { P, edges, hlNodes } = useMemo(() => {
    const pos = graphLayout(spec.nodes, spec.edges, spec.layout);
    const nx = (x) => GRA_PAD + x * (GRA_W - 2 * GRA_PAD);
    const ny = (y) => GRA_PAD + y * (GRA_H - 2 * GRA_PAD);
    const Pp = {};
    spec.nodes.forEach((nd) => {
      const p = pos[nd.id] || { x: 0.5, y: 0.5 };
      Pp[nd.id] = { x: nx(p.x), y: ny(p.y) };
    });
    const key = (a, b) => (directed ? `${a} ${b}` : [a, b].sort().join(" "));
    const hlEdges = new Set(
      (spec.highlight ? spec.highlight.edges : []).map((p) => key(p[0], p[1])),
    );
    const es = spec.edges.map((e) => {
      const a = Pp[e.from],
        b = Pp[e.to];
      const dx = b.x - a.x,
        dy = b.y - a.y,
        d = Math.hypot(dx, dy) || 1;
      const ux = dx / d,
        uy = dy / d;
      return {
        label: e.label,
        color: e.color,
        ux,
        uy,
        on: hlEdges.has(key(e.from, e.to)),
        start: { x: a.x + ux * GRA_R, y: a.y + uy * GRA_R },
        end: { x: b.x - ux * GRA_R, y: b.y - uy * GRA_R },
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    });
    return {
      P: Pp,
      edges: es,
      hlNodes: new Set(spec.highlight ? spec.highlight.nodes : []),
    };
  }, [spec, directed]);

  return (
    <VizCard
      title={spec.title}
      ariaLabel={`${spec.title || tr("גרף", "Graph")} — ${tr("גרף רשת", "network graph")}`}
      saveable={saveable}
      spec={spec}
    >
      <svg
        viewBox={`0 0 ${GRA_W} ${GRA_H}`}
        width="100%"
        style={{ display: "block", direction: "ltr", overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {edges.map((e, i) => {
          const c = e.on ? PAL.accent : COLOR[e.color] || PAL.textMuted;
          const back = (sign) => {
            const cs = Math.cos(0.42 * sign),
              sn = Math.sin(0.42 * sign);
            const rx = e.ux * cs - e.uy * sn,
              ry = e.ux * sn + e.uy * cs;
            return `${(e.end.x - 10 * rx).toFixed(1)},${(e.end.y - 10 * ry).toFixed(1)}`;
          };
          return (
            <g key={`e${i}`}>
              <line
                x1={e.start.x.toFixed(1)}
                y1={e.start.y.toFixed(1)}
                x2={e.end.x.toFixed(1)}
                y2={e.end.y.toFixed(1)}
                stroke={c}
                strokeWidth={e.on ? 3 : 1.7}
                opacity={e.on ? 0.95 : 0.75}
                strokeLinecap="round"
              />
              {directed && (
                <polygon
                  points={`${e.end.x.toFixed(1)},${e.end.y.toFixed(1)} ${back(1)} ${back(-1)}`}
                  fill={c}
                  opacity={e.on ? 0.95 : 0.85}
                />
              )}
              {e.label && (
                <g>
                  <rect
                    x={e.mid.x - e.label.length * 3.5 - 4}
                    y={e.mid.y - 9}
                    width={e.label.length * 7 + 8}
                    height="16"
                    rx="5"
                    fill={PAL.navyBubbleAI || PAL.surface}
                    opacity="0.96"
                  />
                  <text
                    x={e.mid.x}
                    y={e.mid.y + 3}
                    textAnchor="middle"
                    fontSize="10.5"
                    fontWeight="700"
                    fill={e.on ? PAL.accent : PAL.textMuted}
                  >
                    {e.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}
        {spec.nodes.map((nd, i) => {
          const p = P[nd.id];
          if (!p) return null;
          const c = COLOR[nd.color] || PAL.accent,
            on = hlNodes.has(nd.id);
          return (
            <g key={`n${i}`}>
              <circle
                cx={p.x}
                cy={p.y}
                r={GRA_R}
                fill={alpha(c, 0.16)}
                stroke={on ? PAL.accent : c}
                strokeWidth={on ? 3.2 : 1.9}
              />
              <text
                x={p.x}
                y={p.y + 4}
                textAnchor="middle"
                fontSize="12.5"
                fontWeight="700"
                fill={PAL.text}
              >
                {nd.label}
              </text>
            </g>
          );
        })}
      </svg>
    </VizCard>
  );
}

// Stepped Java memory model: a code panel (one active line per step), a Stack
// column of frames + variable slots and a Heap column of objects that appear /
// disappear as you step. Pure SVG, token colors, RTL-aware, reduced-motion-aware.
// ALL geometry is computed here — the model never supplies a coordinate, so the
// stack ordering, divider, and push/pop always render correctly.
const MS_MW = 560,
  MS_PAD = 14,
  MS_CODE_LH = 17,
  MS_CODE_TOP = 12,
  MS_FRAME_HEAD = 24,
  MS_SLOT_H = 28,
  MS_SLOT_GAP = 7,
  MS_FRAME_PAD = 9,
  MS_OBJ_H = 46,
  MS_OBJ_GAP = 14;

function MemSimView({ spec, saveable = false }) {
  const n = spec.steps.length;
  const [step, setStep] = useState(0);
  const reduceMotion = useReducedMotion();
  const cur = spec.steps[Math.max(0, Math.min(n - 1, step))] || {
    line: 0,
    caption: "",
    show: [],
    focus: [],
  };

  const geo = useMemo(() => {
    const showSet = new Set(cur.show);
    const visFrames = spec.frames.filter((f) => showSet.has(f.id));
    const visObjects = spec.objects.filter((o) => showSet.has(o.id));
    const visRefs = spec.refs.filter((r) => showSet.has(r.id));
    const slotsByFrame = new Map();
    spec.slots.forEach((s) => {
      if (showSet.has(s.id)) {
        const a = slotsByFrame.get(s.frame) || [];
        a.push(s);
        slotsByFrame.set(s.frame, a);
      }
    });

    const codeH = spec.code.length ? spec.code.length * MS_CODE_LH + 16 : 0;
    const panelBottom = spec.code.length ? 4 + codeH : 4;
    const headerY = panelBottom + 18;
    const contentY = headerY + 14;
    const colW = MS_MW / 2 - MS_PAD * 2;

    // Stack: newest frame on TOP (call-stack convention) → render reversed.
    const frameBoxes = [],
      slotBoxes = Object.create(null); // null-proto: ids like "__proto__" key own entries
    let y = contentY;
    [...visFrames].reverse().forEach((f) => {
      const fslots = slotsByFrame.get(f.id) || [];
      const inner = fslots.length
        ? fslots.length * (MS_SLOT_H + MS_SLOT_GAP) - MS_SLOT_GAP
        : 6;
      const fh = MS_FRAME_HEAD + inner + MS_FRAME_PAD;
      frameBoxes.push({
        id: f.id,
        label: f.label,
        x: MS_PAD,
        y,
        w: colW,
        h: fh,
      });
      let sy = y + MS_FRAME_HEAD;
      fslots.forEach((s) => {
        slotBoxes[s.id] = {
          id: s.id,
          slot: s,
          x: MS_PAD + MS_FRAME_PAD,
          y: sy,
          w: colW - MS_FRAME_PAD * 2,
          h: MS_SLOT_H,
        };
        sy += MS_SLOT_H + MS_SLOT_GAP;
      });
      y += fh + 12;
    });
    const stackBottom = y;

    // Heap: objects stacked on the right.
    const heapX = MS_MW / 2 + MS_PAD;
    const objBoxes = Object.create(null);
    let oy = contentY;
    visObjects.forEach((o) => {
      const ow = Math.min(colW, Math.max(96, o.label.length * 8 + 28));
      const ox = heapX + (colW - ow) / 2;
      objBoxes[o.id] = {
        id: o.id,
        obj: o,
        x: ox,
        y: oy,
        w: ow,
        h: MS_OBJ_H,
        cx: ox + ow / 2,
        cy: oy + MS_OBJ_H / 2,
      };
      oy += MS_OBJ_H + MS_OBJ_GAP;
    });
    const heapBottom = oy;

    const refLines = visRefs
      .map((r) => {
        const a = slotBoxes[r.from],
          b = objBoxes[r.to];
        if (!a || !b) return null;
        const from = { x: a.x + a.w, y: a.y + a.h / 2 };
        const to = border(b, from.x, from.y);
        return {
          id: r.id,
          label: r.label,
          from,
          to,
          mx: (from.x + to.x) / 2,
          my: (from.y + to.y) / 2,
        };
      })
      .filter(Boolean);

    const totalH = Math.max(stackBottom, heapBottom, contentY + 40) + MS_PAD;
    // Live counters (auto-derived from this step's visible ids — no model burden).
    const counts = {
      frames: visFrames.length,
      objects: visObjects.length,
      refs: visRefs.length,
    };
    return {
      codeH,
      headerY,
      contentY,
      frameBoxes,
      slotBoxes,
      objBoxes,
      refLines,
      totalH,
      focusSet: new Set(cur.focus),
      counts,
    };
  }, [spec, cur]);

  const anim = (delay = 0) =>
    reduceMotion ? undefined : `cardIn .28s ${EASE} ${delay}s both`;
  const ghost = {
    border: `1px solid ${PAL.borderSoft}`,
    background: "transparent",
    color: PAL.textMuted,
    borderRadius: 8,
    padding: "4px 11px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "system-ui, sans-serif",
    flex: "0 0 auto",
  };

  return (
    <div
      role="img"
      aria-label={`${spec.title || tr("סימולטור זיכרון", "Memory simulator")} — ${tr("הדגמה שלב-אחר-שלב", "step-by-step")}`}
      style={{
        border: `1px solid ${PAL.borderSoft}`,
        borderRadius: RADIUS.lg,
        background: PAL.navyBubbleAI || PAL.surface,
        padding: 14,
        margin: "10px 0",
        maxWidth: "100%",
      }}
    >
      {spec.title && (
        <div
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: PAL.text,
            marginBottom: 8,
          }}
        >
          {spec.title}
        </div>
      )}

      {/* live counters — auto-derived, simulator-style readout */}
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}
      >
        {[
          {
            label: tr("מסגרות במחסנית", "Stack Frames"),
            v: geo.counts.frames,
            c: COLOR.evTeal,
          },
          {
            label: tr("אובייקטים בערימה", "Heap Objects"),
            v: geo.counts.objects,
            c: COLOR.evGreen,
          },
          {
            label: tr("התייחסויות פעילות", "Active Refs"),
            v: geo.counts.refs,
            c: COLOR.evPurple,
          },
        ].map((m, i) => (
          <span
            key={i}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "4px 11px",
              borderRadius: 999,
              border: `1px solid ${alpha(m.c, 0.4)}`,
              background: alpha(m.c, 0.1),
              fontSize: 11.5,
              color: PAL.textMuted,
            }}
          >
            {m.label}{" "}
            <b
              style={{
                color: m.c,
                fontVariantNumeric: "tabular-nums",
                fontSize: 13.5,
              }}
            >
              {m.v}
            </b>
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${MS_MW} ${geo.totalH}`}
        width="100%"
        style={{ display: "block", direction: "ltr", overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="ms-arrow"
            markerWidth="9"
            markerHeight="9"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L8,4 L0,8 z" fill={COLOR.evPurple} />
          </marker>
        </defs>

        {/* code panel */}
        {spec.code.length > 0 && (
          <g>
            <rect
              x={MS_PAD}
              y={4}
              width={MS_MW - MS_PAD * 2}
              height={geo.codeH}
              rx="8"
              fill={PAL.bg}
              stroke={PAL.borderSoft}
            />
            {spec.code[cur.line] !== undefined && (
              <rect
                x={MS_PAD + 4}
                y={MS_CODE_TOP + cur.line * MS_CODE_LH}
                width={MS_MW - MS_PAD * 2 - 8}
                height={MS_CODE_LH}
                rx="4"
                fill={alpha(COLOR.warning, 0.18)}
              />
            )}
            {spec.code.map((ln, i) => (
              <text
                key={i}
                x={MS_PAD + 12}
                y={MS_CODE_TOP + i * MS_CODE_LH + 12}
                fontSize="12.5"
                fontFamily="monospace"
                fill={i === cur.line ? PAL.text : PAL.textMuted}
              >
                {ln}
              </text>
            ))}
          </g>
        )}

        {/* column headers + divider */}
        <text
          x={MS_MW / 4}
          y={geo.headerY}
          textAnchor="middle"
          fontSize="12"
          fontWeight="700"
          fill={PAL.textMuted}
        >
          {tr("מחסנית — Stack", "Stack")}
        </text>
        <text
          x={(MS_MW / 4) * 3}
          y={geo.headerY}
          textAnchor="middle"
          fontSize="12"
          fontWeight="700"
          fill={PAL.textMuted}
        >
          {tr("ערימה — Heap", "Heap")}
        </text>
        <line
          x1={MS_MW / 2}
          y1={geo.headerY + 8}
          x2={MS_MW / 2}
          y2={geo.totalH - 4}
          stroke={PAL.borderSoft}
          strokeWidth="1"
          strokeDasharray="4 5"
        />

        {/* stack frames */}
        {geo.frameBoxes.map((fb) => (
          <g key={fb.id} style={{ animation: anim() }}>
            <rect
              x={fb.x}
              y={fb.y}
              width={fb.w}
              height={fb.h}
              rx="11"
              fill={alpha(COLOR.evTeal, 0.08)}
              stroke={alpha(COLOR.evTeal, geo.focusSet.has(fb.id) ? 0.9 : 0.55)}
              strokeWidth="1.6"
            />
            <text
              x={fb.x + 12}
              y={fb.y + 16}
              fontSize="12.5"
              fontWeight="700"
              fill={PAL.text}
            >
              {fb.label}
            </text>
          </g>
        ))}
        {/* stack slots */}
        {Object.values(geo.slotBoxes).map((sb) => {
          const c = COLOR[sb.slot.color] || PAL.accent;
          const f = geo.focusSet.has(sb.id);
          return (
            <g key={sb.id} style={{ animation: anim(0.04) }}>
              <rect
                x={sb.x}
                y={sb.y}
                width={sb.w}
                height={sb.h}
                rx="7"
                fill={alpha(c, f ? 0.28 : 0.16)}
                stroke={c}
                strokeWidth={f ? 2 : 1.4}
              />
              <text
                x={sb.x + 10}
                y={sb.y + sb.h / 2 + 4}
                fontSize="12"
                fontFamily="monospace"
                fill={PAL.text}
              >
                {sb.slot.label}
              </text>
            </g>
          );
        })}

        {/* heap objects */}
        {Object.values(geo.objBoxes).map((ob) => {
          const c = COLOR[ob.obj.color] || PAL.evGreen;
          const f = geo.focusSet.has(ob.id);
          return (
            <g key={ob.id} style={{ animation: anim(0.06) }}>
              <rect
                x={ob.x}
                y={ob.y}
                width={ob.w}
                height={ob.h}
                rx="14"
                fill={alpha(c, f ? 0.3 : 0.16)}
                stroke={c}
                strokeWidth={f ? 2.2 : 1.7}
              />
              <text
                x={ob.cx}
                y={ob.cy + 4.5}
                textAnchor="middle"
                fontSize="12.5"
                fontWeight="600"
                fill={PAL.text}
              >
                {ob.obj.label}
              </text>
            </g>
          );
        })}

        {/* reference arrows (on top) */}
        {geo.refLines.map((rl) => (
          <g key={rl.id} style={{ animation: anim(0.08) }}>
            <line
              x1={rl.from.x}
              y1={rl.from.y}
              x2={rl.to.x}
              y2={rl.to.y}
              stroke={COLOR.evPurple}
              strokeWidth="1.8"
              opacity="0.9"
              markerEnd="url(#ms-arrow)"
            />
            {rl.label && (
              <>
                <rect
                  x={rl.mx - rl.label.length * 3.4 - 4}
                  y={rl.my - 9}
                  width={rl.label.length * 6.8 + 8}
                  height={16}
                  rx="5"
                  fill={PAL.navyBubbleAI || PAL.surface}
                  opacity="0.95"
                />
                <text
                  x={rl.mx}
                  y={rl.my + 3}
                  textAnchor="middle"
                  fontSize="10.5"
                  fill={PAL.textMuted}
                >
                  {rl.label}
                </text>
              </>
            )}
          </g>
        ))}
      </svg>

      {/* caption */}
      {cur.caption && (
        <div
          style={{
            marginTop: 8,
            color: PAL.textMuted,
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          {cur.caption}
        </div>
      )}

      {/* action buttons — jump to a pre-authored step (closed reducer; no model code) */}
      {spec.buttons.length > 0 && (
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}
        >
          {spec.buttons.map((b, i) => {
            const active = Math.min(n - 1, step) === b.step;
            return (
              <button
                key={i}
                type="button"
                className="tap"
                onClick={() => setStep(b.step)}
                aria-label={b.label}
                style={{
                  border: `1px solid ${active ? PAL.accent : PAL.borderSoft}`,
                  background: active ? alpha(PAL.accent, 0.16) : "transparent",
                  color: active ? PAL.text : PAL.textMuted,
                  borderRadius: 8,
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      )}

      {/* stepper + footer */}
      <div
        style={{
          marginTop: 10,
          paddingTop: 9,
          borderTop: `1px solid ${PAL.borderSoft}`,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
          }}
        >
          <button
            type="button"
            className="tap"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step <= 0}
            aria-label={tr("שלב קודם", "Previous step")}
            style={{ ...ghost, opacity: step <= 0 ? 0.45 : 1 }}
          >
            {tr("הקודם", "Prev")}
          </button>
          <span
            style={{
              minWidth: 0,
              whiteSpace: "nowrap",
              fontSize: 12,
              color: PAL.textMuted,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {tr("שלב", "Step")} {Math.min(n, step + 1)}/{n}
          </span>
          <button
            type="button"
            className="tap"
            onClick={() => setStep((s) => Math.min(n - 1, s + 1))}
            disabled={step >= n - 1}
            aria-label={tr("השלב הבא", "Next step")}
            style={{ ...ghost, opacity: step >= n - 1 ? 0.45 : 1 }}
          >
            {tr("הבא", "Next")}
          </button>
        </div>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            whiteSpace: "nowrap",
          }}
        >
          {saveable && <ExportImageButton spec={spec} />}{" "}
        </span>
      </div>
    </div>
  );
}

// bracket-sim — a LIVE, client-side stack / bracket-matching simulator. The algorithm
// below is fixed, trusted code (no eval): the student edits the input or picks an
// example and steps through it — each opener is pushed, each closer pops its match
// (or errors). The token row highlights the current char, the stack animates, a
// narration line explains each move, and a balanced/not-balanced verdict closes it.
const BSIM_PAIRS = { ")": "(", "]": "[", "}": "{" };
const BSIM_OPEN = new Set(["(", "[", "{"]);
const BSIM_CLOSE = new Set([")", "]", "}"]);
const bColor = (ch) =>
  ch === "(" || ch === ")"
    ? COLOR.accent
    : ch === "[" || ch === "]"
      ? COLOR.evTeal
      : COLOR.evPurple;

// Wrap a bracket char in a Unicode LTR isolate so it can't bidi-MIRROR inside the
// Hebrew narration ('(' rendering as ')' in an RTL run is the classic gotcha).
const bIso = (ch) => `'⁦${ch}⁩'`;

// Replay the algorithm over input[0..pos] (pos = -1 → not started). PURE, so the
// view re-derives the whole state every render — no stack/pointer desync to track.
function bracketTrace(input, pos) {
  let stack = [],
    status = "idle",
    message = "",
    errorAt = -1;
  for (let i = 0; i <= pos && i < input.length; i += 1) {
    const ch = input[i];
    if (BSIM_OPEN.has(ch)) {
      stack = [...stack, { ch, key: i }];
      status = "push";
      message = tr(
        `דחיפה: ${bIso(ch)} נכנס למחסנית`,
        `Push: ${bIso(ch)} onto the stack`,
      );
    } else if (BSIM_CLOSE.has(ch)) {
      const top = stack[stack.length - 1];
      if (!top) {
        status = "error";
        message = tr(
          `${bIso(ch)} — אבל המחסנית ריקה, אין סוגר פותח תואם`,
          `${bIso(ch)} — but the stack is empty, no opener to match`,
        );
        errorAt = i;
        break;
      }
      if (top.ch === BSIM_PAIRS[ch]) {
        stack = stack.slice(0, -1);
        status = "pop";
        message = tr(
          `שליפה: ${bIso(top.ch)} תואם ל-${bIso(ch)}`,
          `Pop: ${bIso(top.ch)} matches ${bIso(ch)}`,
        );
      } else {
        status = "error";
        message = tr(
          `${bIso(ch)} לא תואם ל-${bIso(top.ch)} שבראש המחסנית`,
          `${bIso(ch)} doesn't match ${bIso(top.ch)} on top`,
        );
        errorAt = i;
        break;
      }
    } else {
      status = "skip";
      message = tr(
        `${bIso(ch)} אינו סוגר — מדלגים וממשיכים`,
        `${bIso(ch)} isn't a bracket — skip it`,
      );
    }
  }
  let done = false,
    balanced = false;
  if (errorAt < 0 && pos >= input.length - 1 && input.length > 0) {
    done = true;
    balanced = stack.length === 0;
    status = balanced ? "balanced" : "error";
    message = balanced
      ? tr(
          "המחרוזת מאוזנת — כל סוגר נסגר כראוי ✓",
          "The string is balanced — every bracket closed correctly ✓",
        )
      : tr(
          `נשארו ${stack.length} סוגריים פתוחים שלא נסגרו ✗`,
          `${stack.length} bracket(s) left open and never closed ✗`,
        );
  }
  return { stack, status, message, errorAt, done, balanced };
}

function BracketSimView({ spec, saveable = false }) {
  const [input, setInput] = useState(spec.input);
  const [pos, setPos] = useState(-1);
  const [auto, setAuto] = useState(false);
  const len = input.length;
  const { stack, status, message, errorAt, done, balanced } = bracketTrace(
    input,
    pos,
  );
  const finished = done || errorAt >= 0;
  const reset = (next) => {
    setAuto(false);
    if (typeof next === "string") setInput(next);
    setPos(-1);
  };

  React.useEffect(() => {
    if (!auto) return undefined;
    if (finished) {
      setAuto(false);
      return undefined;
    }
    const id = setTimeout(() => setPos((p) => Math.min(len - 1, p + 1)), 650);
    return () => clearTimeout(id);
  }, [auto, pos, finished, len]);

  const ghost = {
    border: `1px solid ${PAL.borderSoft}`,
    background: "transparent",
    color: PAL.textMuted,
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "system-ui, sans-serif",
  };
  const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
  const opColor =
    status === "error"
      ? COLOR.warning
      : status === "balanced"
        ? COLOR.success
        : status === "push"
          ? COLOR.evTeal
          : status === "pop"
            ? COLOR.evGreen
            : PAL.textMuted;

  return (
    <div
      role="group"
      aria-label={`${spec.title || tr("סימולטור מחסנית", "Stack simulator")} — ${tr("בדיקת סוגריים", "bracket matching")}`}
      style={{
        border: `1px solid ${PAL.borderSoft}`,
        borderRadius: RADIUS.lg,
        background: PAL.navyBubbleAI || PAL.surface,
        padding: 14,
        margin: "10px 0",
        maxWidth: "100%",
      }}
    >
      {spec.title && (
        <div
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: PAL.text,
            marginBottom: 10,
          }}
        >
          {spec.title}
        </div>
      )}

      {/* editable input + reload */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          value={input}
          onChange={(e) => {
            setAuto(false);
            setPos(-1);
            setInput(e.target.value.slice(0, 60));
          }}
          dir="ltr"
          spellCheck={false}
          aria-label={tr("מחרוזת קלט", "Input string")}
          style={{
            flex: 1,
            minWidth: 0,
            background: PAL.surface || PAL.navyBg,
            border: `1px solid ${PAL.borderSoft}`,
            borderRadius: 10,
            padding: "9px 12px",
            color: PAL.text,
            fontSize: 15,
            fontFamily: mono,
            textAlign: "left",
          }}
        />
        <button
          type="button"
          className="tap"
          onClick={() => reset()}
          aria-label={tr("טען מחדש", "Reload")}
          style={ghost}
        >
          {tr("טען", "Load")}
        </button>
      </div>

      {/* example presets */}
      {spec.examples.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 12,
          }}
        >
          {spec.examples.map((ex, i) => (
            <button
              key={i}
              type="button"
              className="tap"
              onClick={() => reset(ex)}
              dir="ltr"
              style={{
                border: `1px solid ${ex === input ? COLOR.accent : PAL.borderSoft}`,
                background:
                  ex === input ? alpha(COLOR.accent, 0.14) : "transparent",
                color: ex === input ? PAL.text : PAL.textMuted,
                borderRadius: 8,
                padding: "4px 10px",
                fontSize: 12.5,
                fontFamily: mono,
                cursor: "pointer",
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      <svg
        viewBox={`0 0 560 ${150 + Math.ceil(input.length / 18) * 36 + Math.max(stack.length, 1) * 28}`}
        width="100%"
        role="img"
        aria-label="Bracket tokens and stack"
        style={{ direction: "ltr", display: "block" }}
      >
        {input.split("").map((ch, i) => {
          const x = 12 + (i % 18) * 30,
            y = 10 + Math.floor(i / 18) * 36;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width="27"
                height="30"
                rx="5"
                fill={
                  i === errorAt ? "#fae5d4" : i === pos ? "#dbe8ff" : "#f4f6fa"
                }
                stroke={i === pos ? PAL.accent : PAL.border}
              />
              <text
                x={x + 13.5}
                y={y + 21}
                textAnchor="middle"
                fontFamily="monospace"
                fontSize="16"
                fill={bColor(ch)}
              >
                {ch === " " ? "·" : ch}
              </text>
            </g>
          );
        })}
        <text
          x="14"
          y={55 + Math.ceil(input.length / 18) * 36}
          fontSize="12"
          fill={PAL.text}
        >
          Stack (bottom to top →)
        </text>
        {(stack.length ? stack : [{ ch: "empty", key: "empty" }]).map(
          (entry, i) => (
            <g key={entry.key}>
              <rect
                x="14"
                y={70 + Math.ceil(input.length / 18) * 36 + i * 28}
                width="90"
                height="25"
                fill="#eaf0f7"
                stroke={PAL.border}
              />
              <text
                x="59"
                y={88 + Math.ceil(input.length / 18) * 36 + i * 28}
                textAnchor="middle"
                fill={PAL.text}
                fontSize="14"
              >
                {entry.ch}
              </text>
            </g>
          ),
        )}
        <text
          x="125"
          y={90 + Math.ceil(input.length / 18) * 36}
          fill={opColor}
          fontSize="14"
        >
          {status === "idle" ? "Ready — press Step" : status}
        </text>
      </svg>
      <p
        role="status"
        style={{ fontSize: 13, lineHeight: 1.6, color: opColor }}
      >
        {message ||
          "Read the input from left to right. The stack starts empty."}
      </p>

      {/* controls + footer */}
      <div
        style={{
          marginTop: 12,
          paddingTop: 9,
          borderTop: `1px solid ${PAL.borderSoft}`,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button
            type="button"
            className="tap"
            onClick={() => {
              setAuto(false);
              setPos((p) => Math.min(len - 1, p + 1));
            }}
            disabled={finished}
            style={{
              ...ghost,
              border: `1px solid ${COLOR.accent}`,
              color: finished ? PAL.textFaint : PAL.text,
              opacity: finished ? 0.5 : 1,
            }}
          >
            {tr("צעד ▸", "Step ▸")}
          </button>
          <button
            type="button"
            className="tap"
            onClick={() => setAuto((a) => !a)}
            disabled={finished}
            style={{ ...ghost, opacity: finished ? 0.5 : 1 }}
          >
            {auto
              ? tr("עצור ⏸", "Pause ⏸")
              : tr("הרץ אוטומטית ▸▸", "Auto-run ▸▸")}
          </button>
          <button
            type="button"
            className="tap"
            onClick={() => reset()}
            style={ghost}
          >
            {tr("אפס ↺", "Reset ↺")}
          </button>
        </div>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            whiteSpace: "nowrap",
          }}
        >
          {saveable && <ExportImageButton spec={spec} />}
          <span style={{ fontSize: 10.5, color: PAL.textFaint }}>
            {tr("אינטראקטיבי", "Interactive")}
          </span>
        </span>
      </div>
    </div>
  );
}

// Chart — discrete data: grouped bars / multi-line over categories, a pie, or an xy
// scatter. Pure themed SVG (no chart lib), auto-scaled, 0-baseline for bar/line. All
// numeric, no expressions → no eval surface.
const C_W = 560,
  C_H = 300,
  C_M = { t: 14, r: 18, b: 46, l: 52 };
const C_PW = C_W - C_M.l - C_M.r,
  C_PH = C_H - C_M.t - C_M.b;

function ChartView({ spec, saveable = false }) {
  const type = spec.chartType;
  const series = spec.series || [];
  const reduceMotion = useReducedMotion();
  const grow = reduceMotion ? undefined : `cardIn .3s ${EASE} both`;
  const ariaLabel = `${spec.title || tr("תרשים", "Chart")} — ${tr("תרשים נתונים", "data chart")}`;

  if (type === "pie") {
    const slices = (series[0]?.data || []).map((v, i) => ({
      v: Math.max(0, v),
      label: spec.labels[i] || "",
      color: CHART_PALETTE[i % CHART_PALETTE.length],
    }));
    const total = slices.reduce((a, s) => a + s.v, 0) || 1;
    const cx = C_W * 0.32,
      cy = C_H / 2,
      r = Math.min(C_H, C_W * 0.4) / 2 - 12;
    let a0 = -Math.PI / 2;
    const arcs = slices.map((s) => {
      const a1 = a0 + (s.v / total) * Math.PI * 2;
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const x0 = cx + r * Math.cos(a0),
        y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1),
        y1 = cy + r * Math.sin(a1);
      const mid = (a0 + a1) / 2;
      const out = {
        d: `M${cx} ${cy} L${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${big} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`,
        color: s.color,
        pct: Math.round((s.v / total) * 100),
        lx: cx + r * 0.62 * Math.cos(mid),
        ly: cy + r * 0.62 * Math.sin(mid),
        show: s.v / total > 0.04,
      };
      a0 = a1;
      return out;
    });
    return (
      <VizCard
        title={spec.title}
        ariaLabel={ariaLabel}
        saveable={saveable}
        spec={spec}
        footerLeft={slices.map((s, i) => (
          <span
            key={i}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11.5,
              color: PAL.textMuted,
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 3,
                background: s.color,
              }}
            />{" "}
            {s.label} {Math.round((s.v / total) * 100)}%
          </span>
        ))}
      >
        <svg
          viewBox={`0 0 ${C_W} ${C_H}`}
          width="100%"
          style={{ display: "block", overflow: "visible" }}
          preserveAspectRatio="xMidYMid meet"
        >
          {arcs.map((a, i) => (
            <g key={i} style={{ animation: grow }}>
              <path
                d={a.d}
                fill={a.color}
                fillOpacity="0.82"
                stroke={PAL.navyBubbleAI || PAL.surface}
                strokeWidth="1.5"
              />
              {a.show && (
                <text
                  x={a.lx}
                  y={a.ly + 4}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="700"
                  fill={PAL.text}
                >
                  {a.pct}%
                </text>
              )}
            </g>
          ))}
        </svg>
      </VizCard>
    );
  }

  if (type === "scatter") {
    const pts = series.flatMap((s) => s.points);
    let xMin = Math.min(...pts.map((p) => p.x)),
      xMax = Math.max(...pts.map((p) => p.x));
    let yMin = Math.min(...pts.map((p) => p.y)),
      yMax = Math.max(...pts.map((p) => p.y));
    if (!Number.isFinite(xMin)) {
      xMin = 0;
      xMax = 1;
    }
    if (xMin === xMax) {
      xMin -= 1;
      xMax += 1;
    }
    if (!Number.isFinite(yMin)) {
      yMin = 0;
      yMax = 1;
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const px = (yMax - yMin) * 0.08,
      qx = (xMax - xMin) * 0.06;
    yMin -= px;
    yMax += px;
    xMin -= qx;
    xMax += qx;
    const sx = (x) => C_M.l + ((x - xMin) / (xMax - xMin)) * C_PW;
    const sy = (y) => C_M.t + (1 - (y - yMin) / (yMax - yMin)) * C_PH;
    const yTicks = Array.from(
      { length: 5 },
      (_, i) => yMin + ((yMax - yMin) * i) / 4,
    );
    const xTicks = Array.from(
      { length: 6 },
      (_, i) => xMin + ((xMax - xMin) * i) / 5,
    );
    return (
      <VizCard
        title={spec.title}
        ariaLabel={ariaLabel}
        saveable={saveable}
        spec={spec}
      >
        <Legend
          items={series
            .filter((s) => s.name)
            .map((s) => ({
              label: s.name,
              color: COLOR[s.color] || PAL.accent,
            }))}
        />
        <svg
          viewBox={`0 0 ${C_W} ${C_H}`}
          width="100%"
          style={{ display: "block", direction: "ltr", overflow: "visible" }}
          preserveAspectRatio="xMidYMid meet"
        >
          {yTicks.map((t, i) => (
            <g key={`y${i}`}>
              <line
                x1={C_M.l}
                y1={sy(t)}
                x2={C_W - C_M.r}
                y2={sy(t)}
                stroke={PAL.border}
                strokeWidth="1"
                opacity="0.5"
              />
              <text
                x={C_M.l - 8}
                y={sy(t) + 3.5}
                textAnchor="end"
                fontSize="10"
                fill={PAL.textFaint}
              >
                {fmt(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text
              key={`x${i}`}
              x={sx(t)}
              y={C_H - C_M.b + 16}
              textAnchor="middle"
              fontSize="10"
              fill={PAL.textFaint}
            >
              {fmt(t)}
            </text>
          ))}
          {spec.x && spec.x.label && (
            <text
              x={C_M.l + C_PW / 2}
              y={C_H - 6}
              textAnchor="middle"
              fontSize="11"
              fill={PAL.textMuted}
            >
              {spec.x.label}
            </text>
          )}
          {spec.y && spec.y.label && (
            <text
              transform={`translate(14 ${C_M.t + C_PH / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize="11"
              fill={PAL.textMuted}
            >
              {spec.y.label}
            </text>
          )}
          {series.map((s, si) =>
            s.points.map((p, i) => (
              <circle
                key={`${si}-${i}`}
                cx={sx(p.x)}
                cy={sy(p.y)}
                r="3.6"
                fill={COLOR[s.color] || PAL.accent}
                fillOpacity="0.85"
                style={{ animation: grow }}
              />
            )),
          )}
        </svg>
      </VizCard>
    );
  }

  // bar / line — categorical, 0-baseline, auto-scaled.
  const labels = spec.labels;
  const all = series.flatMap((s) => s.data);
  let yMax = Math.max(0, ...all),
    yMin = Math.min(0, ...all);
  if (!Number.isFinite(yMax) || yMax === yMin) {
    yMax = yMax || 1;
    yMin = Math.min(0, yMin);
  }
  yMax += (yMax - yMin) * 0.08;
  const sy = (y) => C_M.t + (1 - (y - yMin) / (yMax - yMin)) * C_PH;
  const band = C_PW / labels.length;
  const cxOf = (i) => C_M.l + band * (i + 0.5);
  const yTicks = Array.from(
    { length: 5 },
    (_, i) => yMin + ((yMax - yMin) * i) / 4,
  );
  const groupW = band * 0.7,
    barW = groupW / series.length;
  return (
    <VizCard
      title={spec.title}
      ariaLabel={ariaLabel}
      saveable={saveable}
      spec={spec}
    >
      <Legend
        items={series.map((s) => ({
          label: s.name || "",
          color: COLOR[s.color] || PAL.accent,
        }))}
      />
      <svg
        viewBox={`0 0 ${C_W} ${C_H}`}
        width="100%"
        style={{ display: "block", direction: "ltr", overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line
              x1={C_M.l}
              y1={sy(t)}
              x2={C_W - C_M.r}
              y2={sy(t)}
              stroke={PAL.border}
              strokeWidth="1"
              opacity={t === 0 ? 0.9 : 0.45}
            />
            <text
              x={C_M.l - 8}
              y={sy(t) + 3.5}
              textAnchor="end"
              fontSize="10"
              fill={PAL.textFaint}
            >
              {fmt(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => (
          <text
            key={`x${i}`}
            x={cxOf(i)}
            y={C_H - C_M.b + 16}
            textAnchor="middle"
            fontSize="10.5"
            fill={PAL.textMuted}
          >
            {l}
          </text>
        ))}
        {spec.y && spec.y.label && (
          <text
            transform={`translate(14 ${C_M.t + C_PH / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize="11"
            fill={PAL.textMuted}
          >
            {spec.y.label}
          </text>
        )}
        {type === "line"
          ? series.map((s, si) => {
              const d = s.data
                .map(
                  (v, i) =>
                    `${i ? "L" : "M"}${cxOf(i).toFixed(1)} ${sy(v).toFixed(1)} `,
                )
                .join("");
              const col = COLOR[s.color] || PAL.accent;
              return (
                <g key={si}>
                  <path
                    d={d}
                    fill="none"
                    stroke={col}
                    strokeWidth="2.4"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    style={{ animation: grow }}
                  />
                  {s.data.map((v, i) => (
                    <circle key={i} cx={cxOf(i)} cy={sy(v)} r="3" fill={col} />
                  ))}
                </g>
              );
            })
          : series.map((s, si) => {
              const col = COLOR[s.color] || PAL.accent;
              return (
                <g key={si}>
                  {s.data.map((v, i) => {
                    const x = cxOf(i) - groupW / 2 + si * barW;
                    const y0 = sy(Math.max(0, v)),
                      y1 = sy(Math.min(0, v));
                    return (
                      <rect
                        key={i}
                        x={x + 1}
                        y={y0}
                        width={Math.max(1, barW - 2)}
                        height={Math.max(0, y1 - y0)}
                        rx="3"
                        fill={col}
                        fillOpacity="0.85"
                        style={{ animation: grow }}
                      />
                    );
                  })}
                </g>
              );
            })}
      </svg>
    </VizCard>
  );
}

// Table / matrix — a crisp HTML grid (truth tables, matrices, Punnett squares,
// comparison tables). HTML beats SVG here: native cell sizing + sharp text. Themed
// header row/col and per-cell highlights via token colors.
function TableView({ spec, saveable = false }) {
  const cols = spec.rows[0].length,
    cw = 100,
    rh = 58,
    w = cols * cw,
    h = spec.rows.length * rh;
  const hi = new Map(
    (spec.highlight || []).map((x) => [
      `${x.r},${x.c}`,
      COLOR[x.color] || PAL.accent,
    ]),
  );
  const wrap = (s) => s.match(/.{1,14}/gu) || [""];
  return (
    <VizCard
      title={spec.title}
      ariaLabel={spec.title || "Table"}
      saveable={saveable}
      spec={spec}
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        role="img"
        aria-label={spec.title || "Table"}
        style={{ display: "block", direction: "ltr" }}
      >
        {spec.rows.flatMap((row, r) =>
          row.map((cell, c) => {
            const head =
              (spec.headerRow && r === 0) || (spec.headerCol && c === 0);
            const bg = hi.get(`${r},${c}`);
            const lines = wrap(cell);
            return (
              <g key={`${r}/${c}`}>
                <rect
                  x={c * cw}
                  y={r * rh}
                  width={cw}
                  height={rh}
                  fill={bg ? alpha(bg, 0.16) : head ? "#eaf0f7" : "#ffffff"}
                  stroke={PAL.border}
                />
                <text
                  x={(c + 0.5) * cw}
                  y={r * rh + rh / 2 - (lines.length - 1) * 7}
                  textAnchor="middle"
                  fill={PAL.text}
                  fontSize="12"
                  fontWeight={head ? 700 : 400}
                >
                  {lines.map((line, i) => (
                    <tspan key={i} x={(c + 0.5) * cw} dy={i ? 14 : 0}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          }),
        )}
      </svg>
    </VizCard>
  );
}

// Tree — a hierarchy with a tidy DETERMINISTIC leveled layout computed here (leaves
// get evenly-spaced slots; parents centre over their children). The model supplies
// only parent→child links, never coordinates → recursion trees / BSTs / taxonomies
// render cleanly without the old hand-placement pain. Pure themed SVG.
const TR_W = 560,
  TR_PADX = 46,
  TR_PADY = 26,
  TR_LEVEL = 68,
  TR_NH = 30;

function TreeView({ spec, saveable = false }) {
  const nodes = spec.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map(nodes.map((n) => [n.id, []]));
  const roots = [];
  nodes.forEach((n) => {
    if (n.parent && kids.has(n.parent)) kids.get(n.parent).push(n.id);
    else roots.push(n.id);
  });

  const depth = new Map();
  let maxDepth = 0;
  const setDepth = (id, d) => {
    depth.set(id, d);
    maxDepth = Math.max(maxDepth, d);
    kids.get(id).forEach((k) => setDepth(k, d + 1));
  };
  roots.forEach((r) => setDepth(r, 0));

  const xpos = new Map();
  let leaf = 0;
  const place = (id) => {
    const ks = kids.get(id);
    if (!ks.length) {
      xpos.set(id, leaf);
      leaf += 1;
      return xpos.get(id);
    }
    const xs = ks.map(place);
    const c = (xs[0] + xs[xs.length - 1]) / 2;
    xpos.set(id, c);
    return c;
  };
  roots.forEach(place);
  const leaves = Math.max(1, leaf);

  const TR_H = Math.max(120, TR_PADY * 2 + maxDepth * TR_LEVEL + TR_NH + 16);
  const nx = (slot) =>
    leaves === 1
      ? TR_W / 2
      : TR_PADX + (slot / (leaves - 1)) * (TR_W - 2 * TR_PADX);
  const ny = (d) => TR_PADY + d * TR_LEVEL + TR_NH / 2;
  const box = (id) => {
    const n = byId.get(id);
    return {
      cx: nx(xpos.get(id)),
      cy: ny(depth.get(id)),
      w: Math.min(124, Math.max(32, n.label.length * 8 + 18)),
      h: TR_NH,
    };
  };

  return (
    <VizCard
      title={spec.title}
      ariaLabel={`${spec.title || tr("עץ", "Tree")} — ${tr("היררכיה", "hierarchy")}`}
      saveable={saveable}
      spec={spec}
    >
      <svg
        viewBox={`0 0 ${TR_W} ${TR_H}`}
        width="100%"
        style={{ display: "block", direction: "ltr", overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {nodes
          .filter((n) => n.parent && byId.has(n.parent))
          .map((n, i) => {
            const p = box(n.parent),
              c = box(n.id);
            return (
              <line
                key={i}
                x1={p.cx}
                y1={p.cy + p.h / 2}
                x2={c.cx}
                y2={c.cy - c.h / 2}
                stroke={PAL.textMuted}
                strokeWidth="1.5"
                opacity="0.7"
              />
            );
          })}
        {nodes.map((n, i) => {
          const b = box(n.id),
            col = COLOR[n.color] || PAL.accent;
          return (
            <g key={i}>
              <rect
                x={b.cx - b.w / 2}
                y={b.cy - b.h / 2}
                width={b.w}
                height={b.h}
                rx="8"
                fill={col}
                fillOpacity="0.16"
                stroke={col}
                strokeWidth="1.6"
              />
              <text
                x={b.cx}
                y={b.cy + 4.5}
                textAnchor="middle"
                fontSize="12.5"
                fontWeight="600"
                fill={PAL.text}
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </VizCard>
  );
}

// geometry2d — a coordinate canvas. Maps world coords (xRange × yRange) → SVG, optional
// grid + axes through the origin, then draws each typed primitive. Vectors get a manually
// drawn (colour-matched) arrowhead; functions sample the no-eval engine; circles render as
// faithful ellipses under non-square scales. Items are z-ordered so points/labels/vectors
// always sit above fills.
const G_W = 560,
  G_H = 320,
  G_M = 16;
// z-order: mechanics furniture (incline/ground/wall) sits behind everything; supports,
// springs, dimensions & angle arcs mid; force VECTORS + points + labels stay on top.
const G_Z = {
  incline: -1,
  ground: -1,
  wall: -1,
  function: 0,
  polygon: 0,
  sector: 0,
  circle: 1,
  segment: 1,
  line: 1,
  spring: 1,
  support: 1,
  dimension: 1,
  angle: 1,
  vector: 2,
  point: 3,
  label: 4,
};

// 45° hatch ticks along an edge (PIXEL coords) → a path `d`; the fixed-boundary marker
// shared by ground / wall / fixed support. Ticks fall on the side the normal points to
// (flip to switch sides). Evenly spaced regardless of length — the renderer owns this so
// the model never hand-draws hatching.
function hatchTicks(x1, y1, x2, y2, flip = false) {
  const dx = x2 - x1,
    dy = y2 - y1,
    len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len;
  const nx = flip ? uy : -uy,
    ny = flip ? -ux : ux;
  const gap = 9,
    tick = 7,
    n = Math.max(1, Math.round(len / gap));
  let d = "";
  for (let i = 0; i <= n; i += 1) {
    const t = (i / n) * len,
      px = x1 + ux * t,
      py = y1 + uy * t;
    d += `M${px.toFixed(1)} ${py.toFixed(1)} L${(px + (nx - ux) * tick).toFixed(1)} ${(py + (ny - uy) * tick).toFixed(1)} `;
  }
  return d;
}

// A triangle-wave spring between two PIXEL points, with straight leads at each end.
function springPath(x1, y1, x2, y2, coils) {
  const dx = x2 - x1,
    dy = y2 - y1,
    len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len,
    nx = -uy,
    ny = ux;
  const lead = Math.min(14, len * 0.2),
    body = len - 2 * lead;
  const n = Math.max(3, coils || Math.round(body / 12)),
    seg = 2 * n,
    amp = 7;
  const at = (t, off) =>
    `${(x1 + ux * t + nx * off).toFixed(1)} ${(y1 + uy * t + ny * off).toFixed(1)}`;
  let d = `M${at(0, 0)} L${at(lead, 0)}`;
  for (let i = 1; i < seg; i += 1)
    d += ` L${at(lead + (body * i) / seg, i % 2 ? amp : -amp)}`;
  return `${d} L${at(len - lead, 0)} L${at(len, 0)}`;
}

// A short arc (PIXEL center + radius) sampled from angle a1→a2 as a polyline `d` — robust
// vs. SVG arc sweep flags (screen-y is flipped). Used for incline + angle markers.
function arcPolyline(cx, cy, r, a1, a2, steps = 16) {
  let pts = "";
  for (let k = 0; k <= steps; k += 1) {
    const a = a1 + (a2 - a1) * (k / steps);
    pts += `${k ? "L" : "M"}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)} `;
  }
  return pts;
}

function niceStep(span) {
  const raw = span / 8;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p;
}

// π-fraction captions for the polar-grid spokes (every 30°), so the θ=const rays are
// labeled in radians the way a polar plot is read.
const POLAR_ANGLE_LABEL = {
  0: "0",
  30: "π/6",
  60: "π/3",
  90: "π/2",
  120: "2π/3",
  150: "5π/6",
  180: "π",
  210: "7π/6",
  240: "4π/3",
  270: "3π/2",
  300: "5π/3",
  330: "11π/6",
};

// slope-field — the proper renderer for first-order ODEs y' = f(x,y). Samples the
// slope on a grid and draws a short segment at each point, angled to the local
// slope and coloured by sign (rising teal / falling orange / flat accent). Singular
// points (∞ / NaN, e.g. ÷0) are drawn as gaps. Same coords/axes as geometry2d.
function SlopeFieldView({ spec, saveable = false }) {
  const [xMin, xMax] = spec.xRange,
    [yMin, yMax] = spec.yRange;
  const PW = G_W - 2 * G_M,
    PH = G_H - 2 * G_M;
  const sx = (x) => G_M + ((x - xMin) / (xMax - xMin)) * PW;
  const sy = (y) => G_M + (1 - (y - yMin) / (yMax - yMin)) * PH;
  const inX = (x) => x >= xMin && x <= xMax,
    inY = (y) => y >= yMin && y <= yMax;
  const xStep = niceStep(xMax - xMin),
    yStep = niceStep(yMax - yMin);
  const xs = [],
    ys = [];
  for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax + 1e-9; x += xStep)
    xs.push(Number(x.toFixed(6)));
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep)
    ys.push(Number(y.toFixed(6)));

  const N = spec.density;
  const L = (Math.min(PW, PH) / (N + 1)) * 0.82; // segment length (px)
  const ux = PW / (xMax - xMin),
    uy = PH / (yMax - yMin); // px per unit
  const segs = [];
  for (let i = 0; i < N; i += 1) {
    for (let j = 0; j < N; j += 1) {
      const x = xMin + ((xMax - xMin) * (i + 0.5)) / N;
      const y = yMin + ((yMax - yMin) * (j + 0.5)) / N;
      const m = evalExpr(spec._ast, { x, y });
      if (!Number.isFinite(m)) continue; // singular point → gap
      // data direction (1, m) → screen (ux, -uy*m), normalised to length L
      let dxp = ux,
        dyp = -uy * m;
      const mag = Math.hypot(dxp, dyp) || 1;
      dxp = (dxp / mag) * (L / 2);
      dyp = (dyp / mag) * (L / 2);
      const col =
        m > 0.02 ? COLOR.evTeal : m < -0.02 ? COLOR.evOrange : COLOR.accent;
      segs.push({
        x1: sx(x) - dxp,
        y1: sy(y) - dyp,
        x2: sx(x) + dxp,
        y2: sy(y) + dyp,
        col,
      });
    }
  }

  return (
    <VizCard
      title={spec.title}
      ariaLabel={`${spec.title || tr("שדה כיוונים", "Slope field")} — ${tr("שדה כיוונים של משוואה דיפרנציאלית", "direction field")}`}
      saveable={saveable}
      spec={spec}
    >
      <svg
        viewBox={`0 0 ${G_W} ${G_H}`}
        width="100%"
        style={{ display: "block", direction: "ltr", overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {xs.map((x, i) => (
          <line
            key={`gx${i}`}
            x1={sx(x)}
            y1={G_M}
            x2={sx(x)}
            y2={G_H - G_M}
            stroke={PAL.border}
            strokeWidth="1"
            opacity="0.2"
          />
        ))}
        {ys.map((y, i) => (
          <line
            key={`gy${i}`}
            x1={G_M}
            y1={sy(y)}
            x2={G_W - G_M}
            y2={sy(y)}
            stroke={PAL.border}
            strokeWidth="1"
            opacity="0.2"
          />
        ))}
        {inY(0) && (
          <line
            x1={G_M}
            y1={sy(0)}
            x2={G_W - G_M}
            y2={sy(0)}
            stroke={PAL.textMuted}
            strokeWidth="1.4"
            opacity="0.7"
          />
        )}
        {inX(0) && (
          <line
            x1={sx(0)}
            y1={G_M}
            x2={sx(0)}
            y2={G_H - G_M}
            stroke={PAL.textMuted}
            strokeWidth="1.4"
            opacity="0.7"
          />
        )}
        {inY(0) &&
          xs
            .filter((x) => Math.abs(x) > 1e-9)
            .map((x, i) => (
              <text
                key={`tx${i}`}
                x={sx(x)}
                y={sy(0) + 13}
                textAnchor="middle"
                fontSize="9.5"
                fill={PAL.textFaint}
              >
                {fmt(x)}
              </text>
            ))}
        {inX(0) &&
          ys
            .filter((y) => Math.abs(y) > 1e-9)
            .map((y, i) => (
              <text
                key={`ty${i}`}
                x={sx(0) - 6}
                y={sy(y) + 3.5}
                textAnchor="end"
                fontSize="9.5"
                fill={PAL.textFaint}
              >
                {fmt(y)}
              </text>
            ))}
        {segs.map((s, i) => (
          <line
            key={i}
            x1={s.x1.toFixed(1)}
            y1={s.y1.toFixed(1)}
            x2={s.x2.toFixed(1)}
            y2={s.y2.toFixed(1)}
            stroke={s.col}
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.92"
          />
        ))}
      </svg>
      <div
        dir="ltr"
        style={{
          marginTop: 6,
          fontFamily: "ui-monospace, monospace",
          fontSize: 12.5,
          color: PAL.textMuted,
          textAlign: "center",
        }}
      >{`y' = ${spec.expr}`}</div>
    </VizCard>
  );
}

// transform2d — a 2×2 linear map animated on the plane (the columns of M are the transformed basis
// î, ĵ). Reuses the geometry2d world→screen mapping and a plot-style rAF clock: an identity→M sweep
// deforms the accent grid off the faint static grid, with the unit-circle→ellipse and real
// eigenvector directions on request.
const TR_SZ = 420,
  TR_PAD = 12;
function Transform2DView({ spec, saveable = false }) {
  const { matrix, show, vectors, range } = spec;
  const reduceMotion = useReducedMotion();
  const [t, setT] = useState(1);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef(0);
  useEffect(() => {
    if (!playing) return undefined;
    const dur = 1700;
    let start = null;
    const t0 = t;
    const tick = (now) => {
      if (start == null) start = now;
      const nt = Math.min(1, t0 + (now - start) / dur);
      setT(nt);
      if (nt >= 1) {
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const eig = useMemo(() => eigen2x2(matrix), [matrix]);
  const det = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
  const nr = (n) => Math.round(n * 100) / 100;

  const geo = useMemo(() => {
    const cx = TR_SZ / 2,
      cy = TR_SZ / 2,
      scale = (TR_SZ - 2 * TR_PAD) / 2 / range;
    const sx = (x) => cx + x * scale,
      sy = (y) => cy - y * scale;
    const Mt = [
      [1 + t * (matrix[0][0] - 1), t * matrix[0][1]],
      [t * matrix[1][0], 1 + t * (matrix[1][1] - 1)],
    ];
    const ap = (x, y) => [
      Mt[0][0] * x + Mt[0][1] * y,
      Mt[1][0] * x + Mt[1][1] * y,
    ];
    const R = Math.min(range, 8);
    const staticLines = [],
      lines = [];
    for (let i = -R; i <= R; i += 1) {
      staticLines.push([sx(i), sy(-R), sx(i), sy(R)]);
      staticLines.push([sx(-R), sy(i), sx(R), sy(i)]);
      const p1 = ap(i, -R),
        p2 = ap(i, R),
        p3 = ap(-R, i),
        p4 = ap(R, i);
      lines.push({
        x1: sx(p1[0]),
        y1: sy(p1[1]),
        x2: sx(p2[0]),
        y2: sy(p2[1]),
        axis: i === 0,
      });
      lines.push({
        x1: sx(p3[0]),
        y1: sy(p3[1]),
        x2: sx(p4[0]),
        y2: sy(p4[1]),
        axis: i === 0,
      });
    }
    const iHat = ap(1, 0),
      jHat = ap(0, 1);
    const basis = [
      { x: sx(iHat[0]), y: sy(iHat[1]), label: "î", color: COLOR.evGreen },
      { x: sx(jHat[0]), y: sy(jHat[1]), label: "ĵ", color: COLOR.warning },
    ];
    let circle = null;
    if (show.unitCircle) {
      const pts = [];
      for (let kk = 0; kk <= 48; kk += 1) {
        const th = (2 * Math.PI * kk) / 48;
        const pp = ap(Math.cos(th), Math.sin(th));
        pts.push(`${sx(pp[0]).toFixed(1)},${sy(pp[1]).toFixed(1)}`);
      }
      circle = pts.join(" ");
    }
    const vecs = (vectors || []).map((v) => {
      const pp = ap(v.x, v.y);
      return {
        x: sx(pp[0]),
        y: sy(pp[1]),
        color: COLOR[v.color] || PAL.warning,
        label: v.label,
      };
    });
    const eigen =
      show.eigen && eig.real
        ? eig.vectors.map((ev) => ({
            x1: sx(-ev[0] * R),
            y1: sy(-ev[1] * R),
            x2: sx(ev[0] * R),
            y2: sy(ev[1] * R),
          }))
        : [];
    return { cx, cy, staticLines, lines, basis, circle, vecs, eigen };
  }, [matrix, t, range, show, vectors, eig]);

  return (
    <VizCard
      title={spec.title}
      ariaLabel={`${spec.title || tr("העתקה לינארית", "Linear transformation")} — ${tr("טרנספורמציה של המישור", "2×2 linear transformation")}`}
      saveable={saveable}
      spec={spec}
      footerLeft={
        <span
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <code
            dir="ltr"
            style={{
              fontSize: 11.5,
              color: PAL.textMuted,
              background: PAL.bg,
              borderRadius: 6,
              padding: "2px 7px",
            }}
          >
            M = [[{nr(matrix[0][0])}, {nr(matrix[0][1])}], [{nr(matrix[1][0])},{" "}
            {nr(matrix[1][1])}]]
          </code>
          <span
            style={{
              fontSize: 11.5,
              color: det < 0 ? PAL.warning : PAL.textMuted,
            }}
          >
            det = {nr(det)}
          </span>
        </span>
      }
    >
      <svg
        viewBox={`0 0 ${TR_SZ} ${TR_SZ}`}
        style={{
          display: "block",
          margin: "0 auto",
          width: "100%",
          maxWidth: 380,
          direction: "ltr",
          overflow: "hidden",
        }}
        preserveAspectRatio="xMidYMid meet"
      >
        {geo.staticLines.map((l, i) => (
          <line
            key={`s${i}`}
            x1={l[0].toFixed(1)}
            y1={l[1].toFixed(1)}
            x2={l[2].toFixed(1)}
            y2={l[3].toFixed(1)}
            stroke={PAL.border}
            strokeWidth="1"
            opacity="0.35"
          />
        ))}
        {show.grid &&
          geo.lines.map((l, i) => (
            <line
              key={`t${i}`}
              x1={l.x1.toFixed(1)}
              y1={l.y1.toFixed(1)}
              x2={l.x2.toFixed(1)}
              y2={l.y2.toFixed(1)}
              stroke={l.axis ? PAL.text : PAL.accent}
              strokeWidth={l.axis ? 1.8 : 1.2}
              opacity={l.axis ? 0.9 : 0.55}
            />
          ))}
        {geo.circle && (
          <polyline
            points={geo.circle}
            fill="none"
            stroke={COLOR.evTeal}
            strokeWidth="2"
            opacity="0.9"
          />
        )}
        {geo.eigen.map((e, i) => (
          <line
            key={`ev${i}`}
            x1={e.x1.toFixed(1)}
            y1={e.y1.toFixed(1)}
            x2={e.x2.toFixed(1)}
            y2={e.y2.toFixed(1)}
            stroke={COLOR.evPurple}
            strokeWidth="1.6"
            strokeDasharray="6 4"
            opacity="0.9"
          />
        ))}
        {geo.vecs.map((v, i) => (
          <g key={`v${i}`}>
            <line
              x1={geo.cx}
              y1={geo.cy}
              x2={v.x.toFixed(1)}
              y2={v.y.toFixed(1)}
              stroke={v.color}
              strokeWidth="2.4"
            />
            <circle cx={v.x} cy={v.y} r="3.2" fill={v.color} />
            {v.label && (
              <text
                x={v.x + 6}
                y={v.y - 5}
                fontSize="12"
                fontWeight="700"
                fill={v.color}
              >
                {v.label}
              </text>
            )}
          </g>
        ))}
        {show.basis &&
          geo.basis.map((bvec, i) => (
            <g key={`b${i}`}>
              <line
                x1={geo.cx}
                y1={geo.cy}
                x2={bvec.x.toFixed(1)}
                y2={bvec.y.toFixed(1)}
                stroke={bvec.color}
                strokeWidth="3"
              />
              <circle cx={bvec.x} cy={bvec.y} r="3.6" fill={bvec.color} />
              <text
                x={bvec.x + 7}
                y={bvec.y - 5}
                fontSize="13"
                fontWeight="800"
                fill={bvec.color}
              >
                {bvec.label}
              </text>
            </g>
          ))}
      </svg>
      {spec.animate && !reduceMotion && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 10,
          }}
        >
          <button
            type="button"
            className="tap"
            onClick={() => {
              if (playing) {
                setPlaying(false);
              } else {
                if (t >= 1) setT(0);
                setPlaying(true);
              }
            }}
            aria-label={playing ? tr("השהיה", "Pause") : tr("הפעלה", "Play")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
              border: `1px solid ${playing ? PAL.accent : PAL.borderSoft}`,
              background: playing ? alpha(PAL.accent, 0.16) : "transparent",
              color: playing ? PAL.text : PAL.textMuted,
              borderRadius: 999,
              padding: "5px 13px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 11 }}>
              {playing ? "❚❚" : t >= 1 ? "↻" : "▶"}
            </span>
            {playing
              ? tr("מריץ", "Running")
              : t >= 1
                ? tr("שוב", "Replay")
                : tr("הפעלה", "Play")}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={t}
            onChange={(e) => {
              setPlaying(false);
              setT(Number(e.target.value));
            }}
            style={{ accentColor: PAL.accent, flex: 1, cursor: "pointer" }}
            aria-label={tr("התקדמות", "progress")}
          />
          <span
            style={{
              fontSize: 11.5,
              color: PAL.textFaint,
              minWidth: 62,
              textAlign: "left",
            }}
          >
            {tr("עיוות", "morph")} {Math.round(t * 100)}%
          </span>
        </div>
      )}
    </VizCard>
  );
}

function Geometry2DView({ spec, saveable = false }) {
  const [xMin, xMax] = spec.xRange,
    [yMin, yMax] = spec.yRange;
  // Equal aspect ratio: ONE uniform px-per-unit on both axes, so a circle reads as a
  // circle and a symmetric figure isn't squashed. Fill the width, derive the height from
  // the data aspect, and uniformly shrink + center if that would get too tall. (Before,
  // the fixed non-square box distorted every circle/angle when the ranges were square.)
  const spanX = xMax - xMin,
    spanY = yMax - yMin;
  const availW = G_W - 2 * G_M,
    maxH = 460;
  let PW = availW,
    PH = (availW * spanY) / spanX;
  if (PH > maxH) {
    const k = maxH / PH;
    PH = maxH;
    PW = availW * k;
  }
  const offX = G_M + (availW - PW) / 2;
  const G_BH = PH + 2 * G_M; // adaptive viewBox height
  const X0 = offX,
    X1 = offX + PW,
    Y0 = G_M,
    Y1 = G_M + PH; // plotted data box
  const sx = (x) => offX + ((x - xMin) / spanX) * PW;
  const sy = (y) => G_M + (1 - (y - yMin) / spanY) * PH;
  const scale = PW / spanX; // px per world unit (equal aspect ⇒ identical on both axes)
  const inX = (x) => x >= xMin && x <= xMax,
    inY = (y) => y >= yMin && y <= yMax;

  // Optional TRACER: a parametric item marked trace:true animates a moving dot along its
  // curve, leaving a trail — projectile, orbit, phase-space portrait. A shared phase φ∈[0,1]
  // (rAF) drives every traced item; play/pause + a scrubber; autoplay unless reduced-motion.
  const reduceMotion = useReducedMotion();
  const hasTrace = spec.items.some(
    (it) => it.type === "parametric" && it.trace,
  );
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef(0);
  useEffect(() => {
    if (!hasTrace || !playing) return undefined;
    const period = 4200;
    let startT = null,
      startPhase = 0;
    const tick = (now) => {
      if (startT == null) {
        startT = now;
        startPhase = phase;
      } // resume from current phase
      const p = (startPhase + (now - startT) / period) % 1;
      setPhase(p < 0 ? p + 1 : p);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, hasTrace]); // eslint-disable-line react-hooks/exhaustive-deps

  const gridId = useId(); // unique clip-path id (two geometry2d widgets can coexist)
  const xStep = niceStep(xMax - xMin),
    yStep = niceStep(yMax - yMin);
  const xs = [],
    ys = [];
  for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax + 1e-9; x += xStep)
    xs.push(Number(x.toFixed(6)));
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep)
    ys.push(Number(y.toFixed(6)));

  // Polar grid (grid:"polar"): concentric rings r=const + radial spokes θ=const, centered
  // at the world origin, so a region/curve reads in its polar coordinates. Equal aspect ⇒
  // a world circle of radius r is a true screen circle of radius scale·r.
  const isPolar = spec.grid === "polar";
  let polar = null;
  if (isPolar) {
    const corners = [
      [xMin, yMin],
      [xMin, yMax],
      [xMax, yMin],
      [xMax, yMax],
    ];
    const maxR = Math.max(...corners.map(([px, py]) => Math.hypot(px, py)));
    // Ring spacing: round UP to a nice {1,2,5}·10^k targeting ~5 rings, so rings land on
    // round radii (r=1,2,3…) that coincide with a region's actual r-bounds — not 0.8,1.6.
    const t = (maxR || 1) / 5,
      tp = Math.pow(10, Math.floor(Math.log10(t))),
      tn = t / tp;
    const rStep = (tn <= 1 ? 1 : tn <= 2 ? 2 : tn <= 5 ? 5 : 10) * tp;
    const rings = [];
    for (let r = rStep; r <= maxR + 1e-9; r += rStep)
      rings.push(Number(r.toFixed(6)));
    // radius at which a spoke exits the plotted box (origin assumed in view) — used to
    // place each angle caption just inside the frame instead of guessing a fixed radius.
    const spokeR = (a) => {
      const c = Math.cos(a),
        s = Math.sin(a);
      let r = maxR;
      if (c > 1e-9) r = Math.min(r, xMax / c);
      else if (c < -1e-9) r = Math.min(r, xMin / c);
      if (s > 1e-9) r = Math.min(r, yMax / s);
      else if (s < -1e-9) r = Math.min(r, yMin / s);
      return r;
    };
    const spokes = [];
    for (let deg = 0; deg < 360; deg += 30) spokes.push(deg);
    polar = { maxR, rings, spokes, spokeR };
  }

  const arrow = (x1, y1, x2, y2, color) => {
    const ang = Math.atan2(y2 - y1, x2 - x1),
      s = 8,
      a = ang + Math.PI - 0.42,
      b = ang + Math.PI + 0.42;
    return (
      <path
        d={`M${x2.toFixed(1)} ${y2.toFixed(1)} L${(x2 + s * Math.cos(a)).toFixed(1)} ${(y2 + s * Math.sin(a)).toFixed(1)} L${(x2 + s * Math.cos(b)).toFixed(1)} ${(y2 + s * Math.sin(b)).toFixed(1)} Z`}
        fill={color}
      />
    );
  };

  const ordered = spec.items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => G_Z[a.it.type] - G_Z[b.it.type] || a.i - b.i);

  return (
    <VizCard
      title={spec.title}
      ariaLabel={`${spec.title || tr("תרשים גיאומטרי", "Figure")} — ${tr("מערכת צירים", "coordinate figure")}`}
      saveable={saveable}
      spec={spec}
    >
      <svg
        viewBox={`0 0 ${G_W} ${G_BH}`}
        width="100%"
        style={{ display: "block", direction: "ltr", overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {spec.grid &&
          !isPolar &&
          xs.map((x, i) => (
            <line
              key={`gx${i}`}
              x1={sx(x)}
              y1={Y0}
              x2={sx(x)}
              y2={Y1}
              stroke={PAL.textFaint}
              strokeWidth="1"
              opacity="0.22"
            />
          ))}
        {spec.grid &&
          !isPolar &&
          ys.map((y, i) => (
            <line
              key={`gy${i}`}
              x1={X0}
              y1={sy(y)}
              x2={X1}
              y2={sy(y)}
              stroke={PAL.textFaint}
              strokeWidth="1"
              opacity="0.22"
            />
          ))}
        {isPolar && (
          <g>
            <clipPath id={`${gridId}-box`}>
              <rect x={X0} y={Y0} width={X1 - X0} height={Y1 - Y0} />
            </clipPath>
            <g clipPath={`url(#${gridId}-box)`}>
              {polar.rings.map((r, i) => (
                <circle
                  key={`prr${i}`}
                  cx={sx(0)}
                  cy={sy(0)}
                  r={scale * r}
                  fill="none"
                  stroke={PAL.textFaint}
                  strokeWidth="1.1"
                  strokeDasharray="3 3.5"
                  opacity="0.45"
                />
              ))}
              {polar.spokes.map((deg, i) => {
                const a = (deg * Math.PI) / 180;
                return (
                  <line
                    key={`prs${i}`}
                    x1={sx(0)}
                    y1={sy(0)}
                    x2={sx(polar.maxR * Math.cos(a))}
                    y2={sy(polar.maxR * Math.sin(a))}
                    stroke={PAL.textFaint}
                    strokeWidth="1"
                    strokeDasharray="3 3.5"
                    opacity="0.3"
                  />
                );
              })}
            </g>
            {polar.spokes.map((deg, i) => {
              const a = (deg * Math.PI) / 180,
                lr = polar.spokeR(a) * 0.86;
              if (!(lr * scale > 90)) return null;
              const lx = lr * Math.cos(a),
                ly = lr * Math.sin(a);
              return (
                <text
                  key={`pra${i}`}
                  x={sx(lx)}
                  y={sy(ly) + 3}
                  textAnchor="middle"
                  fontSize="8.5"
                  fill={PAL.textFaint}
                  opacity="0.85"
                >
                  {POLAR_ANGLE_LABEL[deg]}
                </text>
              );
            })}
            {inX(0) &&
              inY(0) &&
              (() => {
                // a small θ indicator at the pole: arc from the +x axis to the 30° spoke + a "θ"
                const ox = sx(0),
                  oy = sy(0),
                  rr = 24,
                  aE = Math.PI / 6;
                return (
                  <g key="pth">
                    <path
                      d={`M${(ox + rr).toFixed(1)} ${oy.toFixed(1)} A${rr} ${rr} 0 0 0 ${(ox + rr * Math.cos(aE)).toFixed(1)} ${(oy - rr * Math.sin(aE)).toFixed(1)}`}
                      fill="none"
                      stroke={PAL.textMuted}
                      strokeWidth="1.3"
                    />
                    <text
                      x={ox + (rr + 11) * Math.cos(aE / 2)}
                      y={oy - (rr + 11) * Math.sin(aE / 2) + 4}
                      textAnchor="middle"
                      fontSize="11.5"
                      fill={PAL.textMuted}
                    >
                      θ
                    </text>
                  </g>
                );
              })()}
          </g>
        )}
        {spec.axes && inY(0) && (
          <line
            x1={X0}
            y1={sy(0)}
            x2={X1}
            y2={sy(0)}
            stroke={PAL.textMuted}
            strokeWidth="1.4"
            opacity="0.75"
          />
        )}
        {spec.axes && inX(0) && (
          <line
            x1={sx(0)}
            y1={Y0}
            x2={sx(0)}
            y2={Y1}
            stroke={PAL.textMuted}
            strokeWidth="1.4"
            opacity="0.75"
          />
        )}
        {spec.axes &&
          !isPolar &&
          inY(0) &&
          arrow(X1 - 11, sy(0), X1, sy(0), PAL.textMuted)}
        {spec.axes &&
          !isPolar &&
          inX(0) &&
          arrow(sx(0), Y0 + 11, sx(0), Y0, PAL.textMuted)}
        {spec.axes && !isPolar && spec.xLabel && inY(0) && (
          <text
            x={X1}
            y={sy(0) + 27}
            textAnchor="end"
            fontSize="12.5"
            fill={PAL.textMuted}
          >
            {isoCoord(spec.xLabel)}
          </text>
        )}
        {spec.axes && !isPolar && spec.yLabel && inX(0) && (
          <text
            x={sx(0) + 8}
            y={Y0 - 10}
            textAnchor="start"
            fontSize="12.5"
            fill={PAL.textMuted}
          >
            {isoCoord(spec.yLabel)}
          </text>
        )}
        {spec.axes &&
          inY(0) &&
          xs
            .filter((x) => Math.abs(x) > 1e-9)
            .map((x, i) => (
              <text
                key={`tx${i}`}
                x={sx(x)}
                y={sy(0) + 13}
                textAnchor="middle"
                fontSize="9.5"
                fill={PAL.textFaint}
              >
                {fmt(x)}
              </text>
            ))}
        {spec.axes &&
          inX(0) &&
          ys
            .filter((y) => Math.abs(y) > 1e-9)
            .map((y, i) => (
              <text
                key={`ty${i}`}
                x={sx(0) - 6}
                y={sy(y) + 3.5}
                textAnchor="end"
                fontSize="9.5"
                fill={PAL.textFaint}
              >
                {fmt(y)}
              </text>
            ))}

        {ordered.map(({ it, i }) => {
          const c = COLOR[it.color] || PAL.accent;
          if (it.type === "function") {
            let d = "",
              pen = false;
            sampleCurve(it._ast, "x", xMin, xMax, {}, 160).forEach((p) => {
              if (p.y == null || p.y < yMin || p.y > yMax) {
                pen = false;
                return;
              }
              d += `${pen ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)} `;
              pen = true;
            });
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={c}
                strokeWidth="2.2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          }
          if (it.type === "polygon") {
            const d =
              it.points
                .map(
                  (p, j) =>
                    `${j ? "L" : "M"}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)} `,
                )
                .join("") + "Z";
            const cx =
              it.points.reduce((a, p) => a + sx(p[0]), 0) / it.points.length;
            const cy =
              it.points.reduce((a, p) => a + sy(p[1]), 0) / it.points.length;
            return (
              <g key={i}>
                <path
                  d={d}
                  fill={c}
                  fillOpacity={it.fill ? 0.2 : 0}
                  stroke={c}
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                {it.label && (
                  <text
                    x={cx}
                    y={cy + 4}
                    textAnchor="middle"
                    fontSize="11.5"
                    fontWeight="600"
                    fill={PAL.text}
                  >
                    {isoCoord(it.label)}
                  </text>
                )}
              </g>
            );
          }
          if (it.type === "sector") {
            // Arc-bounded polar region. FULL ring/disk (span ≈ 2π) → concentric circle(s) with an
            // even-odd hole; otherwise a wedge: outer arc r2 (θ1→θ2) then inner arc r1 back (annular)
            // or straight to the center (disk sector). Equal aspect ⇒ screen arc radius = scale·r.
            let a1 = it.theta1,
              a2 = it.theta2;
            if (a2 < a1) {
              const t = a1;
              a1 = a2;
              a2 = t;
            }
            const span = a2 - a1,
              full = span >= 2 * Math.PI - 1e-4;
            const R2 = scale * it.r2,
              R1 = scale * it.r1,
              CX = sx(it.cx),
              CY = sy(it.cy);
            const P = (r, th) =>
              `${sx(it.cx + r * Math.cos(th)).toFixed(1)} ${sy(it.cy + r * Math.sin(th)).toFixed(1)}`;
            const ring = (R) =>
              `M${(CX + R).toFixed(1)} ${CY.toFixed(1)} A${R.toFixed(1)} ${R.toFixed(1)} 0 1 1 ${(CX - R).toFixed(1)} ${CY.toFixed(1)} A${R.toFixed(1)} ${R.toFixed(1)} 0 1 1 ${(CX + R).toFixed(1)} ${CY.toFixed(1)} Z`;
            const large = span > Math.PI ? 1 : 0;
            const d = full
              ? it.r1 > 1e-6
                ? `${ring(R2)} ${ring(R1)}`
                : ring(R2)
              : it.r1 > 1e-6
                ? `M${P(it.r2, a1)} A${R2.toFixed(1)} ${R2.toFixed(1)} 0 ${large} 0 ${P(it.r2, a2)} L${P(it.r1, a2)} A${R1.toFixed(1)} ${R1.toFixed(1)} 0 ${large} 1 ${P(it.r1, a1)} Z`
                : `M${CX.toFixed(1)} ${CY.toFixed(1)} L${P(it.r2, a1)} A${R2.toFixed(1)} ${R2.toFixed(1)} 0 ${large} 0 ${P(it.r2, a2)} Z`;
            const rm = (it.r1 + it.r2) / 2,
              am = full ? Math.PI / 2 : (a1 + a2) / 2;
            const lx = sx(it.cx + rm * Math.cos(am)),
              ly = sy(it.cy + rm * Math.sin(am));
            return (
              <g key={i}>
                <path
                  data-geometry="sector"
                  data-cx={CX}
                  data-cy={CY}
                  data-scale={scale}
                  d={d}
                  fillRule="evenodd"
                  fill={c}
                  fillOpacity={it.fill ? 0.22 : 0}
                  stroke={c}
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {it.label && (
                  <text
                    x={lx}
                    y={ly + 4}
                    textAnchor="middle"
                    fontSize="11.5"
                    fontWeight="600"
                    fill={PAL.text}
                  >
                    {isoCoord(it.label)}
                  </text>
                )}
              </g>
            );
          }
          if (it.type === "circle") {
            return (
              <g key={i}>
                <ellipse
                  cx={sx(it.cx)}
                  cy={sy(it.cy)}
                  rx={Math.abs(sx(it.cx + it.r) - sx(it.cx))}
                  ry={Math.abs(sy(it.cy + it.r) - sy(it.cy))}
                  fill={c}
                  fillOpacity={it.fill ? 0.2 : 0}
                  stroke={c}
                  strokeWidth="1.8"
                />
                {it.label && (
                  <text
                    x={sx(it.cx)}
                    y={sy(it.cy) - 4}
                    textAnchor="middle"
                    fontSize="11.5"
                    fill={PAL.text}
                  >
                    {isoCoord(it.label)}
                  </text>
                )}
              </g>
            );
          }
          if (it.type === "ellipse") {
            return (
              <g key={i}>
                <ellipse
                  cx={sx(it.cx)}
                  cy={sy(it.cy)}
                  rx={Math.abs(sx(it.cx + it.rx) - sx(it.cx))}
                  ry={Math.abs(sy(it.cy + it.ry) - sy(it.cy))}
                  fill={c}
                  fillOpacity={it.fill ? 0.2 : 0}
                  stroke={c}
                  strokeWidth="1.8"
                />
                {it.label && (
                  <text
                    x={sx(it.cx)}
                    y={sy(it.cy) - 4}
                    textAnchor="middle"
                    fontSize="11.5"
                    fill={PAL.text}
                  >
                    {isoCoord(it.label)}
                  </text>
                )}
              </g>
            );
          }
          if (it.type === "parametric") {
            const [t0, t1] = it.t,
              N = 240;
            const at = (t) => {
              const px = evalExpr(it._xAst, { t }),
                py = evalExpr(it._yAst, { t });
              return Number.isFinite(px) &&
                Number.isFinite(py) &&
                px >= xMin &&
                px <= xMax &&
                py >= yMin &&
                py <= yMax
                ? [sx(px), sy(py)]
                : null;
            };
            const build = (kTo) => {
              let d = "",
                pen = false;
              for (let k = 0; k <= kTo; k += 1) {
                const P = at(t0 + (t1 - t0) * (k / N));
                if (!P) {
                  pen = false;
                  continue;
                }
                d += `${pen ? "L" : "M"}${P[0].toFixed(1)} ${P[1].toFixed(1)} `;
                pen = true;
              }
              return d;
            };
            if (!it.trace)
              return (
                <path
                  key={i}
                  d={build(N)}
                  fill="none"
                  stroke={c}
                  strokeWidth="2.2"
                  strokeDasharray={it.dashed ? "5 4" : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            // traced: faint full curve (ghost) + solid trail up to φ + the moving point
            const dot = at(t0 + (t1 - t0) * phase);
            return (
              <g key={i}>
                <path
                  d={build(N)}
                  fill="none"
                  stroke={c}
                  strokeOpacity="0.22"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <path
                  d={build(Math.round(N * phase))}
                  fill="none"
                  stroke={c}
                  strokeWidth="2.6"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {dot && (
                  <circle
                    cx={dot[0]}
                    cy={dot[1]}
                    r="5"
                    fill={c}
                    stroke={PAL.navyBubbleAI || PAL.surface}
                    strokeWidth="1.5"
                  />
                )}
                {it.label && dot && (
                  <text
                    x={Math.min(
                      X1 - it.label.length * 6.8,
                      Math.max(X0, dot[0] + 9),
                    )}
                    y={Math.max(Y0 + 14, dot[1] - 25)}
                    fontSize="11.5"
                    fontWeight="700"
                    fill={c}
                  >
                    {isoCoord(it.label)}
                  </text>
                )}
              </g>
            );
          }
          if (
            it.type === "vector" ||
            it.type === "segment" ||
            it.type === "line"
          ) {
            const x1 = sx(it.x1),
              y1 = sy(it.y1),
              x2 = sx(it.x2),
              y2 = sy(it.y2);
            return (
              <g key={i}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={c}
                  strokeWidth="2"
                  strokeDasharray={it.dashed ? "5 4" : undefined}
                  strokeLinecap="round"
                />
                {it.type === "vector" && arrow(x1, y1, x2, y2, c)}
                {it.label && (
                  <text
                    x={(x1 + x2) / 2 + 6}
                    y={(y1 + y2) / 2 - 5}
                    fontSize="11.5"
                    fontWeight="700"
                    fill={c}
                  >
                    {isoCoord(it.label)}
                  </text>
                )}
              </g>
            );
          }
          if (it.type === "point") {
            return (
              <g key={i}>
                <circle
                  cx={sx(it.x)}
                  cy={sy(it.y)}
                  r="4.2"
                  fill={c}
                  stroke={PAL.navyBubbleAI || PAL.surface}
                  strokeWidth="1"
                />
                {it.label && (
                  <text
                    x={Math.min(
                      X1 - it.label.length * 6.8,
                      Math.max(X0, sx(it.x) + 7),
                    )}
                    y={Math.max(Y0 + 14, sy(it.y) - 6)}
                    fontSize="11.5"
                    fontWeight="600"
                    fill={PAL.text}
                  >
                    {isoCoord(it.label)}
                  </text>
                )}
              </g>
            );
          }
          if (it.type === "label") {
            return (
              <text
                key={i}
                x={sx(it.x)}
                y={sy(it.y)}
                textAnchor="middle"
                fontSize="12"
                fontWeight="600"
                fill={c}
              >
                {isoCoord(it.text)}
              </text>
            );
          }
          if (it.type === "incline") {
            const { A, B, C } = inclineVertices(
              it.x,
              it.y,
              it.run,
              it.angle,
              it.face,
            );
            const Ap = [sx(A[0]), sy(A[1])],
              Bp = [sx(B[0]), sy(B[1])],
              Cp = [sx(C[0]), sy(C[1])];
            const lx = Math.min(Ap[0], Bp[0]),
              rx = Math.max(Ap[0], Bp[0]); // base, left→right (hatch downward)
            const ang1 = Math.atan2(Bp[1] - Ap[1], Bp[0] - Ap[0]);
            const rawAngle = Math.atan2(Cp[1] - Ap[1], Cp[0] - Ap[0]);
            const ang2 =
              ang1 +
              Math.atan2(Math.sin(rawAngle - ang1), Math.cos(rawAngle - ang1));
            const ar = Math.max(0, Math.min(30, scale * it.run * 0.4)),
              mid = (ang1 + ang2) / 2;
            let blk = null;
            if (it.block) {
              const bp = inclineBlock(
                it.x,
                it.y,
                it.run,
                it.angle,
                it.face,
                it.block.at,
                it.block.size,
              ).map((p) => [sx(p[0]), sy(p[1])]);
              const bd =
                bp
                  .map(
                    (p, j) =>
                      `${j ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`,
                  )
                  .join(" ") + " Z";
              const bcol = COLOR[it.block.color] || PAL.accent,
                bx = bp.reduce((a, p) => a + p[0], 0) / 4,
                by = bp.reduce((a, p) => a + p[1], 0) / 4;
              blk = (
                <g>
                  <path
                    d={bd}
                    fill={bcol}
                    fillOpacity="0.28"
                    stroke={bcol}
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  {it.block.label && (
                    <text
                      x={bx}
                      y={by + 4}
                      textAnchor="middle"
                      fontSize="11.5"
                      fontWeight="700"
                      fill={PAL.text}
                    >
                      {it.block.label}
                    </text>
                  )}
                </g>
              );
            }
            return (
              <g key={i}>
                <path
                  d={`M${Ap[0]} ${Ap[1]} L${Bp[0]} ${Bp[1]} L${Cp[0]} ${Cp[1]} Z`}
                  fill={c}
                  fillOpacity="0.1"
                  stroke={c}
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path
                  d={hatchTicks(lx, Ap[1], rx, Ap[1], false)}
                  stroke={c}
                  strokeWidth="1.2"
                  opacity="0.65"
                />
                {ar > 7 && (
                  <path
                    data-geometry="incline-angle"
                    data-radius={ar}
                    d={arcPolyline(Ap[0], Ap[1], ar, ang1, ang2)}
                    fill="none"
                    stroke={COLOR.warning}
                    strokeWidth="1.6"
                  />
                )}
                {it.angleLabel && ar > 7 && (
                  <text
                    x={Ap[0] + (ar + 10) * Math.cos(mid)}
                    y={Ap[1] + (ar + 10) * Math.sin(mid) + 3}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill={COLOR.warning}
                  >
                    {it.angleLabel}
                  </text>
                )}
                {blk}
                {it.label && (
                  <text
                    x={(Ap[0] + Bp[0] + Cp[0]) / 3}
                    y={(Ap[1] + Bp[1] + Cp[1]) / 3 + 4}
                    textAnchor="middle"
                    fontSize="11.5"
                    fontWeight="600"
                    fill={PAL.text}
                  >
                    {it.label}
                  </text>
                )}
              </g>
            );
          }
          if (it.type === "ground") {
            const gy = sy(it.y),
              g1 = sx(it.x1 != null ? it.x1 : xMin),
              g2 = sx(it.x2 != null ? it.x2 : xMax);
            return (
              <g key={i}>
                <line
                  x1={g1}
                  y1={gy}
                  x2={g2}
                  y2={gy}
                  stroke={c}
                  strokeWidth="2"
                />
                <path
                  d={hatchTicks(g1, gy, g2, gy, false)}
                  stroke={c}
                  strokeWidth="1.2"
                  opacity="0.65"
                />
                {it.label && (
                  <text
                    x={(g1 + g2) / 2}
                    y={gy + 20}
                    textAnchor="middle"
                    fontSize="11"
                    fill={PAL.textMuted}
                  >
                    {isoCoord(it.label)}
                  </text>
                )}
              </g>
            );
          }
          if (it.type === "wall") {
            const wx = sx(it.x),
              w1 = sy(it.y),
              w2 = sy(it.y + it.h);
            return (
              <g key={i}>
                <line
                  x1={wx}
                  y1={w1}
                  x2={wx}
                  y2={w2}
                  stroke={c}
                  strokeWidth="2"
                />
                <path
                  d={hatchTicks(
                    wx,
                    Math.max(w1, w2),
                    wx,
                    Math.min(w1, w2),
                    it.face === "left",
                  )}
                  stroke={c}
                  strokeWidth="1.2"
                  opacity="0.65"
                />
                {it.label && (
                  <text
                    x={wx + (it.face === "left" ? -8 : 8)}
                    y={(w1 + w2) / 2}
                    textAnchor={it.face === "left" ? "end" : "start"}
                    fontSize="11"
                    fill={PAL.textMuted}
                  >
                    {isoCoord(it.label)}
                  </text>
                )}
              </g>
            );
          }
          if (it.type === "spring") {
            const mx = (sx(it.x1) + sx(it.x2)) / 2,
              my = (sy(it.y1) + sy(it.y2)) / 2;
            return (
              <g key={i}>
                <path
                  d={springPath(
                    sx(it.x1),
                    sy(it.y1),
                    sx(it.x2),
                    sy(it.y2),
                    it.coils,
                  )}
                  fill="none"
                  stroke={c}
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {it.label && (
                  <text
                    x={mx}
                    y={my - 9}
                    textAnchor="middle"
                    fontSize="11.5"
                    fontWeight="700"
                    fill={c}
                  >
                    {isoCoord(it.label)}
                  </text>
                )}
              </g>
            );
          }
          if (it.type === "support") {
            const px = sx(it.x),
              py = sy(it.y),
              s = 11,
              bh = py + s * 1.4,
              roller = it.kind === "roller";
            if (it.kind === "fixed") {
              return (
                <g key={i}>
                  <line
                    x1={px - 16}
                    y1={py}
                    x2={px + 16}
                    y2={py}
                    stroke={c}
                    strokeWidth="1.8"
                  />
                  <path
                    d={hatchTicks(px - 16, py, px + 16, py, false)}
                    stroke={c}
                    strokeWidth="1.1"
                    opacity="0.7"
                  />
                  {it.label && (
                    <text
                      x={px}
                      y={py + 20}
                      textAnchor="middle"
                      fontSize="10.5"
                      fill={PAL.textMuted}
                    >
                      {isoCoord(it.label)}
                    </text>
                  )}
                </g>
              );
            }
            const groundY = roller ? bh + 8 : bh;
            return (
              <g key={i}>
                <path
                  d={`M${px} ${py} L${px - s} ${bh} L${px + s} ${bh} Z`}
                  fill={c}
                  fillOpacity="0.14"
                  stroke={c}
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                {roller && (
                  <>
                    <circle
                      cx={px - s / 2}
                      cy={bh + 4}
                      r="3.4"
                      fill="none"
                      stroke={c}
                      strokeWidth="1.4"
                    />
                    <circle
                      cx={px + s / 2}
                      cy={bh + 4}
                      r="3.4"
                      fill="none"
                      stroke={c}
                      strokeWidth="1.4"
                    />
                  </>
                )}
                <line
                  x1={px - s - 3}
                  y1={groundY}
                  x2={px + s + 3}
                  y2={groundY}
                  stroke={c}
                  strokeWidth="1.6"
                />
                <path
                  d={hatchTicks(
                    px - s - 3,
                    groundY,
                    px + s + 3,
                    groundY,
                    false,
                  )}
                  stroke={c}
                  strokeWidth="1"
                  opacity="0.65"
                />
                {it.label && (
                  <text
                    x={px}
                    y={groundY + 16}
                    textAnchor="middle"
                    fontSize="10.5"
                    fill={PAL.textMuted}
                  >
                    {isoCoord(it.label)}
                  </text>
                )}
              </g>
            );
          }
          if (it.type === "dimension") {
            const dxu = it.x2 - it.x1,
              dyu = it.y2 - it.y1,
              Lu = Math.hypot(dxu, dyu) || 1,
              nx = -dyu / Lu,
              ny = dxu / Lu;
            const ox = nx * it.offset,
              oy = ny * it.offset;
            const p1 = [sx(it.x1 + ox), sy(it.y1 + oy)],
              p2 = [sx(it.x2 + ox), sy(it.y2 + oy)];
            return (
              <g key={i}>
                <line
                  x1={sx(it.x1)}
                  y1={sy(it.y1)}
                  x2={p1[0]}
                  y2={p1[1]}
                  stroke={c}
                  strokeWidth="1"
                  opacity="0.55"
                />
                <line
                  x1={sx(it.x2)}
                  y1={sy(it.y2)}
                  x2={p2[0]}
                  y2={p2[1]}
                  stroke={c}
                  strokeWidth="1"
                  opacity="0.55"
                />
                <line
                  x1={p1[0]}
                  y1={p1[1]}
                  x2={p2[0]}
                  y2={p2[1]}
                  stroke={c}
                  strokeWidth="1.4"
                />
                {arrow(p2[0], p2[1], p1[0], p1[1], c)}
                {arrow(p1[0], p1[1], p2[0], p2[1], c)}
                {it.label && (
                  <text
                    x={(p1[0] + p2[0]) / 2}
                    y={(p1[1] + p2[1]) / 2 - 5}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="600"
                    fill={PAL.textMuted}
                  >
                    {isoCoord(it.label)}
                  </text>
                )}
              </g>
            );
          }
          if (it.type === "angle") {
            const px = sx(it.x),
              py = sy(it.y),
              ar = it.r != null ? scale * it.r : 26;
            const a1 = (-it.start * Math.PI) / 180,
              a2 = (-it.end * Math.PI) / 180,
              midA = (a1 + a2) / 2;
            return (
              <g key={i}>
                <path
                  d={arcPolyline(px, py, ar, a1, a2)}
                  fill="none"
                  stroke={c}
                  strokeWidth="1.7"
                />
                {it.label && (
                  <text
                    x={px + (ar + 11) * Math.cos(midA)}
                    y={py + (ar + 11) * Math.sin(midA) + 3}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill={c}
                  >
                    {isoCoord(it.label)}
                  </text>
                )}
              </g>
            );
          }
          return null;
        })}
      </svg>
      {hasTrace && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 10,
          }}
        >
          <button
            type="button"
            className="tap"
            onClick={() => setPlaying((r) => !r)}
            aria-pressed={playing}
            aria-label={playing ? tr("השהיה", "Pause") : tr("הפעלה", "Play")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
              border: `1px solid ${playing ? PAL.accent : PAL.borderSoft}`,
              background: playing ? alpha(PAL.accent, 0.16) : "transparent",
              color: playing ? PAL.text : PAL.textMuted,
              borderRadius: 999,
              padding: "5px 13px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 11 }}>
              {playing ? "❚❚" : "▶"}
            </span>
            {playing ? tr("מנגן", "Playing") : tr("הפעלה", "Play")}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={phase}
            onChange={(e) => {
              setPlaying(false);
              setPhase(Number(e.target.value));
            }}
            style={{ accentColor: PAL.accent, flex: 1, cursor: "pointer" }}
            aria-label={tr("סרגל זמן", "timeline")}
          />
        </div>
      )}
    </VizCard>
  );
}

// numberline — a 1D axis with filled/hollow points and shaded open/closed intervals
// (inequalities, interval notation, sign charts).
const NL_W = 560,
  NL_PADX = 30,
  NL_Y = 60,
  NL_H = 120;
function NumberlineView({ spec, saveable = false }) {
  const { min, max } = spec;
  const sx = (x) => NL_PADX + ((x - min) / (max - min)) * (NL_W - 2 * NL_PADX);
  const step = niceStep(max - min),
    ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step)
    ticks.push(Number(t.toFixed(6)));
  const surf = PAL.navyBubbleAI || PAL.surface;
  return (
    <VizCard
      title={spec.title}
      ariaLabel={`${spec.title || tr("ציר מספרים", "Number line")} — ${tr("ציר מספרים", "number line")}`}
      saveable={saveable}
      spec={spec}
    >
      <svg
        viewBox={`0 0 ${NL_W} ${NL_H}`}
        width="100%"
        style={{ display: "block", direction: "ltr", overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="nl-a"
            markerWidth="9"
            markerHeight="9"
            refX="6"
            refY="4"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L8,4 L0,8 z" fill={PAL.textMuted} />
          </marker>
        </defs>
        <line
          x1={NL_PADX - 12}
          y1={NL_Y}
          x2={NL_W - NL_PADX + 12}
          y2={NL_Y}
          stroke={PAL.textMuted}
          strokeWidth="1.6"
          markerStart="url(#nl-a)"
          markerEnd="url(#nl-a)"
        />
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={sx(t)}
              y1={NL_Y - 4}
              x2={sx(t)}
              y2={NL_Y + 4}
              stroke={PAL.textMuted}
              strokeWidth="1.4"
            />
            <text
              x={sx(t)}
              y={NL_Y + 20}
              textAnchor="middle"
              fontSize="10.5"
              fill={PAL.textFaint}
            >
              {fmt(t)}
            </text>
          </g>
        ))}
        {spec.intervals.map((iv, i) => {
          const c = COLOR[iv.color] || PAL.success;
          return (
            <g key={`iv${i}`}>
              <line
                x1={sx(iv.from)}
                y1={NL_Y}
                x2={sx(iv.to)}
                y2={NL_Y}
                stroke={c}
                strokeWidth="4.5"
                opacity="0.85"
                strokeLinecap="round"
              />
              <circle
                cx={sx(iv.from)}
                cy={NL_Y}
                r="5.5"
                fill={iv.openFrom ? surf : c}
                stroke={c}
                strokeWidth="2.2"
              />
              <circle
                cx={sx(iv.to)}
                cy={NL_Y}
                r="5.5"
                fill={iv.openTo ? surf : c}
                stroke={c}
                strokeWidth="2.2"
              />
              {iv.label && (
                <text
                  x={(sx(iv.from) + sx(iv.to)) / 2}
                  y={NL_Y - 13}
                  textAnchor="middle"
                  fontSize="11.5"
                  fontWeight="700"
                  fill={c}
                >
                  {iv.label}
                </text>
              )}
            </g>
          );
        })}
        {spec.points.map((p, i) => {
          const c = COLOR[p.color] || PAL.accent;
          return (
            <g key={`pt${i}`}>
              <circle
                cx={sx(p.x)}
                cy={NL_Y}
                r="5.5"
                fill={p.open ? surf : c}
                stroke={c}
                strokeWidth="2.4"
              />
              {p.label && (
                <text
                  x={sx(p.x)}
                  y={NL_Y - 13}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="700"
                  fill={PAL.text}
                >
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </VizCard>
  );
}

// timeline — ordered events along a horizontal axis (sequence, history, scheduling).
const TL_W = 560,
  TL_PADX = 44,
  TL_Y = 82,
  TL_H = 168;
function TimelineView({ spec, saveable = false }) {
  const ev = spec.events,
    n = ev.length;
  const ex = (i) =>
    n === 1 ? TL_W / 2 : TL_PADX + (i / (n - 1)) * (TL_W - 2 * TL_PADX);
  return (
    <VizCard
      title={spec.title}
      ariaLabel={`${spec.title || tr("ציר זמן", "Timeline")} — ${tr("ציר זמן", "timeline")}`}
      saveable={saveable}
      spec={spec}
    >
      <svg
        viewBox={`0 0 ${TL_W} ${TL_H}`}
        width="100%"
        style={{ display: "block", direction: "ltr", overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <line
          x1={TL_PADX - 14}
          y1={TL_Y}
          x2={TL_W - TL_PADX + 14}
          y2={TL_Y}
          stroke={PAL.border}
          strokeWidth="2"
          strokeLinecap="round"
        />
        {ev.map((e, i) => {
          const c = COLOR[e.color] || PAL.accent,
            x = ex(i),
            up = i % 2 === 0;
          return (
            <g key={i}>
              <line
                x1={x}
                y1={TL_Y}
                x2={x}
                y2={up ? TL_Y - 14 : TL_Y + 14}
                stroke={c}
                strokeWidth="1.5"
                opacity="0.6"
              />
              <circle
                cx={x}
                cy={TL_Y}
                r="6"
                fill={c}
                stroke={PAL.navyBubbleAI || PAL.surface}
                strokeWidth="2"
              />
              <text
                x={x}
                y={up ? TL_Y - 22 : TL_Y + 32}
                textAnchor="middle"
                fontSize="11.5"
                fontWeight="700"
                fill={PAL.text}
              >
                {e.label}
              </text>
              {e.at && (
                <text
                  x={x}
                  y={up ? TL_Y - 36 : TL_Y + 46}
                  textAnchor="middle"
                  fontSize="10"
                  fill={PAL.textFaint}
                >
                  {e.at}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </VizCard>
  );
}

// venn — 2 or 3 labelled overlapping sets, with optional region labels keyed by which
// sets they lie in. Circles + region-label centroids are computed here.
const VN_W = 560,
  VN_H = 320;
function VennView({ spec, saveable = false }) {
  const sets = spec.sets,
    three = sets.length >= 3;
  const cy = VN_H * 0.46;
  let circles, regionPos, setLabelPos;
  if (!three) {
    const r = 96,
      cxA = VN_W * 0.4,
      cxB = VN_W * 0.6;
    circles = [
      { cx: cxA, cy, r },
      { cx: cxB, cy, r },
    ];
    regionPos = {
      A: [cxA - r * 0.5, cy],
      B: [cxB + r * 0.5, cy],
      AB: [(cxA + cxB) / 2, cy],
    };
    setLabelPos = [
      [cxA - r * 0.75, cy - r * 0.75],
      [cxB + r * 0.75, cy - r * 0.75],
    ];
  } else {
    const r = 82,
      cx = VN_W / 2,
      d = 56;
    const C = [
      [cx, cy - d],
      [cx - d * 0.92, cy + d * 0.55],
      [cx + d * 0.92, cy + d * 0.55],
    ];
    circles = C.map(([x, y]) => ({ cx: x, cy: y, r }));
    // a pairwise lens (A∩B etc.) sits between two circles, pushed AWAY from the third
    // so the three pairwise labels + the centre (ABC) don't collide.
    const lens = (a, b, third, k) => {
      const mx = (C[a][0] + C[b][0]) / 2,
        my = (C[a][1] + C[b][1]) / 2;
      const dx = mx - C[third][0],
        dy = my - C[third][1],
        len = Math.hypot(dx, dy) || 1;
      return [mx + (dx / len) * k, my + (dy / len) * k];
    };
    regionPos = {
      A: [C[0][0], C[0][1] - r * 0.52],
      B: [C[1][0] - r * 0.5, C[1][1] + r * 0.42],
      C: [C[2][0] + r * 0.5, C[2][1] + r * 0.42],
      AB: lens(0, 1, 2, r * 0.5),
      AC: lens(0, 2, 1, r * 0.5),
      BC: lens(1, 2, 0, r * 0.5),
      ABC: [cx, cy + 10],
    };
    setLabelPos = [
      [C[0][0], C[0][1] - r - 6],
      [C[1][0] - r * 0.8, C[1][1] + r * 0.8],
      [C[2][0] + r * 0.8, C[2][1] + r * 0.8],
    ];
  }
  return (
    <VizCard
      title={spec.title}
      ariaLabel={`${spec.title || tr("דיאגרמת ון", "Venn diagram")} — ${tr("דיאגרמת ון", "Venn diagram")}`}
      saveable={saveable}
      spec={spec}
      footerLeft={sets.map((s, i) => (
        <span
          key={i}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11.5,
            color: PAL.textMuted,
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 3,
              background: COLOR[s.color] || PAL.accent,
            }}
          />{" "}
          {s.label}
        </span>
      ))}
    >
      <svg
        viewBox={`0 0 ${VN_W} ${VN_H}`}
        width="100%"
        style={{ display: "block", direction: "ltr", overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {circles.map((c, i) => {
          const col = COLOR[sets[i].color] || PAL.accent;
          return (
            <circle
              key={i}
              cx={c.cx}
              cy={c.cy}
              r={c.r}
              fill={col}
              fillOpacity="0.14"
              stroke={col}
              strokeWidth="1.8"
            />
          );
        })}
        {sets.map((s, i) => (
          <text
            key={`sl${i}`}
            x={setLabelPos[i][0]}
            y={setLabelPos[i][1]}
            textAnchor="middle"
            fontSize="14"
            fontWeight="800"
            fill={COLOR[s.color] || PAL.accent}
          >
            {s.label}
          </text>
        ))}
        {spec.regions.map((rg, i) => {
          const pos = regionPos[rg.cells];
          return pos ? (
            <text
              key={`rg${i}`}
              x={pos[0]}
              y={pos[1] + 4}
              textAnchor="middle"
              fontSize="11.5"
              fontWeight="600"
              fill={PAL.text}
            >
              {rg.label}
            </text>
          ) : null;
        })}
      </svg>
    </VizCard>
  );
}

// logic-circuit — a digital-logic schematic the student toggles LIVE. The model gives
// boolean inputs + a DAG of gates + outputs (viz-spec.js validates & evaluates); the
// RENDERER owns all geometry (a cycle-safe leveled layout → the model never places a
// coordinate), draws standard IEEE gate glyphs, colors each wire by its live bit, and
// derives the full truth table. Pure SVG + tokens, RTL-aware. evalLogic is the trusted,
// no-eval evaluator — clicking never runs model code, only flips input bits.
const GATE_R = 18,
  BUBBLE_R = 3.6,
  INPUT_HR = 14;
const OR_FAMILY = new Set(["or", "nor", "xor", "xnor"]);
const INVERTED_GATES = new Set(["nand", "nor", "xnor", "not"]);
const GATE_NAME = {
  and: "AND",
  or: "OR",
  not: "NOT",
  nand: "NAND",
  nor: "NOR",
  xor: "XOR",
  xnor: "XNOR",
  buffer: "BUF",
};

// Standard distinctive gate outline centered at (cx,cy): AND = flat back + semicircle;
// OR/XOR = curved back to a point (XOR gets a second back arc); NOT/BUFFER = triangle.
// Inverting types get an output bubble. Returns the body path + where the output wire
// leaves (past the bubble, if any).
function gateGeom(type, cx, cy, R) {
  let body,
    backArc = null;
  if (type === "not" || type === "buffer") {
    body = `M ${cx - R} ${cy - R} L ${cx - R} ${cy + R} L ${cx + R} ${cy} Z`;
  } else if (OR_FAMILY.has(type)) {
    body = `M ${cx - R} ${cy - R} Q ${cx} ${cy - R} ${cx + R} ${cy} Q ${cx} ${cy + R} ${cx - R} ${cy + R} Q ${cx - R + 10} ${cy} ${cx - R} ${cy - R} Z`;
    if (type === "xor" || type === "xnor")
      backArc = `M ${cx - R - 5} ${cy - R} Q ${cx - R + 5} ${cy} ${cx - R - 5} ${cy + R}`;
  } else {
    // and / nand
    body = `M ${cx - R} ${cy - R} L ${cx} ${cy - R} A ${R} ${R} 0 0 1 ${cx} ${cy + R} L ${cx - R} ${cy + R} Z`;
  }
  const inverted = INVERTED_GATES.has(type);
  return {
    body,
    backArc,
    bubble: inverted ? { x: cx + R + BUBBLE_R, y: cy } : null,
    outX: cx + R + (inverted ? 2 * BUBBLE_R : 0),
  };
}

// Pure, deterministic layout: level each node (inputs at 0; a gate one past its deepest
// input; cycle-safe), spread levels across columns and nodes down each column. Outputs
// get a trailing column. No model coordinates anywhere.
function layoutLogic(spec) {
  const R = GATE_R;
  const gateById = new Map(spec.gates.map((g) => [g.id, g]));
  const inputIds = new Set(spec.inputs.map((i) => i.id));
  const levelMemo = new Map(),
    visiting = new Set();
  const levelOf = (id) => {
    if (inputIds.has(id)) return 0;
    const g = gateById.get(id);
    if (!g) return 0;
    if (levelMemo.has(id)) return levelMemo.get(id);
    if (visiting.has(id)) return 0; // back-edge → 0 (cycle-safe)
    visiting.add(id);
    const lv = 1 + Math.max(0, ...g.inputs.map((r) => levelOf(r)));
    visiting.delete(id);
    levelMemo.set(id, lv);
    return lv;
  };
  spec.gates.forEach((g) => levelOf(g.id));
  const maxLevel = spec.gates.length
    ? Math.max(...spec.gates.map((g) => levelMemo.get(g.id)))
    : 1;
  const outCol = maxLevel + 1;
  const COLW = 130,
    ROWH = 82,
    PADX = 46,
    PADY = 44;

  const byLevel = new Map();
  const push = (lv, nd) => {
    const a = byLevel.get(lv) || [];
    a.push(nd);
    byLevel.set(lv, a);
  };
  spec.inputs.forEach((i) =>
    push(0, { kind: "input", id: i.id, label: i.label }),
  );
  spec.gates.forEach((g) =>
    push(levelMemo.get(g.id), {
      kind: "gate",
      id: g.id,
      type: g.type,
      label: g.label,
      refs: g.inputs,
    }),
  );
  spec.outputs.forEach((o, i) =>
    push(outCol, {
      kind: "output",
      id: `__out${i}`,
      from: o.from,
      label: o.label,
    }),
  );

  const maxCount = Math.max(1, ...[...byLevel.values()].map((a) => a.length));
  const height = PADY * 2 + (maxCount - 1) * ROWH + 2 * R;
  const midY = height / 2;
  const nodes = new Map(),
    order = [];
  byLevel.forEach((arr, lv) => {
    arr.forEach((nd, i) => {
      const y = midY + (i - (arr.length - 1) / 2) * ROWH;
      const node = { ...nd, x: PADX + lv * COLW, y };
      nodes.set(nd.id, node);
      order.push(node);
    });
  });
  return { nodes, order, width: PADX * 2 + outCol * COLW, height, R };
}

// Where a node's output wire departs (right side): input square edge, or a gate's tip
// (past its inversion bubble).
function nodeOut(nd, R) {
  if (!nd) return null;
  if (nd.kind === "input") return { x: nd.x + INPUT_HR, y: nd.y };
  if (nd.kind === "gate")
    return { x: gateGeom(nd.type, nd.x, nd.y, R).outX, y: nd.y };
  return { x: nd.x, y: nd.y };
}
// A gate's input pins, spread down its left edge in the gate's own input order.
function gatePins(nd, R) {
  const k = nd.refs.length;
  return nd.refs.map((ref, i) => ({
    ref,
    x: nd.x - R,
    y: k <= 1 ? nd.y : nd.y + (-1 + (2 * i) / (k - 1)) * (R - 5),
  }));
}

function LogicCircuitView({ spec, saveable = false }) {
  const [vals, setVals] = useState(() => {
    const v = {};
    spec.inputs.forEach((i) => {
      v[i.id] = i.value ? 1 : 0;
    });
    return v;
  });
  const reduceMotion = useReducedMotion();
  const layout = useMemo(() => layoutLogic(spec), [spec]);
  const live = useMemo(() => evalLogic(spec, vals), [spec, vals]);
  const { nodes, order, width, height, R } = layout;

  const CARD_BG = PAL.navyBubbleAI || PAL.surface;
  const vColor = (v) => (v ? COLOR.evGreen : alpha(PAL.textMuted, 0.42));
  const toggle = (id) => setVals((v) => ({ ...v, [id]: v[id] ? 0 : 1 }));

  // wires (drawn under the nodes), colored by the SOURCE node's live bit
  const wires = [];
  order.forEach((nd) => {
    if (nd.kind === "gate")
      gatePins(nd, R).forEach((pin) => {
        const sp = nodeOut(nodes.get(pin.ref), R);
        if (sp)
          wires.push({
            source: pin.ref,
            from: sp,
            to: { x: pin.x, y: pin.y },
            on: live[pin.ref],
          });
      });
    else if (nd.kind === "output") {
      const sp = nodeOut(nodes.get(nd.from), R);
      if (sp)
        wires.push({
          source: nd.from,
          from: sp,
          to: { x: nd.x - 9, y: nd.y },
          on: live[nd.from],
        });
    }
  });
  // Give each signal its own vertical rail. Sharing a rail between A and B
  // visually shorts independent inputs even when their Boolean values differ.
  const railBySource = new Map();
  const sourceIds = [...new Set(wires.map((w) => w.source))];
  const usedRails = [];
  sourceIds.forEach((source, i) => {
    const group = wires.filter((w) => w.source === source),
      lo = group[0].from.x + 12,
      hi = Math.min(...group.map((w) => w.to.x)) - 10;
    let x = lo + (hi - lo) * (0.2 + (0.6 * (i + 1)) / (sourceIds.length + 1));
    while (usedRails.some((v) => Math.abs(v - x) < 4) && x < hi) x += 4;
    railBySource.set(source, x);
    usedRails.push(x);
  });
  const wirePath = (w) =>
    `M ${w.from.x} ${w.from.y} H ${railBySource.get(w.source)} V ${w.to.y} H ${w.to.x}`;
  const junctions = [];
  for (const source of sourceIds) {
    const group = wires.filter((w) => w.source === source);
    if (group.length > 1) {
      const ys = group.map((w) => w.to.y),
        low = Math.min(group[0].from.y, ...ys),
        high = Math.max(group[0].from.y, ...ys);
      for (const y of new Set([group[0].from.y, ...ys]))
        if (y > low && y < high)
          junctions.push({ x: railBySource.get(source), y, on: group[0].on });
    }
  }
  const wireTrans = reduceMotion
    ? undefined
    : `stroke .18s ${EASE}, stroke-width .18s ${EASE}`;

  // truth table (≤4 inputs → ≤16 rows), current input row highlighted; click a row to set
  const inN = spec.inputs.length;
  const table =
    spec.truthTable && inN >= 1 && inN <= 4
      ? Array.from({ length: 1 << inN }, (_, r) => {
          const combo = {};
          spec.inputs.forEach((inp, bit) => {
            combo[inp.id] = (r >> (inN - 1 - bit)) & 1;
          });
          return {
            combo,
            out: (() => {
              const res = evalLogic(spec, combo);
              return spec.outputs.map((o) => res[o.from]);
            })(),
          };
        })
      : null;
  const curKey = spec.inputs.map((i) => vals[i.id]).join("");
  const thS = {
    padding: "4px 10px",
    fontWeight: 700,
    borderBottom: `1px solid ${PAL.border}`,
    whiteSpace: "nowrap",
  };
  const tdS = {
    padding: "3px 10px",
    textAlign: "center",
    borderBottom: `1px solid ${PAL.borderSoft}`,
  };

  return (
    <VizCard
      title={spec.title}
      ariaLabel={`${spec.title || tr("מעגל לוגי", "Logic circuit")} — ${tr("מעגל לוגי אינטראקטיבי", "interactive logic circuit")}`}
      saveable={saveable}
      spec={spec}
      footerLeft={spec.outputs.map((o, i) => (
        <span
          key={i}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 12,
            color: PAL.textMuted,
            direction: "ltr",
            unicodeBidi: "isolate",
          }}
        >
          <b style={{ color: PAL.text }}>{o.label}</b>=
          <b
            style={{
              color: vColor(live[o.from]),
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {live[o.from]}
          </b>
        </span>
      ))}
    >
      <div style={{ fontSize: 11.5, color: PAL.textFaint, marginBottom: 6 }}>
        {tr(
          "לחצו על קלט (או על שורה בטבלה) כדי לשנות ולראות את הפלט מתעדכן",
          "Toggle an input (or click a table row) to see the output update",
        )}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{
          display: "block",
          direction: "ltr",
          overflow: "visible",
          maxHeight: 360,
        }}
        preserveAspectRatio="xMidYMid meet"
      >
        {wires.map((w, i) => (
          <path
            data-signal={w.source}
            key={i}
            d={wirePath(w)}
            fill="none"
            stroke={vColor(w.on)}
            strokeWidth={w.on ? 2.4 : 1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ transition: wireTrans }}
          />
        ))}
        {junctions.map((p, i) => (
          <circle
            key={`junction-${i}`}
            cx={p.x}
            cy={p.y}
            r="2.7"
            fill={vColor(p.on)}
          />
        ))}
        {order.map((nd) => {
          if (nd.kind === "input") {
            const on = live[nd.id];
            return (
              <g
                key={nd.id}
                onClick={() => toggle(nd.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(nd.id);
                  }
                }}
                tabIndex={0}
                aria-pressed={!!on}
                style={{ cursor: "pointer" }}
                role="button"
                aria-label={`${nd.label} = ${on}`}
              >
                <text
                  x={nd.x}
                  y={nd.y - 20}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="700"
                  fill={PAL.text}
                >
                  {nd.label}
                </text>
                <rect
                  x={nd.x - INPUT_HR}
                  y={nd.y - INPUT_HR}
                  width={INPUT_HR * 2}
                  height={INPUT_HR * 2}
                  rx="7"
                  fill={alpha(vColor(on), 0.18)}
                  stroke={vColor(on)}
                  strokeWidth="1.7"
                />
                <text
                  x={nd.x}
                  y={nd.y + 5}
                  textAnchor="middle"
                  fontSize="15"
                  fontWeight="800"
                  fill={vColor(on)}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {on}
                </text>
              </g>
            );
          }
          if (nd.kind === "gate") {
            const g = gateGeom(nd.type, nd.x, nd.y, R),
              on = live[nd.id];
            return (
              <g key={nd.id}>
                {g.backArc && (
                  <path
                    d={g.backArc}
                    fill="none"
                    stroke={vColor(on)}
                    strokeWidth="1.7"
                  />
                )}
                <path
                  d={g.body}
                  fill={alpha(PAL.text, 0.05)}
                  stroke={vColor(on)}
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  style={{ transition: wireTrans }}
                />
                {g.bubble && (
                  <circle
                    cx={g.bubble.x}
                    cy={g.bubble.y}
                    r={BUBBLE_R}
                    fill={CARD_BG}
                    stroke={vColor(on)}
                    strokeWidth="1.6"
                  />
                )}
                <text
                  x={nd.x}
                  y={nd.y - R - 5}
                  textAnchor="middle"
                  fontSize="9.5"
                  fontWeight="700"
                  fill={PAL.textFaint}
                >
                  {GATE_NAME[nd.type]}
                </text>
                {nd.label && nd.label.toUpperCase() !== GATE_NAME[nd.type] && (
                  <text
                    x={nd.x}
                    y={nd.y + R + 13}
                    textAnchor="middle"
                    fontSize="10.5"
                    fontWeight="600"
                    fill={PAL.textMuted}
                  >
                    {nd.label}
                  </text>
                )}
              </g>
            );
          }
          const on = live[nd.from]; // output terminal
          return (
            <g key={nd.id}>
              <text
                x={nd.x + 9}
                y={nd.y - 14}
                textAnchor="middle"
                fontSize="11.5"
                fontWeight="700"
                fill={PAL.text}
              >
                {nd.label}
              </text>
              <circle
                cx={nd.x + 9}
                cy={nd.y}
                r="9.5"
                fill={alpha(vColor(on), 0.2)}
                stroke={vColor(on)}
                strokeWidth="1.8"
                style={{ transition: wireTrans }}
              />
              <text
                x={nd.x + 9}
                y={nd.y + 4}
                textAnchor="middle"
                fontSize="12"
                fontWeight="800"
                fill={vColor(on)}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {on}
              </text>
            </g>
          );
        })}
      </svg>

      {table && (
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table
            style={{
              borderCollapse: "collapse",
              fontSize: 12.5,
              fontVariantNumeric: "tabular-nums",
              margin: "0 auto",
              direction: "ltr",
            }}
          >
            <thead>
              <tr>
                {spec.inputs.map((i) => (
                  <th key={i.id} style={{ ...thS, color: PAL.textMuted }}>
                    {i.label}
                  </th>
                ))}
                {spec.outputs.map((o, k) => (
                  <th
                    key={k}
                    style={{
                      ...thS,
                      color: PAL.text,
                      borderLeft:
                        k === 0 ? `2px solid ${PAL.border}` : undefined,
                    }}
                  >
                    {o.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.map((row, r) => {
                const active =
                  spec.inputs.map((i) => row.combo[i.id]).join("") === curKey;
                return (
                  <tr
                    key={r}
                    tabIndex={0}
                    aria-label={`Set inputs ${Object.values(row.combo).join("")}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setVals(row.combo);
                      }
                    }}
                    onClick={() => setVals(row.combo)}
                    style={{
                      cursor: "pointer",
                      background: active
                        ? alpha(COLOR.accent, 0.16)
                        : "transparent",
                    }}
                  >
                    {spec.inputs.map((i) => (
                      <td key={i.id} style={{ ...tdS, color: PAL.textMuted }}>
                        {row.combo[i.id]}
                      </td>
                    ))}
                    {row.out.map((b, k) => (
                      <td
                        key={k}
                        style={{
                          ...tdS,
                          fontWeight: 800,
                          color: b ? COLOR.evGreen : PAL.textMuted,
                          borderLeft:
                            k === 0 ? `2px solid ${PAL.border}` : undefined,
                        }}
                      >
                        {b}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </VizCard>
  );
}

// A small filled arrowhead at `tip`, opening back along `dir` (pixel coords). Shared by
// the circuit current-source + LED glyphs.
function arrowHead(tip, dir, color, key, s = 6) {
  const ang = Math.atan2(dir[1], dir[0]),
    a = ang + Math.PI - 0.42,
    b = ang + Math.PI + 0.42;
  return (
    <path
      key={key}
      d={`M${tip[0].toFixed(1)} ${tip[1].toFixed(1)} L${(tip[0] + s * Math.cos(a)).toFixed(1)} ${(tip[1] + s * Math.sin(a)).toFixed(1)} L${(tip[0] + s * Math.cos(b)).toFixed(1)} ${(tip[1] + s * Math.sin(b)).toFixed(1)} Z`}
      fill={color}
    />
  );
}

// circuit — an analog schematic. Components sit on a grid (viz-spec.js validated each
// segment); here we map the grid to pixels and draw the standard symbol along each at→to
// segment with lead wires, plain wires as lines, solder dots at real junctions (≥3
// terminals via circuitJunctions), and a label beside each part. Pure SVG + theme tokens.
const CIRC = { CELL: 76, BODY: 15, H: 7, CR: 13, PAD: 34 };
const CIRC_DIR = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

function CircuitView({ spec, saveable = false }) {
  const comps = spec.components;
  // grid bounds (include a ground's one-cell stub so its earth bars aren't clipped)
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  const see = (x, y) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  comps.forEach((c) => {
    see(c.at[0], c.at[1]);
    if (c.to) see(c.to[0], c.to[1]);
    if (c.type === "ground") {
      const d = CIRC_DIR[c.dir] || CIRC_DIR.down;
      see(c.at[0] + d[0], c.at[1] + d[1]);
    }
  });
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 1;
    minY = 0;
    maxY = 1;
  }
  const cols = Math.max(1, maxX - minX),
    rows = Math.max(1, maxY - minY);
  const cell = Math.min(CIRC.CELL, (G_W - 2 * CIRC.PAD) / cols);
  const W = 2 * CIRC.PAD + cols * cell,
    H = 2 * CIRC.PAD + rows * cell;
  const gx = (x) => CIRC.PAD + (x - minX) * cell,
    gy = (y) => CIRC.PAD + (y - minY) * cell;
  const WIRE = PAL.textMuted,
    SYM = PAL.text,
    LAB = PAL.textMuted,
    MASK = PAL.navyBubbleAI || PAL.surface;

  const part = (c, i) => {
    const seg = (a, b, k, w = 1.8, stroke = SYM) => (
      <line
        key={k}
        x1={a[0]}
        y1={a[1]}
        x2={b[0]}
        y2={b[1]}
        stroke={stroke}
        strokeWidth={w}
        strokeLinecap="round"
      />
    );
    if (c.type === "ground") {
      const ax = gx(c.at[0]),
        ay = gy(c.at[1]),
        d = CIRC_DIR[c.dir] || CIRC_DIR.down;
      const ex = ax + d[0] * cell * 0.5,
        ey = ay + d[1] * cell * 0.5,
        ux = d[0],
        uy = d[1],
        nx = -uy,
        ny = ux;
      const bar = (t, half) => {
        const bx = ex + ux * t,
          by = ey + uy * t;
        return `M${(bx - nx * half).toFixed(1)} ${(by - ny * half).toFixed(1)} L${(bx + nx * half).toFixed(1)} ${(by + ny * half).toFixed(1)}`;
      };
      return (
        <g key={i}>
          <line
            x1={ax}
            y1={ay}
            x2={ex}
            y2={ey}
            stroke={WIRE}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path d={bar(0, 9)} stroke={SYM} strokeWidth="1.8" />
          <path d={bar(4, 5.5)} stroke={SYM} strokeWidth="1.8" />
          <path d={bar(8, 2.5)} stroke={SYM} strokeWidth="1.8" />
          {c.label && (
            <text
              x={ex + nx * 13}
              y={ey + ny * 13 + 3}
              textAnchor="middle"
              fontSize="10.5"
              fill={LAB}
            >
              {c.label}
            </text>
          )}
        </g>
      );
    }
    const P1 = [gx(c.at[0]), gy(c.at[1])],
      P2 = [gx(c.to[0]), gy(c.to[1])];
    const dx = P2[0] - P1[0],
      dy = P2[1] - P1[1],
      len = Math.hypot(dx, dy) || 1,
      ux = dx / len,
      uy = dy / len;
    let nx = -uy,
      ny = ux;
    if (ny > 0.01) {
      nx = uy;
      ny = -ux;
    } // prefer the upward normal for the label
    const mx = (P1[0] + P2[0]) / 2,
      my = (P1[1] + P2[1]) / 2;
    const P = (du, dn) => [mx + ux * du + nx * dn, my + uy * du + ny * dn];
    const flip = c.flip ? -1 : 1;
    const els = [];
    let bh = 0;

    if (c.type === "resistor" || c.type === "box" || c.type === "fuse") {
      bh = CIRC.BODY;
      const c1 = P(-bh, -CIRC.H),
        c2 = P(bh, -CIRC.H),
        c3 = P(bh, CIRC.H),
        c4 = P(-bh, CIRC.H);
      els.push(
        <path
          key="b"
          d={`M${c1[0]} ${c1[1]} L${c2[0]} ${c2[1]} L${c3[0]} ${c3[1]} L${c4[0]} ${c4[1]} Z`}
          fill={MASK}
          stroke={SYM}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />,
      );
      if (c.type === "fuse") els.push(seg(P(-bh, 0), P(bh, 0), "f", 1.4));
    } else if (c.type === "capacitor") {
      bh = 3.5;
      els.push(seg(P(-bh, -11), P(-bh, 11), "p1"));
      els.push(seg(P(bh, -11), P(bh, 11), "p2"));
    } else if (c.type === "inductor") {
      bh = CIRC.BODY;
      const step = (2 * bh) / 4;
      let d = `M${P(-bh, 0)[0].toFixed(1)} ${P(-bh, 0)[1].toFixed(1)}`;
      for (let k = 0; k < 4; k += 1) {
        const e = P(-bh + step * (k + 1), 0);
        d += ` A ${(step / 2).toFixed(1)} ${(step / 2).toFixed(1)} 0 0 1 ${e[0].toFixed(1)} ${e[1].toFixed(1)}`;
      }
      els.push(
        <path key="coil" d={d} fill="none" stroke={SYM} strokeWidth="1.8" />,
      );
    } else if (c.type === "battery") {
      bh = 5;
      const lp = flip < 0 ? -bh : bh; // long plate (+) toward `to` unless flipped
      els.push(seg(P(lp, -9), P(lp, 9), "lp"));
      els.push(seg(P(-lp, -4.5), P(-lp, 4.5), "sp", 3));
    } else if (c.type === "source" || c.type === "current_source") {
      bh = CIRC.CR;
      els.push(
        <circle
          key="c"
          cx={mx}
          cy={my}
          r={CIRC.CR}
          fill={MASK}
          stroke={SYM}
          strokeWidth="1.8"
        />,
      );
      if (c.type === "current_source") {
        els.push(seg(P(-6 * flip, 0), P(6 * flip, 0), "sh"));
        els.push(arrowHead(P(6 * flip, 0), [ux * flip, uy * flip], SYM, "ah"));
      } else if (c.ac) {
        let d = "";
        for (let k = 0; k <= 20; k += 1) {
          const p = P(
            -7 + (14 * k) / 20,
            -Math.sin((k / 20) * 2 * Math.PI) * 4,
          );
          d += `${k ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
        }
        els.push(
          <path key="sin" d={d} fill="none" stroke={SYM} strokeWidth="1.6" />,
        );
      } else {
        const pp = P(6.5 * flip, 0),
          mm = P(-6.5 * flip, 0);
        els.push(
          <text
            key="pl"
            x={pp[0]}
            y={pp[1] + 4}
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
            fill={SYM}
          >
            +
          </text>,
        );
        els.push(
          <text
            key="mn"
            x={mm[0]}
            y={mm[1] + 5}
            textAnchor="middle"
            fontSize="15"
            fontWeight="700"
            fill={SYM}
          >
            −
          </text>,
        );
      }
    } else if (c.type === "lamp") {
      bh = CIRC.CR;
      const r = CIRC.CR * 0.72 * 0.7;
      els.push(
        <circle
          key="c"
          cx={mx}
          cy={my}
          r={CIRC.CR}
          fill={MASK}
          stroke={SYM}
          strokeWidth="1.8"
        />,
      );
      els.push(seg(P(-r, -r), P(r, r), "x1"));
      els.push(seg(P(-r, r), P(r, -r), "x2"));
    } else if (c.type === "diode" || c.type === "led") {
      bh = 6;
      const tipD = 6 * flip,
        baseD = -6 * flip;
      const b1 = P(baseD, -CIRC.H),
        b2 = P(baseD, CIRC.H),
        tip = P(tipD, 0);
      els.push(
        <path
          key="tri"
          d={`M${b1[0]} ${b1[1]} L${b2[0]} ${b2[1]} L${tip[0]} ${tip[1]} Z`}
          fill={alpha(SYM, 0.14)}
          stroke={SYM}
          strokeWidth="1.7"
          strokeLinejoin="round"
        />,
      );
      els.push(seg(P(tipD, -CIRC.H), P(tipD, CIRC.H), "bar"));
      if (c.type === "led") {
        els.push(arrowHead(P(1, -CIRC.H - 8), [nx, ny], SYM, "l1", 5));
        els.push(arrowHead(P(6, -CIRC.H - 8), [nx, ny], SYM, "l2", 5));
      }
    } else if (c.type === "switch") {
      bh = 7;
      const a = P(-bh, 0),
        b = P(bh, 0);
      els.push(<circle key="t1" cx={a[0]} cy={a[1]} r="2.2" fill={SYM} />);
      els.push(<circle key="t2" cx={b[0]} cy={b[1]} r="2.2" fill={SYM} />);
      els.push(seg(a, c.closed ? b : P(bh - 2, -9), "blade"));
    }

    const near = P(-bh, 0),
      far = P(bh, 0);
    const leads = [
      <line
        key="l1"
        x1={P1[0]}
        y1={P1[1]}
        x2={near[0]}
        y2={near[1]}
        stroke={WIRE}
        strokeWidth="1.8"
        strokeLinecap="round"
      />,
      <line
        key="l2"
        x1={far[0]}
        y1={far[1]}
        x2={P2[0]}
        y2={P2[1]}
        stroke={WIRE}
        strokeWidth="1.8"
        strokeLinecap="round"
      />,
    ];
    let label = null;
    if (c.label && c.type !== "wire") {
      label =
        c.type === "box" ? (
          <text
            x={mx}
            y={my + 4}
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill={PAL.text}
          >
            {c.label}
          </text>
        ) : (
          <text
            x={mx + nx * (CIRC.H + 13)}
            y={my + ny * (CIRC.H + 13) + 3.5}
            textAnchor="middle"
            fontSize="10.5"
            fontWeight="600"
            fill={LAB}
            style={{ direction: "ltr", unicodeBidi: "isolate" }}
          >
            {c.label}
          </text>
        );
    }
    return (
      <g key={i}>
        {leads}
        {els}
        {label}
      </g>
    );
  };

  return (
    <VizCard
      title={spec.title}
      ariaLabel={`${spec.title || tr("מעגל חשמלי", "Circuit")} — ${tr("סכמה חשמלית", "circuit schematic")}`}
      saveable={saveable}
      spec={spec}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{
          display: "block",
          direction: "ltr",
          overflow: "visible",
          maxHeight: 430,
        }}
        preserveAspectRatio="xMidYMid meet"
      >
        {comps.map((c, i) => part(c, i))}
        {circuitJunctions(comps).map((j, i) => (
          <circle
            key={`j${i}`}
            cx={gx(j[0])}
            cy={gy(j[1])}
            r="3.4"
            fill={SYM}
          />
        ))}
      </svg>
    </VizCard>
  );
}

// surface3d — the ONLY 3D kind. Renders z=f(x,y) surfaces + an integration solid with
// Plotly (rotate / zoom), lazy-loaded from the CDN on first use so it NEVER weighs on the
// main bundle (this whole module is already lazy-loaded by RichText, and the script only
// loads when a 3D viz actually appears). All math still goes through the no-eval engine:
// the model supplies exprs + a typed domain, and the renderer samples, builds every grid,
// and numerically estimates ∬_D f dA. If Plotly can't load, it degrades to the formulas
// as text — never a broken chart.
