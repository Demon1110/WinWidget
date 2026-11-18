const $ = (id) => document.getElementById(id);
const t = widget.t;
const L = (tw, cn, en) => t({ "zh-TW": tw, "zh-CN": cn, en });

let info = null;
let events = [];
let loading = false;
let timer = 0;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const repoName = () => String(widget.settings.get("repo") || "rust-lang/rust").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
const refreshMin = () => Math.max(5, Math.round(Number(widget.settings.get("refresh")) || 15));
const count = () => Math.max(3, Math.round(Number(widget.settings.get("count")) || 6));

function ago(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return L("剛剛", "刚刚", "just now");
  if (mins < 60) return L(`${mins} 分鐘前`, `${mins} 分钟前`, `${mins}m ago`);
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return L(`${hrs} 小時前`, `${hrs} 小时前`, `${hrs}h ago`);
  const days = Math.round(hrs / 24);
  return L(`${days} 天前`, `${days} 天前`, `${days}d ago`);
}

const ICONS = {
  push: `<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="9" r="2"/><path d="M6 8v8M6 8c0 4 4 3 9 1"/></svg>`,
  issue: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M12 9v6M12 17.2v.1"/></svg>`,
  pr: `<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="16" r="2"/><path d="M6 8v8M14 6h2a2 2 0 0 1 2 2v6"/></svg>`,
  release: `<svg viewBox="0 0 24 24"><path d="M12 4.5 14 10l5.5 1.6-4 3.8.9 5.6L12 18l-4.4 3 .9-5.6-4-3.8L10 10z"/></svg>`,
  other: `<svg viewBox="0 0 24 24"><circle cx="7" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="17" cy="12" r="1.6"/></svg>`,
};

function describe(e) {
  const p = e.payload || {};
  const who = (e.actor && e.actor.login) || "someone";
  switch (e.type) {
    case "PushEvent": {
      const n = (p.commits && p.commits.length) || Number(p.size) || 0;
      const head = p.commits && p.commits.length ? p.commits[0].message.split("\n")[0] : (p.ref || "").replace("refs/heads/", "");
      return { icon: "push", text: L(`${who} 推了 ${n} 個提交`, `${who} 推了 ${n} 个提交`, `${who} pushed ${n} commit${n === 1 ? "" : "s"}`), sub: head };
    }
    case "IssuesEvent": {
      const act = p.action === "closed" ? L("關閉", "关闭", "closed") : p.action === "opened" ? L("開", "开", "opened") : L("更新", "更新", "updated");
      return { icon: "issue", text: `${who} ${act} #${p.issue ? p.issue.number : "?"}`, sub: p.issue ? p.issue.title : "" };
    }
    case "PullRequestEvent": {
      const act = p.action === "closed" ? (p.pull_request && p.pull_request.merged ? L("合併", "合并", "merged") : L("關閉", "关闭", "closed"))
        : p.action === "opened" ? L("開", "开", "opened") : L("更新", "更新", "updated");
      return { icon: "pr", text: `${who} ${act} PR #${p.pull_request ? p.pull_request.number : "?"}`, sub: p.pull_request ? p.pull_request.title : "" };
    }
    case "PullRequestReviewEvent":
      return { icon: "pr", text: `${who} ${L("審了", "审了", "reviewed")} PR`, sub: p.pull_request ? p.pull_request.title : "" };
    case "IssueCommentEvent":
      return { icon: "issue", text: `${who} ${L("回覆了", "回复了", "commented on")} #${p.issue ? p.issue.number : "?"}`, sub: p.issue ? p.issue.title : "" };
    case "ReleaseEvent":
      return { icon: "release", text: `${who} ${L("發佈了", "发布了", "published")} ${p.release ? p.release.tag_name : ""}`, sub: p.release ? p.release.name : "" };
    case "CreateEvent":
      return { icon: "other", text: `${who} ${L("建立了", "建立了", "created")} ${p.ref_type || ""} ${p.ref || ""}`, sub: "" };
    case "WatchEvent":
      return { icon: "other", text: `${who} ${L("加了星標", "加了星标", "starred the repo")}`, sub: "" };
    case "ForkEvent":
      return { icon: "other", text: `${who} ${L("fork 了一份", "fork 了一份", "forked it")}`, sub: "" };
    default:
      return { icon: "other", text: `${who} ${String(e.type || "").replace(/Event$/, "")}`, sub: "" };
  }
}

function render() {
  const repo = repoName();
  $("repo").textContent = repo;
  if (info) {
    $("meta").textContent = `★ ${Number(info.stargazers_count || 0)} · ${L("議題", "议题", "issues")} ${Number(info.open_issues_count || 0)}`;
  }

  if (!events.length) {
    $("list").innerHTML = `<li class="empty">${esc(loading ? L("讀取中…", "读取中…", "Loading…") : L("還沒有動態", "还没有动态", "Nothing yet"))}</li>`;
    return;
  }

  $("list").innerHTML = events.slice(0, count()).map((e, i) => {
    const d = describe(e);
    const sub = d.sub ? `<span class="s">${esc(String(d.sub).slice(0, 70))}</span>` : "";
    return `<li class="row" data-i="${i}" title="${esc(e.type || "")}">
      <span class="ico">${ICONS[d.icon] || ICONS.other}</span>
      <span class="txt"><span class="a">${esc(d.text)}</span>${sub}</span>
      <span class="t">${esc(ago(e.created_at))}</span>
    </li>`;
  }).join("");
}

async function load() {
  if (loading) return;
  const repo = repoName();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    $("hint").textContent = L("倉庫名要像 owner/repo", "仓库名要像 owner/repo", "Repo should look like owner/repo");
    return;
  }
  loading = true;
  $("refresh").classList.add("is-busy");
  $("hint").textContent = L("讀取中…", "读取中…", "Loading…");
  try {
    const [meta, list] = await Promise.all([
      widget.fetch(`https://api.github.com/repos/${repo}`, { headers: { Accept: "application/vnd.github+json" } }).then((r) => (r.ok ? r.json() : null)),
      widget.fetch(`https://api.github.com/repos/${repo}/events?per_page=30`, { headers: { Accept: "application/vnd.github+json" } }),
    ]);
    if (!list.ok) throw new Error(`HTTP ${list.status}`);
    info = meta;
    const arr = await list.json();
    events = Array.isArray(arr) ? arr : [];
    $("hint").textContent = L(`更新於 ${new Date().toLocaleTimeString()}`, `更新于 ${new Date().toLocaleTimeString()}`, `Updated ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    const msg = String(e.message || e);
    $("hint").textContent = /403|429/.test(msg)
      ? L("GitHub 限流了，過一會再試", "GitHub 限流了，过一会再试", "GitHub rate limit hit — try later")
      : L(`取不到資料：${msg}`, `取不到数据：${msg}`, `Couldn't load: ${msg}`);
  } finally {
    loading = false;
    $("refresh").classList.remove("is-busy");
    render();
  }
}

function schedule() {
  clearInterval(timer);
  timer = setInterval(load, refreshMin() * 60000);
}

$("refresh").onclick = load;
$("list").onclick = (e) => {
  const row = e.target.closest(".row");
  if (!row) return;
  const ev = events[Number(row.dataset.i)];
  if (ev) widget.shell.open(`https://github.com/${repoName()}`).catch(() => {});
};

widget.settings.onChange(() => { render(); schedule(); load(); });

render();
load();
schedule();
widget.on("unload", () => clearInterval(timer));
widget.on("summon", load);
