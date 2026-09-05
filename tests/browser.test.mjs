import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const asyncRun = async (file, args, options) => {
  try {
    return { ...(await promisify(execFile)(file, args, options)), status: 0 };
  } catch (e) {
    return { status: e.code, stderr: e.stderr || e.message };
  }
};
const temp = await mkdtemp(join(tmpdir(), "studai-browser-"));
let browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});
const examples = (await readdir("skills/studai-stem/assets/examples"))
  .filter((f) => f.endsWith(".json"))
  .sort();
const generated = new Map();
for (const name of examples)
  test(`Offline browser rendering: ${name}`, async () => {
    const output = join(temp, name.slice(0, -5)),
      input = resolve("skills/studai-stem/assets/examples", name);
    const run = await asyncRun(
      process.execPath,
      [
        "skills/studai-stem/scripts/studai.mjs",
        "render",
        input,
        "--out",
        output,
      ],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    generated.set(name, output);
    const page = await browser.newPage({
      viewport: { width: 1100, height: 900 },
      reducedMotion: "reduce",
    });
    const errors = [],
      remote = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      if (/^https?:/.test(route.request().url())) {
        remote.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(pathToFileURL(join(output, "index.html")).href);
    await page.waitForFunction(() => window.__STUDAI_READY__);
    await page.waitForTimeout(60);
    assert.deepEqual(errors, [], "Browser errors");
    assert.deepEqual(remote, [], "Unexpected network request");
    assert.ok(await page.locator("figure svg").count());
    const invalid = await page
      .locator("svg")
      .evaluateAll((svgs) =>
        svgs.flatMap((svg) =>
          [...svg.querySelectorAll("*")].flatMap((e) =>
            [...e.attributes]
              .filter(
                (a) =>
                  [
                    "d",
                    "points",
                    "x",
                    "y",
                    "x1",
                    "x2",
                    "y1",
                    "y2",
                    "cx",
                    "cy",
                    "r",
                    "width",
                    "height",
                    "transform",
                  ].includes(a.name) && /(?:NaN|Infinity)/.test(a.value),
              )
              .map((a) => `${e.tagName}.${a.name}`),
          ),
        ),
      );
    assert.deepEqual(invalid, [], "Invalid SVG geometry");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "Whole-page mobile overflow",
    );
    for (const file of (await readdir(output)).filter((f) =>
      f.endsWith(".svg"),
    )) {
      const p = await browser.newPage();
      await p.goto(pathToFileURL(join(output, file)).href);
      assert.equal(
        await p.locator("parsererror").count(),
        0,
        "Invalid standalone SVG XML",
      );
      await p.close();
    }
    await page.close();
  });
test("Parameter change redraws and report stays explicitly scoped to initial values", async () => {
  const p = await browser.newPage();
  await p.goto(
    pathToFileURL(join(generated.get("pde-heat-equation.json"), "index.html"))
      .href,
  );
  await p.waitForFunction(() => window.__STUDAI_READY__);
  const range = p.getByRole("slider", { name: "Time" }),
    before = await p.locator("figure svg").innerHTML();
  await range.fill("2");
  assert.notEqual(await p.locator("figure svg").innerHTML(), before);
  assert.match(await p.getByRole("status").textContent(), /initial values/);
  await p.close();
});
test("Logic controls work with keyboard and update outputs", async () => {
  const p = await browser.newPage();
  await p.goto(
    pathToFileURL(join(generated.get("ee-full-adder.json"), "index.html")).href,
  );
  await p.waitForFunction(() => window.__STUDAI_READY__);
  const controls = p.locator('figure [role="button"]');
  assert.equal(await controls.count(), 3);
  const before = await p.locator("figure svg").innerHTML();
  await controls.first().focus();
  await p.keyboard.press("Enter");
  assert.notEqual(await p.locator("figure svg").innerHTML(), before);
  await p.close();
});
test("3D axis labels stay inside SVG over a rotation/elevation grid", async () => {
  const p = await browser.newPage();
  await p.goto(
    pathToFileURL(join(generated.get("multivariable-disk.json"), "index.html"))
      .href,
  );
  await p.waitForFunction(() => window.__STUDAI_READY__);
  for (const az of [-180, -90, 0, 45, 90, 180])
    for (const el of [5, 45, 85]) {
      await p.getByRole("slider", { name: "Rotation" }).fill(String(az));
      await p.getByRole("slider", { name: "Elevation" }).fill(String(el));
      const outside = await p.locator("figure svg").evaluate((svg) => {
        const vb = svg.viewBox.baseVal;
        return [...svg.querySelectorAll("text")]
          .filter((t) => {
            const b = t.getBBox();
            return (
              b.x < 0 ||
              b.y < 0 ||
              b.x + b.width > vb.width ||
              b.y + b.height > vb.height
            );
          })
          .map((t) => t.textContent);
      });
      assert.deepEqual(outside, [], `${az}/${el}`);
    }
  await p.close();
});
test("Static figures remain visible without JavaScript", async () => {
  const p = await browser.newPage({ javaScriptEnabled: false });
  await p.goto(
    pathToFileURL(join(generated.get("ee-rc-transient.json"), "index.html"))
      .href,
  );
  assert.equal(await p.locator("figure svg").count(), 2);
  assert.match(await p.locator(".status").textContent(), /2\/2/);
  await p.close();
});
test("User strings cannot break out of inline JSON or execute script", async () => {
  const raw = JSON.parse(
    await readFile(
      "skills/studai-stem/assets/examples/calculus-tangent.json",
      "utf8",
    ),
  );
  raw.title = "</script><script>window.PWNED=true</script>";
  const input = join(temp, "injection.json"),
    out = join(temp, "injection");
  await writeFile(input, JSON.stringify(raw));
  const run = await asyncRun(
    process.execPath,
    ["skills/studai-stem/scripts/studai.mjs", "render", input, "--out", out],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const p = await browser.newPage();
  await p.goto(pathToFileURL(join(out, "index.html")).href);
  await p.waitForFunction(() => window.__STUDAI_READY__);
  assert.equal(await p.evaluate(() => window.PWNED), undefined);
  assert.equal(await p.locator("h1").textContent(), raw.title);
  await p.close();
});

test("Hebrew locale uses matching server and browser markup", async () => {
  const raw = JSON.parse(
    await readFile(
      "skills/studai-stem/assets/examples/linear-algebra-projection.json",
      "utf8",
    ),
  );
  raw.language = "he";
  const input = join(temp, "he.json"),
    out = join(temp, "he");
  await writeFile(input, JSON.stringify(raw));
  const run = await asyncRun(
    process.execPath,
    ["skills/studai-stem/scripts/studai.mjs", "render", input, "--out", out],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const p = await browser.newPage({ reducedMotion: "reduce" }),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(pathToFileURL(join(out, "index.html")).href);
  await p.waitForFunction(() => window.__STUDAI_READY__);
  await p.waitForTimeout(100);
  assert.deepEqual(errors, []);
  assert.equal(await p.locator("main").getAttribute("dir"), "rtl");
  assert.equal(
    await p
      .locator("figure svg")
      .evaluate((e) => getComputedStyle(e).direction),
    "ltr",
  );
  await p.close();
});

test("Quarter-annulus rendered boundary matches radii and analytical area", async () => {
  const p = await browser.newPage();
  await p.goto(
    pathToFileURL(join(generated.get("polar-annulus.json"), "index.html")).href,
  );
  const result = await p
    .locator('[data-geometry="sector"]')
    .evaluate((path) => {
      const cx = Number(path.dataset.cx),
        cy = Number(path.dataset.cy),
        scale = Number(path.dataset.scale),
        n = 3000,
        length = path.getTotalLength();
      const points = Array.from({ length: n }, (_, i) => {
        const p = path.getPointAtLength((length * i) / n);
        return { x: (p.x - cx) / scale, y: (cy - p.y) / scale };
      });
      let twiceArea = 0;
      for (let i = 0; i < n; i++) {
        const a = points[i],
          b = points[(i + 1) % n];
        twiceArea += a.x * b.y - b.x * a.y;
      }
      return {
        area: Math.abs(twiceArea) / 2,
        maxRadiusError: Math.max(
          ...points
            .filter((p) => p.x > 0.01 && p.y > 0.01)
            .map((p) =>
              Math.min(
                Math.abs(Math.hypot(p.x, p.y) - 1),
                Math.abs(Math.hypot(p.x, p.y) - 2),
              ),
            ),
        ),
      };
    });
  assert.ok(
    Math.abs(result.area - (3 * Math.PI) / 4) < 0.002,
    JSON.stringify(result),
  );
  assert.ok(result.maxRadiusError < 0.002, JSON.stringify(result));
  await p.close();
});
test("Incline angle marker measures the acute 30-degree angle", async () => {
  const p = await browser.newPage();
  await p.goto(
    pathToFileURL(join(generated.get("physics-incline.json"), "index.html"))
      .href,
  );
  const angle = await p
    .locator('[data-geometry="incline-angle"]')
    .evaluate((path) => path.getTotalLength() / Number(path.dataset.radius));
  assert.ok(Math.abs(angle - Math.PI / 6) < 0.005, `Rendered angle: ${angle}`);
  await p.close();
});
test("Projectile labels remain separate at launch, apex and landing", async () => {
  const p = await browser.newPage();
  await p.goto(
    pathToFileURL(join(generated.get("physics-projectile.json"), "index.html"))
      .href,
  );
  await p.waitForFunction(() => window.__STUDAI_READY__);
  for (const phase of ["0", "0.5", "1"]) {
    await p.getByRole("slider", { name: "timeline" }).fill(phase);
    const overlap = await p.locator("figure svg").evaluate((svg) => {
      const labels = [...svg.querySelectorAll("text")].filter((t) =>
        ["Trajectory", "Launch", "Landing"].includes(t.textContent),
      );
      return labels.flatMap((a, i) =>
        labels
          .slice(i + 1)
          .filter((b) => {
            const x = a.getBBox(),
              y = b.getBBox();
            return (
              x.x < y.x + y.width &&
              x.x + x.width > y.x &&
              x.y < y.y + y.height &&
              x.y + x.height > y.y
            );
          })
          .map((b) => [a.textContent, b.textContent]),
      );
    });
    assert.deepEqual(overlap, [], phase);
  }
  await p.close();
});
