import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  cp,
  readdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
const cli = resolve("skills/studai-stem/scripts/studai.mjs"),
  source = resolve("skills/studai-stem/assets/examples/calculus-tangent.json");
const run = (args, options = {}) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", ...options });
test("CLI doctor succeeds without network or dependencies in a copied skill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studai-portable-"));
  await cp("skills/studai-stem", join(dir, "studai-stem"), { recursive: true });
  const copy = join(dir, "studai-stem/scripts/studai.mjs");
  const doctor = spawnSync(process.execPath, [copy, "doctor"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).nodeSupported, true);
  const render = spawnSync(
    process.execPath,
    [copy, "render", source, "--out", join(dir, "rendered")],
    { cwd: dir, encoding: "utf8" },
  );
  assert.equal(render.status, 0, render.stderr);
  assert.ok(
    (await readFile(join(dir, "rendered/index.html"), "utf8")).includes(
      "A tangent is a local model",
    ),
  );
});
test("Render refuses existing output and preserves its files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studai-no-clobber-"));
  await writeFile(join(dir, "keep"), "untouched");
  const result = run(["render", source, "--out", dir]);
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(join(dir, "keep"), "utf8"), "untouched");
  assert.deepEqual(await readdir(dir), ["keep"]);
});
test("Failed assertions write no output bundle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studai-bad-math-"));
  const doc = JSON.parse(await readFile(source, "utf8"));
  doc.checks[0].expected = 999;
  const input = join(dir, "wrong.json"),
    dest = join(dir, "rendered");
  await writeFile(input, JSON.stringify(doc));
  const result = run(["render", input, "--out", dest]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /assertions failed/);
  assert.deepEqual(await readdir(dir), ["wrong.json"]);
});
test("Malformed JSON receives a nonzero, concise error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studai-json-"));
  const input = join(dir, "bad.json");
  await writeFile(input, "{");
  const result = run(["validate", input]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Studai:/);
});
test("Oversized inputs reject before parsing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studai-size-"));
  const input = join(dir, "large.json");
  await writeFile(input, " ".repeat(1_000_001));
  assert.match(run(["validate", input]).stderr, /exceeds 1 MB/);
});
test("Unknown CLI commands and arguments fail", () => {
  assert.notEqual(run(["bogus", source]).status, 0);
  assert.notEqual(run(["render", source, "--overwrite", "x"]).status, 0);
});
test("Example path traversal is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studai-traverse-"));
  assert.notEqual(
    run(["example", "../../package", "--out", join(dir, "x.json")]).status,
    0,
  );
  assert.deepEqual(await readdir(dir), []);
});
test("Example extraction preserves existing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studai-example-")),
    out = join(dir, "source.json");
  await writeFile(out, "keep");
  assert.notEqual(run(["example", "calculus-tangent", "--out", out]).status, 0);
  assert.equal(await readFile(out, "utf8"), "keep");
});
test("Both coding-agent install locations work in a fresh project and reject overwrite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studai-install-"));
  const install = resolve("scripts/install.mjs");
  const args = [install, "--agent", "both", "--project", dir];
  const first = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  for (const host of [".claude", ".agents"]) {
    const skill = join(dir, host, "skills/studai-stem");
    assert.match(
      await readFile(join(skill, "SKILL.md"), "utf8"),
      /name: studai-stem/,
    );
    const d = spawnSync(
      process.execPath,
      [join(skill, "scripts/studai.mjs"), "doctor"],
      { encoding: "utf8", cwd: dir },
    );
    assert.equal(d.status, 0, d.stderr);
  }
  const next = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.notEqual(next.status, 0);
  assert.match(next.stderr, /Already exists/);
});
test("Generated schema enumerates native input fields", () => {
  const r = run(["schema", "geometry2d"]);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.equal(s.additionalProperties, false);
  assert.ok(s.properties.items);
});
