import { build } from "esbuild";
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
const out = "skills/studai-stem/scripts/runtime";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["src/browser.jsx"],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  outfile: `${out}/browser.js`,
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "external",
});
await build({
  entryPoints: ["src/cli.jsx"],
  bundle: true,
  minify: false,
  format: "esm",
  platform: "node",
  target: ["node22"],
  outfile: `${out}/cli.mjs`,
  define: { "process.env.NODE_ENV": '"production"' },
  banner: {
    js: 'import {createRequire as __createRequire} from "node:module"; const require=__createRequire(import.meta.url);',
  },
  legalComments: "external",
});
await copyFile("src/style.css", `${out}/style.css`);
// Bundled code remains distributable without npm; include dependency licenses.
let licenses = "";
for (const name of ["react", "react-dom", "zod"]) {
  try {
    licenses +=
      `\n===== ${name} =====\n` +
      (await readFile(`node_modules/${name}/LICENSE`, "utf8"));
  } catch {}
}
await writeFile(`${out}/DEPENDENCY-LICENSES.txt`, licenses);
console.log("Built self-contained Node CLI and offline browser renderer.");
