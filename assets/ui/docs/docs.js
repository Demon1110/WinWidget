"use strict";
/* The developer guide reader. The host sends the Markdown text; this renders the subset the
   guide uses (headings, paragraphs, lists, tables, code, links, bold) and builds the contents. */

const host = window.chrome && window.chrome.webview;
const $ = (id) => document.getElementById(id);
/** The few words of the reader itself, in the guide's language. */
const WORDS = {
  "zh-TW": { copy: "複製", copied: "已複製", toc: "目錄" },
  "zh-CN": { copy: "复制", copied: "已复制", toc: "目录" },
  en: { copy: "Copy", copied: "Copied", toc: "Contents" },
};
let words = WORDS["zh-TW"];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** GitHub-style heading anchors: "外觀：跟着主題走" → "外觀跟着主題走", "JavaScript API" → "javascript-api". */
const slug = (text) => text.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\- _]/gu, "").replace(/ /g, "-");

function inline(text) {
  // code spans first, so nothing inside them is touched
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
}

const plain = (text) => text.replace(/`([^`]+)`/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

function render(md) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const isTable = (l) => /^\s*\|.*\|\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const code = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      out.push(`<div class="code"><button class="copy" type="button">${words.copy}</button><pre data-lang="${esc(fence[1])}"><code>${esc(code.join("\n"))}</code></pre></div>`);
      continue;
    }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const n = h[1].length;
      out.push(`<h${n} id="${esc(slug(plain(h[2])))}">${inline(h[2])}</h${n}>`);
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

    if (isTable(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTable(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m) { items.push(m[3]); i++; continue; }
        // a wrapped line belongs to the item above
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1] += " " + lines[i].trim(); i++; continue; }
        break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }

    // paragraph: lines until a blank line or another block; a line break stays a line break
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|---+\s*$|\s*([-*]|\d+\.)\s)/.test(lines[i]) && !isTable(lines[i])) para.push(lines[i++]);
    out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return out.join("\n");
}

function show(md) {
  const doc = $("doc");
  doc.innerHTML = render(md);

  // The guide's own contents list (for readers without this page) is replaced by the sidebar.
  const first = doc.querySelector("h1 + p + ul, h1 + ul");
  if (first && [...first.querySelectorAll("li")].every((li) => li.children.length === 1 && li.firstElementChild.matches('a[href^="#"]'))) first.remove();

  const heads = [...doc.querySelectorAll("h2")];
  const title = doc.querySelector("h1");
  $("toc").innerHTML = `<div class="toc-title">${title ? esc(title.textContent) : ""}</div>` +
    heads.map((h) => `<a href="#${h.id}" data-id="${h.id}">${esc(h.textContent)}</a>`).join("");
  if (title) document.title = title.textContent;
  follow(heads);
}

/** Highlights the section being read. */
function follow(heads) {
  const links = new Map([...document.querySelectorAll(".toc a")].map((a) => [a.dataset.id, a]));
  const page = $("page");
  const update = () => {
    let current = heads[0];
    for (const h of heads) if (h.offsetTop - page.scrollTop < 120) current = h;
    links.forEach((a, id) => a.classList.toggle("on", current && id === current.id));
  };
  page.addEventListener("scroll", update, { passive: true });
  update();
}

document.addEventListener("click", (e) => {
  const copy = e.target.closest(".copy");
  if (copy) {
    const text = copy.nextElementSibling.textContent;
    navigator.clipboard.writeText(text).then(() => {
      copy.textContent = words.copied;
      copy.classList.add("done");
      setTimeout(() => { copy.textContent = words.copy; copy.classList.remove("done"); }, 1600);
    });
    return;
  }
  const a = e.target.closest('a[href^="#"]');
  if (a) {
    e.preventDefault();
    const target = document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)));
    if (target) $("page").scrollTo({ top: target.offsetTop - 24, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
});

if (host) {
  host.addEventListener("message", (e) => { if (e.data && e.data.ev === "doc") { words = WORDS[e.data.lang] || words; document.documentElement.lang = e.data.lang === "en" ? "en" : "zh"; $("toc").setAttribute("aria-label", words.toc); show(e.data.d); } });
  host.postMessage({ m: "ready" });
}
