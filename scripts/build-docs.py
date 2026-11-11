#!/usr/bin/env python3
"""Build the widget developer guide into one self-contained HTML file.

The source of truth is Markdown in the repository's `docs/` folder — repository
material that never ships, so it stays out of `assets/` (everything under
`assets/` is compressed into the exe by build.rs):

    docs/組件開發指南.md     (Traditional Chinese, written by hand)
    docs/widget-guide.en.md  (English, written by hand)

This script converts the Traditional text to Simplified Chinese (zhconv plus a
term table, because a character-by-character conversion turns 資料夾 into 资料夹),
renders all three languages to HTML, and writes

    assets/docs/developer-guide.html   the guide you double-click
    assets/docs/index.html             the same file, so /__docs/ works in the app

The two generated files stay under `assets/` because the app serves them; the
Markdown sources and milestone screenshots do not, so the binary keeps only what
it actually shows.

Everything is inlined: no images to fetch, no CSS to load, no markdown parser at
runtime, so it opens with a plain file:// double-click and with no network.

Usage:  python scripts/build-docs.py

Needs `zhconv` (pip install zhconv) for the Traditional -> Simplified pass; without
it the script stops before writing anything, so a half-converted guide never ships.

The Release workflow runs this and then checks that `assets/docs` has no diff, so a
source edit that forgot to regenerate fails there instead of shipping stale docs.
"""

import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "docs"                       # hand-written sources, not shipped
DOCS = ROOT / "assets" / "docs"           # generated pages the app serves
ZH_TW = SRC / "組件開發指南.md"
EN = SRC / "widget-guide.en.md"
ZH_CN = SRC / "組件開發指南.zh-CN.md"
OUT_HTML = DOCS / "developer-guide.html"
OUT_INDEX = DOCS / "index.html"

# Character-level conversion leaves Taiwanese vocabulary behind; these are the
# words this guide actually uses, mapped to what a Simplified reader expects.
# Longest first, so 檔案總管 wins over 檔案: see simplify().
TERMS = [
    ("檔案總管", "资源管理器"),
    ("說明檔", "说明文件"),
    ("存檔", "保存"),
    ("應用程式", "应用"),
    ("重新載入", "重新加载"),
    ("快捷鍵", "快捷键"),
    ("識別碼", "标识"),
    ("記憶體", "内存"),
    ("處理器", "处理器"),
    ("資料夾", "文件夹"),
    ("設定項", "设置项"),
    ("系統匣", "系统托盘"),
    ("連結", "链接"),
    ("網址", "网址"),
    ("網路", "网络"),
    ("檔案", "文件"),
    ("資料", "数据"),
    ("設定", "设置"),
    ("選單", "菜单"),
    ("清單", "列表"),
    ("除錯", "调试"),
    ("視窗", "窗口"),
    ("載入", "加载"),
    ("儲存", "保存"),
    ("預設", "默认"),
    ("程式", "程序"),
    ("執行", "执行"),
    ("滑鼠", "鼠标"),
    ("螢幕", "屏幕"),
    ("硬碟", "硬盘"),
    ("磁碟", "磁盘"),
    ("資訊", "信息"),
    ("介面", "界面"),
    ("支援", "支持"),
    ("使用者", "用户"),
    ("匯出", "导出"),
    ("匯入", "导入"),
    ("啟用", "启用"),
    ("圖示", "图标"),
    ("顏色", "颜色"),
    ("樣式", "样式"),
    ("邊框", "边框"),
    ("圓角", "圆角"),
    ("陰影", "阴影"),
    ("字體", "字体"),
    ("字號", "字号"),
    ("內距", "内边距"),
    ("按鈕", "按钮"),
    ("輸入框", "输入框"),
    ("滑桿", "滑块"),
    ("進度", "进度"),
    ("權限", "权限"),
    ("熱鍵", "热键"),
    ("開發者", "开发者"),
    ("開發", "开发"),
    ("組件", "组件"),
    ("實例", "实例"),
    ("連接埠", "端口"),
]


def simplify(text: str) -> str:
    """Traditional source -> Simplified, phrase by phrase before characters.

    A character conversion turns 資料夾 into 资料夹; the term table has to run
    first, on the Traditional text, or its keys no longer match.
    """
    for tw, cn in sorted(TERMS, key=lambda pair: len(pair[0]), reverse=True):
        text = text.replace(tw, cn)
    import zhconv

    return zhconv.convert(text, "zh-cn")


# --------------------------------------------------------------------------- #
# Markdown -> HTML
# --------------------------------------------------------------------------- #

SLUG_DROP = re.compile(r"[^\w\- ]", re.UNICODE)


def slug(text: str) -> str:
    """GitHub-style anchor: the same ids the Markdown's own links point at."""
    text = re.sub(r"`", "", text)
    text = re.sub(r"\*\*|__", "", text)
    text = text.strip().lower()
    text = SLUG_DROP.sub("", text)
    return text.replace(" ", "-")


def inline(text: str) -> str:
    """Escape HTML, then the handful of inline constructs the guide uses."""
    out = []
    i = 0
    # Split on code spans first so nothing inside them gets rewritten.
    for part in re.split(r"(`[^`]+`)", text):
        if part.startswith("`") and part.endswith("`") and len(part) > 2:
            out.append("<code>%s</code>" % html.escape(part[1:-1]))
            continue
        s = html.escape(part)
        s = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)\)", r'<img alt="\1" src="\2">', s)
        s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2">\1</a>', s)
        s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"(?<![\w*])_([^_]+)_(?![\w*])", r"<em>\1</em>", s)
        out.append(s)
    return "".join(out)


def split_row(line: str) -> list:
    """Split a table row on unescaped pipes, ignoring pipes inside code spans."""
    cells, current, in_code, i = [], "", False, 0
    while i < len(line):
        ch = line[i]
        if ch == "`":
            in_code = not in_code
        if ch == "|" and not in_code:
            cells.append(current)
            current = ""
        elif ch == "\\" and i + 1 < len(line) and line[i + 1] == "|":
            current += "|"
            i += 1
        else:
            current += ch
        i += 1
    cells.append(current)
    if cells and not cells[0].strip():
        cells = cells[1:]
    if cells and not cells[-1].strip():
        cells = cells[:-1]
    return cells


def render(md: str) -> tuple:
    """Return (html body, [(level, title, anchor)]) for the sidebar."""
    lines = md.split("\n")
    body = []
    toc = []
    i = 0
    in_list = False
    while i < len(lines):
        line = lines[i]

        # fenced code
        if line.startswith("```"):
            lang = line[3:].strip()
            i += 1
            code = []
            while i < len(lines) and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1
            cls = ' class="lang-%s"' % html.escape(lang) if lang else ""
            body.append(
                '<div class="code"><pre><code%s>%s</code></pre></div>'
                % (cls, html.escape("\n".join(code)))
            )
            continue

        # heading
        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            if in_list:
                body.append("</ul>")
                in_list = False
            level, title = len(m.group(1)), m.group(2).strip()
            anchor = slug(title)
            body.append(
                '<h%d id="%s">%s</h%d>'
                % (level, anchor, inline(title), level)
            )
            if level == 2:
                toc.append((2, title, anchor))
            elif level == 3:
                toc.append((3, title, anchor))
            i += 1
            continue

        # horizontal rule
        if re.match(r"^-{3,}$", line.strip()) or re.match(r"^\*{3,}$", line.strip()):
            if in_list:
                body.append("</ul>")
                in_list = False
            body.append('<hr class="sep">')
            i += 1
            continue

        # table
        if line.strip().startswith("|") and i + 1 < len(lines) and re.match(
            r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]
        ):
            header = split_row(line)
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(split_row(lines[i]))
                i += 1
            out = ['<div class="table-wrap"><table><thead><tr>']
            out += ["<th>%s</th>" % inline(c.strip()) for c in header]
            out.append("</tr></thead><tbody>")
            for r in rows:
                out.append("<tr>")
                out.append(
                    "".join("<td>%s</td>" % inline(c.strip()) for c in r)
                )
                out.append("</tr>")
            out.append("</tbody></table></div>")
            body.append("".join(out))
            continue

        # lists (including the guide's own "table of contents" list, which the
        # sidebar replaces)
        lm = re.match(r"^(\s*)(-|\*)\s+(.*)$", line)
        nm = re.match(r"^(\s*)(\d+)\.\s+(.*)$", line)
        if lm or nm:
            if lm:
                indent, text = len(lm.group(1)), lm.group(3)
            else:
                indent, text = len(nm.group(1)), nm.group(3)
            if not in_list:
                body.append('<ul class="plain">')
                in_list = True
            # nested items get a marker rather than a second <ul>, so the
            # layout stays predictable in narrow cards
            body.append('<li class="nested">%s</li>' % inline(text) if indent >= 2 else "<li>%s</li>" % inline(text))
            i += 1
            continue

        if in_list:
            body.append("</ul>")
            in_list = False

        # blockquote
        if line.startswith(">"):
            body.append("<blockquote>%s</blockquote>" % inline(line[1:].strip()))
            i += 1
            continue

        # blank line
        if not line.strip():
            i += 1
            continue

        # paragraph
        para = [line.strip()]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(
            r"^(#{1,4}\s|```|\||- |\* |\d+\. |> )", lines[i]
        ):
            para.append(lines[i].strip())
            i += 1
        body.append("<p>%s</p>" % inline(" ".join(para)))

    if in_list:
        body.append("</ul>")
    return "\n".join(body), toc


# --------------------------------------------------------------------------- #
# Page
# --------------------------------------------------------------------------- #

PAGE = """<!doctype html>
<html lang="%(lang)s">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%(title)s</title>
<style>
:root {
  --fg: #1d2129; --fg-muted: #5a6472; --fg-faint: #8b94a3;
  --bg: #fbfbfd; --panel: #ffffff; --line: #e3e6ec; --accent: #2f6fd8;
  --code-bg: #f4f6fa; --code-fg: #2a3140; --tag: #eef2fa;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fg: #e6e9ef; --fg-muted: #a7b0bf; --fg-faint: #7b8494;
    --bg: #16181d; --panel: #1d2026; --line: #2c313a; --accent: #7aa8ff;
    --code-bg: #22262e; --code-fg: #dde3ee; --tag: #262b34;
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.75 "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

header.top {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 12px 24px; background: color-mix(in srgb, var(--panel) 92%%, transparent);
  border-bottom: 1px solid var(--line); backdrop-filter: blur(12px);
}
header.top .brand { font-weight: 600; font-size: 15px; letter-spacing: .01em; }
header.top .brand span { color: var(--fg-muted); font-weight: 400; margin-left: 8px; }
.spacer { flex: 1; }
.langs { display: flex; gap: 4px; padding: 3px; background: var(--tag); border-radius: 8px; }
.langs button {
  border: 0; background: transparent; color: var(--fg-muted); cursor: pointer;
  padding: 5px 11px; border-radius: 6px; font: inherit; font-size: 13px;
}
.langs button[aria-pressed="true"] { background: var(--panel); color: var(--fg); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.search {
  width: 220px; padding: 6px 10px; font: inherit; font-size: 13px;
  color: var(--fg); background: var(--tag); border: 1px solid transparent;
  border-radius: 8px; outline: none;
}
.search:focus { border-color: var(--accent); background: var(--panel); }

.layout { display: flex; align-items: flex-start; max-width: 1180px; margin: 0 auto; padding: 0 24px 80px; }
nav.side {
  position: sticky; top: 64px; width: 250px; flex: 0 0 250px;
  max-height: calc(100vh - 80px); overflow: auto; padding: 22px 14px 22px 0;
  font-size: 13px;
}
nav.side h2 { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--fg-faint); margin: 0 0 10px; font-weight: 600; }
nav.side a { display: block; padding: 4px 8px; border-radius: 6px; color: var(--fg-muted); }
nav.side a:hover { background: var(--tag); color: var(--fg); text-decoration: none; }
nav.side a.sub { padding-left: 22px; font-size: 12.5px; color: var(--fg-faint); }
nav.side a.hit { color: var(--accent); }

main { flex: 1; min-width: 0; padding: 22px 0 0 30px; }
article { max-width: 820px; }
article h1 { font-size: 26px; line-height: 1.3; margin: 6px 0 14px; }
article h1, article h2, article h3, article h4 { scroll-margin-top: 74px; }
article h2 { font-size: 19px; margin: 38px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
article h3 { font-size: 16px; margin: 26px 0 8px; }
article h4 { font-size: 15px; margin: 20px 0 6px; }
article p { margin: 10px 0; }
article ul.plain { margin: 8px 0; padding-left: 22px; }
article li { margin: 4px 0; }
article li.nested { margin-left: 20px; list-style: disc; opacity: .92; }
blockquote { margin: 12px 0; padding: 8px 14px; border-left: 3px solid var(--accent); background: var(--tag); border-radius: 0 8px 8px 0; color: var(--fg-muted); }
hr.sep { border: 0; border-top: 1px solid var(--line); margin: 34px 0; }

code { font: 13px/1.6 "Cascadia Code", Consolas, "SF Mono", monospace; background: var(--code-bg); color: var(--code-fg); padding: 1px 5px; border-radius: 5px; }
.code { position: relative; margin: 12px 0; }
.code pre {
  margin: 0; padding: 13px 14px; background: var(--code-bg); border: 1px solid var(--line);
  border-radius: 10px; overflow: auto; font: 13px/1.65 "Cascadia Code", Consolas, "SF Mono", monospace;
  tab-size: 2;
}
.code pre code { background: none; padding: 0; color: var(--code-fg); }
.copy {
  position: absolute; top: 7px; right: 7px; border: 1px solid var(--line);
  background: var(--panel); color: var(--fg-muted); border-radius: 6px;
  padding: 3px 8px; font: inherit; font-size: 11px; cursor: pointer; opacity: 0; transition: opacity .15s;
}
.code:hover .copy { opacity: 1; }
.copy.done { color: var(--accent); border-color: var(--accent); }

.table-wrap { overflow-x: auto; margin: 12px 0; }
table { border-collapse: collapse; width: 100%%; font-size: 13.5px; }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: var(--tag); font-weight: 600; }
tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--tag) 45%%, transparent); }
img { max-width: 100%%; border-radius: 8px; }

footer { max-width: 820px; margin: 40px 0 0; padding-top: 18px; border-top: 1px solid var(--line); color: var(--fg-faint); font-size: 12.5px; }

@media (max-width: 900px) {
  nav.side { display: none; }
  main { padding-left: 0; }
  header.top { padding: 10px 16px; }
  .search { width: 150px; }
}
@media print {
  header.top, nav.side, .copy { display: none; }
  body { background: #fff; }
}
</style>
</head>
<body>

<header class="top">
  <div class="brand">WinWidget<span>%(subtitle)s</span></div>
  <div class="spacer"></div>
  <input class="search" id="search" type="search" placeholder="%(search_hint)s" autocomplete="off">
  <div class="langs" id="langs">
    %(lang_buttons)s
  </div>
</header>

<div class="layout">
  <nav class="side" id="side">
    <h2>%(nav_title)s</h2>
    %(nav)s
  </nav>
  <main>
    %(articles)s
  </main>
</div>

<script>
(function () {
  var langs = Array.prototype.slice.call(document.querySelectorAll('#langs button'));
  var articles = Array.prototype.slice.call(document.querySelectorAll('article[data-lang]'));
  var side = document.getElementById('side');

  function tocFor(lang) {
    var nav = side.querySelector('div[data-lang="' + lang + '"]');
    return nav;
  }

  function show(lang) {
    articles.forEach(function (a) { a.hidden = a.dataset.lang !== lang; });
    Array.prototype.slice.call(side.querySelectorAll('div[data-lang]')).forEach(function (d) {
      d.hidden = d.dataset.lang !== lang;
    });
    langs.forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    });
    document.documentElement.lang = lang;
    try { localStorage.setItem('ww-docs-lang', lang); } catch (e) {}
    // Opening the file as .../developer-guide.html#some-heading should land on
    // that heading even though the article only became visible just now.
    if (location.hash) {
      var target = document.querySelector(location.hash.replace(/[%%"]/g, ''));
      if (target) { target.scrollIntoView(); }
    }
  }

  langs.forEach(function (b) {
    b.addEventListener('click', function () { show(b.dataset.lang); });
  });

  var wanted = null;
  try { wanted = localStorage.getItem('ww-docs-lang'); } catch (e) {}
  if (!wanted) {
    wanted = (navigator.language || '').toLowerCase().indexOf('en') === 0 ? 'en'
      : (navigator.language || '').toLowerCase() === 'zh-tw' ? 'zh-TW' : 'zh-CN';
  }
  if (!articles.some(function (a) { return a.dataset.lang === wanted; })) wanted = 'zh-CN';
  show(wanted);

  // copy buttons: navigator.clipboard needs a secure origin, and file:// is not
  document.querySelectorAll('.code').forEach(function (box) {
    var btn = document.createElement('button');
    btn.className = 'copy';
    btn.textContent = 'COPY';
    btn.addEventListener('click', function () {
      var text = box.querySelector('code').textContent;
      var done = function () {
        btn.textContent = 'OK';
        btn.classList.add('done');
        setTimeout(function () { btn.textContent = 'COPY'; btn.classList.remove('done'); }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) {}
        document.body.removeChild(ta);
      }
    });
    box.appendChild(btn);
  });

  // sidebar filter
  var search = document.getElementById('search');
  search.addEventListener('input', function () {
    var q = search.value.trim().toLowerCase();
    var current = side.querySelector('div[data-lang]:not([hidden])');
    if (!current) return;
    current.querySelectorAll('a').forEach(function (a) {
      var hit = !q || a.textContent.toLowerCase().indexOf(q) >= 0;
      a.style.display = hit ? '' : 'none';
      a.classList.toggle('hit', Boolean(q) && hit);
    });
  });
  search.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var current = side.querySelector('div[data-lang]:not([hidden])');
    if (!current) return;
    var first = Array.prototype.slice.call(current.querySelectorAll('a'))
      .filter(function (a) { return a.style.display !== 'none'; })[0];
    if (first) { location.hash = first.getAttribute('href').slice(1); }
  });
})();
</script>
</body>
</html>
"""


def build() -> int:
    zh_tw_md = ZH_TW.read_text(encoding="utf-8")
    en_md = EN.read_text(encoding="utf-8")
    try:
        zh_cn_md = simplify(zh_tw_md)
    except ImportError:
        print("zhconv is missing: pip install zhconv", file=sys.stderr)
        return 1

    # Keep the Simplified Markdown on disk as well, so the docs folder and the
    # HTML never disagree about what the text is.
    header = (
        "<!-- 由 scripts/build-docs.py 从 組件開發指南.md 生成，请改源文件后重新生成。 -->\n\n"
    )
    ZH_CN.write_text(header + zh_cn_md.lstrip("\ufeff"), encoding="utf-8", newline="")

    langs = [
        ("zh-CN", "简体", "组件开发指南", zh_cn_md, "· 简体中文"),
        ("zh-TW", "繁體", "組件開發指南", zh_tw_md, "· 繁體中文"),
        ("en", "English", "Widget development guide", en_md, "· English"),
    ]

    articles, navs, buttons = [], [], []
    for code, label, title, md, subtitle in langs:
        body, toc = render(md)
        # Drop the Markdown's own table-of-contents list: the sidebar carries it.
        body = re.sub(
            r'<ul class="plain">((?:\s*<li><a href="#[^"]*">[^<]*</a></li>)+)\s*</ul>',
            "",
            body,
            count=1,
        )
        articles.append(
            '<article data-lang="%s" lang="%s" hidden>\n%s\n</article>' % (code, code, body)
        )
        items = []
        for level, text, anchor in toc:
            # strip inline markers for the label
            plain = re.sub(r"`|\*\*", "", text)
            items.append(
                '<a%s href="#%s" data-anchor="%s">%s</a>'
                % (" class=\"sub\"", anchor, anchor, html.escape(plain))
                if level == 3
                else '  <a href="#%s" data-anchor="%s">%s</a>'
                % (anchor, anchor, html.escape(plain))
            )
        navs.append(
            '<div data-lang="%s" hidden>\n%s\n</div>' % (code, "\n".join(items))
        )
        buttons.append(
            '<button data-lang="%s" aria-pressed="false">%s</button>' % (code, label)
        )

    page = PAGE % {
        "lang": "zh-CN",
        "title": "WinWidget 组件开发指南",
        "subtitle": "· 组件开发指南",
        "search_hint": "搜索目录…",
        "nav_title": "目录",
        "nav": "\n".join(navs),
        "articles": "\n".join(articles),
        "lang_buttons": "\n    ".join(buttons),
    }
    OUT_HTML.write_text(page, encoding="utf-8", newline="")
    OUT_INDEX.write_text(page, encoding="utf-8", newline="")
    size = OUT_HTML.stat().st_size
    print("wrote %s (%d KB) and %s" % (OUT_HTML.name, size // 1024, OUT_INDEX.name))
    print("zh-TW %d chars, zh-CN %d chars, en %d chars" % (len(zh_tw_md), len(zh_cn_md), len(en_md)))
    return 0


if __name__ == "__main__":
    sys.exit(build())
