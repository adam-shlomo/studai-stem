import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import assert from "node:assert/strict";
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const blocked =
  /(?:^|\/)(?:\.env[^/]*|node_modules|__pycache__|\.venv|outputs|artifacts)(?:\/|$)|\.(?:pem|key|p12|pfx|pyc|bak|backup|orig|rej)$/i;
for (const file of files) {
  assert.ok(!blocked.test(file), `Forbidden release path: ${file}`);
  assert.ok(!lstatSync(file).isSymbolicLink(), `Release symlink: ${file}`);
}
for (const name of ["LICENSE", "NOTICE.md", "SECURITY.md", "CONTRIBUTING.md"])
  assert.ok(readFileSync(name, "utf8").trim(), `Missing ${name}`);
assert.equal(
  readFileSync("LICENSE", "utf8"),
  readFileSync("skills/studai-stem/LICENSE", "utf8"),
  "Portable license differs",
);
const pkg = JSON.parse(readFileSync("package.json"));
assert.equal(pkg.license, "MIT");
assert.ok(
  readFileSync("skills/studai-stem/SKILL.md", "utf8").includes(
    `version: "${pkg.version}"`,
  ),
  "Skill version differs",
);
const notices = readFileSync(
  "skills/studai-stem/scripts/runtime/DEPENDENCY-LICENSES.txt",
  "utf8",
);
for (const name of ["react", "react-dom", "zod"])
  assert.ok(
    notices.includes(`===== ${name} =====`),
    `Missing dependency notice: ${name}`,
  );
console.log(
  JSON.stringify({
    status: "passed",
    trackedFiles: files.length,
    license: pkg.license,
    version: pkg.version,
  }),
);
