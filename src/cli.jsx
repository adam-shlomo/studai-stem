import React from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { readFile, mkdir, writeFile, stat, readdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validateDocument, schemaJSON, specSchemas } from "./schema.js";
import { z } from "zod";
import { verify } from "./numerics.js";
import Illustration from "./Illustration.jsx";
import VizWidget from "./VizWidget.jsx";
import { setLocale } from "./locale.js";
const here = dirname(fileURLToPath(import.meta.url)),
  skill = resolve(here, "../..");
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function errorText(e) {
  return e.issues
    ? e.issues
        .map((i) => `${i.path.join(".") || "document"}: ${i.message}`)
        .join("\n")
    : e.message;
}
async function readInput(path) {
  const info = await stat(path);
  if (info.size > 1_000_000) throw new Error("Input exceeds 1 MB");
  return JSON.parse(await readFile(path, "utf8"));
}
async function html(raw, doc, report) {
  const [js, css] = await Promise.all([
    readFile(join(here, "browser.js"), "utf8"),
    readFile(join(here, "style.css"), "utf8"),
  ]);
  const data = JSON.stringify({ doc: raw, report })
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const script = js.replaceAll("</script", "<\\/script");
  return `<!doctype html>\n<html lang="${doc.language || "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${esc(doc.title)}</title><style>${css}</style></head><body><noscript>The initial diagrams and check report are visible. Enable JavaScript to use controls.</noscript><div id="root">${renderToString(<Illustration doc={doc} report={report} />)}</div><script id="studai-data" type="application/json">${data}</script><script>${script}</script></body></html>`;
}
function svgFor(d) {
  const markup = renderToStaticMarkup(<VizWidget spec={d.spec} />);
  const start = markup.indexOf("<svg"),
    end = markup.indexOf("</svg>", start);
  if (start < 0 || end < 0) throw new Error(`No SVG for ${d.id}`);
  let svg = markup.slice(start, end + 6);
  const vb = svg.match(/viewBox="([^"]+)"/);
  if (!vb) throw new Error("SVG has no viewBox");
  const [x, y, w, h] = vb[1].split(/\s+/).map(Number);
  svg = svg
    .replace(/ role="[^"]*"/, "")
    .replace(/ width="[^"]*"/, "")
    .replace(
      "<svg ",
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="system-ui, sans-serif" role="img" `,
    );
  const pos = svg.indexOf(">") + 1;
  return (
    svg.slice(0, pos) +
    `<title>${esc(d.spec.title || d.id)}</title><desc>${esc(d.caption)}</desc><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white"/>` +
    svg.slice(pos)
  );
}
const help = `Studai STEM — reproducible illustrations\n\n  node studai.mjs doctor\n  node studai.mjs list [search]\n  node studai.mjs example NAME --out FILE.json\n  node studai.mjs validate FILE.json\n  node studai.mjs verify FILE.json\n  node studai.mjs render FILE.json --out NEW_DIRECTORY\n  node studai.mjs schema [KIND]\n\nRequires Node.js 22+. No npm install, browser, API key or network needed.\nRender writes index.html, diagram SVGs, source.json and verification.json.\nOutput directory must not exist. Failed assertions stop rendering.\n`;
async function run() {
  const args = process.argv.slice(2),
    cmd = args.shift();
  if (!cmd || cmd === "--help" || cmd === "help") {
    console.log(help);
    return;
  }
  if (cmd === "doctor") {
    console.log(
      JSON.stringify(
        {
          node: process.versions.node,
          nodeSupported: Number(process.versions.node.split(".")[0]) >= 22,
          engine: "offline",
          diagramKinds: Object.keys(specSchemas).length,
          runtimeFiles: await Promise.all(
            ["browser.js", "style.css"].map(async (f) => ({
              file: f,
              present: !!(await stat(join(here, f)).catch(() => null)),
            })),
          ),
        },
        null,
        2,
      ),
    );
    return;
  }
  const examples = join(skill, "assets/examples");
  if (cmd === "list") {
    const search = (args[0] || "").toLowerCase();
    const all = (await readdir(examples))
      .filter((f) => f.endsWith(".json"))
      .sort();
    for (const f of all) {
      const doc = await readInput(join(examples, f));
      if (`${f} ${doc.course} ${doc.title}`.toLowerCase().includes(search))
        console.log(`${f.slice(0, -5)}\t${doc.course}\t${doc.title}`);
    }
    return;
  }
  if (cmd === "schema") {
    console.log(
      JSON.stringify(
        args[0]
          ? z.toJSONSchema(
              specSchemas[args[0]] ||
                (() => {
                  throw new Error("Unknown diagram kind");
                })(),
              { unrepresentable: "any" },
            )
          : schemaJSON(),
        null,
        2,
      ),
    );
    return;
  }
  const input = args.shift(),
    outFlag = args.shift(),
    out = args.shift();
  if (!input) throw new Error("Missing input file or example name");
  if (args.length || (outFlag && outFlag !== "--out") || (outFlag && !out))
    throw new Error("Expected --out PATH");
  if (cmd === "example") {
    if (!/^[a-z0-9-]+$/.test(input)) throw new Error("Invalid example name");
    if (!out) throw new Error("example needs --out FILE.json");
    const content = await readFile(join(examples, `${input}.json`));
    await writeFile(resolve(out), content, { flag: "wx" });
    console.log(resolve(out));
    return;
  }
  if (!["validate", "verify", "render"].includes(cmd))
    throw new Error(`Unknown command: ${cmd}`);
  const raw = await readInput(resolve(input)),
    doc = validateDocument(raw);
  setLocale(doc.language);
  if (cmd === "validate") {
    console.log(
      JSON.stringify(
        {
          status: "valid",
          diagrams: doc.diagrams.length,
          checks: doc.checks.length,
        },
        null,
        2,
      ),
    );
    return;
  }
  const report = verify(doc);
  report.sourceSha256 = createHash("sha256")
    .update(JSON.stringify(raw))
    .digest("hex");
  if (cmd === "verify") {
    console.log(JSON.stringify(report, null, 2));
    if (report.status === "failed") process.exitCode = 1;
    return;
  }
  if (report.status === "failed") {
    console.error(JSON.stringify(report, null, 2));
    throw new Error("Mathematical assertions failed; no illustration written");
  }
  if (!out) throw new Error("render needs --out NEW_DIRECTORY");
  // Generate every output before creating the destination, so validation/render failures leave no partial bundle.
  const files = {
    "index.html": await html(raw, doc, report),
    "source.json": JSON.stringify(raw, null, 2) + "\n",
    "verification.json": JSON.stringify(report, null, 2) + "\n",
  };
  for (const d of doc.diagrams) files[`${d.id}.svg`] = svgFor(d);
  const dest = resolve(out);
  await mkdir(dest, { recursive: false });
  for (const [name, content] of Object.entries(files))
    await writeFile(join(dest, name), content, { flag: "wx" });
  console.log(
    JSON.stringify(
      {
        status: "rendered",
        directory: dest,
        files: Object.keys(files),
        checks: `${report.passed}/${report.total}`,
        verification: report.status,
      },
      null,
      2,
    ),
  );
}
run().catch((e) => {
  console.error(`Studai: ${errorText(e)}`);
  process.exitCode = 1;
});
