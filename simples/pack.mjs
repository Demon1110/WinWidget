// 把 simples/src/<组件>/ 打包成 simples/packages/<组件>-<版本>.fwz。
//
// 这个脚本只服务于手工真机测试：产物放 simples/packages，不进 assets\
// 也就是不会被 build.rs 编进 winwidget.exe（见 simples/README.md）。
//
// 用法：
//   node simples/pack.mjs            写入 .fwz
//   node simples/pack.mjs --check    只核对已提交的产物与源码是否一致
import fs from "node:fs";
import path from "node:path";
import { makeZip } from "./lib/zip.mjs";

const HERE = path.resolve(import.meta.dirname);
const SRC = path.join(HERE, "src");
const OUT = path.join(HERE, "packages");
const check = process.argv.includes("--check");

function walk(dir, base = dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, base));
    else if (entry.isFile()) files.push({ rel: path.relative(base, full).replace(/\\/g, "/"), full });
  }
  return files;
}

function pack(folder) {
  const dir = path.join(SRC, folder);
  const manifestPath = path.join(dir, "widget.json");
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const version = String(manifest.version || "0.0.0").trim();
  const files = walk(dir)
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map((f) => ({ name: `${folder}/${f.rel}`, data: fs.readFileSync(f.full) }));
  const archive = makeZip(files);
  return { folder, version, file: `${folder}-${version}.fwz`, archive };
}

if (!fs.existsSync(SRC)) {
  console.error(`缺少源码目录：${SRC}`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const built = [];
for (const folder of fs.readdirSync(SRC).sort()) {
  if (!fs.statSync(path.join(SRC, folder)).isDirectory()) continue;
  const result = pack(folder);
  if (!result) {
    console.warn(`  ! ${folder} 没有 widget.json，跳过`);
    continue;
  }
  const target = path.join(OUT, result.file);
  const existing = fs.existsSync(target) ? fs.readFileSync(target) : null;
  const same = existing && existing.length === result.archive.length && existing.equals(result.archive);
  if (check) {
    if (!same) {
      console.error(`  ✗ ${result.file} 与源码不一致，跑一次 node simples/pack.mjs`);
      process.exitCode = 1;
    } else {
      console.log(`  ✓ ${result.file}`);
    }
    continue;
  }
  if (!same) fs.writeFileSync(target, result.archive);
  built.push(result.file);

  for (const old of fs.readdirSync(OUT)) {
    if (!old.endsWith(".fwz")) continue;
    if (old.startsWith(`${folder}-`) && old !== result.file) {
      fs.unlinkSync(path.join(OUT, old));
      console.log(`  - 删除旧包 ${old}`);
    }
  }
  console.log(`  ✓ packages/${result.file}  ${(result.archive.length / 1024).toFixed(1)} KB`);
}

if (check) {
  console.log("✓ simples 打包产物是最新的");
} else {
  console.log(`✓ ${built.length} 个测试组件已打包到 simples/packages`);
}
