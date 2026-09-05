import { readdir, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const root = "outputs/gallery";
await mkdir("outputs", { recursive: true });
await rm(root, { recursive: true, force: true });
await mkdir(root);
const names = (await readdir("skills/studai-stem/assets/examples"))
  .filter((f) => f.endsWith(".json"))
  .sort();
const cards = [];
for (const name of names) {
  const path = `skills/studai-stem/assets/examples/${name}`,
    slug = name.slice(0, -5);
  const doc = JSON.parse(await readFile(path, "utf8"));
  const result = spawnSync(
    process.execPath,
    [
      "skills/studai-stem/scripts/studai.mjs",
      "render",
      path,
      "--out",
      `${root}/${slug}`,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`${slug}: ${result.stderr}`);
  cards.push({
    slug,
    title: doc.title,
    course: doc.course,
    description: doc.description,
    figure: doc.diagrams[0].id,
  });
}
const esc = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
await writeFile(
  `${root}/index.html`,
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Studai STEM · Example atlas</title><style>body{font-family:system-ui;background:#f4f6fa;color:#182338;margin:0}main{max-width:1200px;margin:auto;padding:48px 24px}h1{font-size:44px;letter-spacing:-.04em;margin:16px 0}header p{font-size:18px;color:#526078;line-height:1.6;max-width:760px}input{padding:14px;width:min(100%,500px);font:inherit;border:1px solid #b9c7da;border-radius:6px;box-sizing:border-box}#grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px;margin-top:28px}a.card{background:white;border:1px solid #dce2eb;border-radius:10px;overflow:hidden;color:inherit;text-decoration:none;display:block}a.card:hover{border-color:#2456a6}a.card img{display:block;width:100%;height:220px;object-fit:contain;border-bottom:1px solid #dce2eb;background:white}a.card div{padding:20px}small{color:#2456a6;font-size:11px;text-transform:uppercase;letter-spacing:.08em}h2{font-size:18px;line-height:1.4}a.card p{font-size:13px;line-height:1.6;color:#526078}[hidden]{display:none!important}.stats{display:flex;gap:24px;font-size:13px;color:#526078;margin:26px 0}</style></head><body><main><header><small>STUDAI STEM / EXAMPLE ATLAS</small><h1>Make the model visible.</h1><p>Editable STEM illustrations with equations, assumptions and explicit mathematical checks. Open any example to explore the controls and inspect its source.</p><div class="stats"><span>${cards.length} worked examples</span><span>19 diagram types</span><span>Offline · no API key</span></div><input type="search" id="search" aria-label="Search examples" placeholder="Search a course, topic or diagram…"><p id="count" aria-live="polite"></p></header><div id="grid">${cards.map((c) => `<a class="card" href="${c.slug}/index.html" data-search="${esc(`${c.title} ${c.course} ${c.slug}`.toLowerCase())}"><img src="${c.slug}/${c.figure}.svg" alt="${esc(c.title)}" loading="lazy"><div><small>${esc(c.course)}</small><h2>${esc(c.title)}</h2><p>${esc(c.description)}</p></div></a>`).join("")}</div></main><script>const input=document.getElementById('search');input.addEventListener('input',()=>{let n=0;for(const card of document.querySelectorAll('.card')){card.hidden=!card.dataset.search.includes(input.value.toLowerCase());if(!card.hidden)n++}document.getElementById('count').textContent=n+' examples';});</script></body></html>`,
);
console.log(
  `Rendered ${cards.length} complete example bundles into ${root}/index.html`,
);
