// pnpm build:jobs — 定期ジョブとマイグレーションを 1 ファイルずつにまとめる（ADR 0035・X-02）
// 出力は dist/jobs/*.mjs。本番のジョブ用イメージはこれと PostgreSQL のクライアントだけを持つ（tsx も node_modules も入れない）
// 新しい依存は足さない: esbuild は tsx が使っているものと同じ
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// まとめる入口（出力の名前 → 入口のファイル）。mail-test.ts は開発用なので入れない
const ENTRIES = {
  mail: "src/jobs/mail.ts",
  daily: "src/jobs/daily.ts",
  migrate: "src/db/scripts/migrate.ts",
};

// まとめられないもの。pg が「あれば使う」形で読むネイティブのモジュール（入れていないので、読もうとしない形で外に出す）
const EXTERNAL = ["pg-native"];

// tsconfig.json の paths（@/* → ./src/*）を esbuild に渡す
async function aliasFromTsconfig() {
  const text = await readFile(path.join(root, "tsconfig.json"), "utf8");
  // コメントのない素の JSON（この tsconfig はコメントを使っていない）
  const paths = JSON.parse(text).compilerOptions?.paths ?? {};
  const alias = {};
  for (const [from, [to]] of Object.entries(paths)) {
    alias[from.replace(/\/\*$/, "")] = path.join(root, to.replace(/\/\*$/, ""));
  }
  return alias;
}

// ESM にまとめると、中の CJS のモジュールが使う require・__dirname がなくなるので足す
const BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __dirname_of } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "const __filename = __fileURLToPath(import.meta.url);",
  "const __dirname = __dirname_of(__filename);",
].join("\n");

const outdir = path.join(root, "dist/jobs");
await rm(outdir, { recursive: true, force: true });

const result = await build({
  entryPoints: Object.fromEntries(Object.entries(ENTRIES).map(([name, entry]) => [name, path.join(root, entry)])),
  outdir,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  // .nvmrc と同じ（Node.js 24）
  target: "node24",
  sourcemap: false,
  minify: false,
  external: EXTERNAL,
  alias: await aliasFromTsconfig(),
  banner: { js: BANNER },
  logLevel: "info",
  metafile: true,
});

for (const [file, output] of Object.entries(result.metafile.outputs)) {
  console.log(`${path.relative(root, file)}: ${(output.bytes / 1024).toFixed(0)} KB`);
}
