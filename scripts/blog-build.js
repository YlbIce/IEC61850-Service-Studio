const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const dir = path.join(root, "docs/blog");
const MarkdownIt = require(
  path.join(root, ".tmp/blog-tools/node_modules/markdown-it"),
);
const md = new MarkdownIt({ html: false, linkify: true }).use(
  require(path.join(root, ".tmp/blog-tools/node_modules/markdown-it-footnote")),
);
const toc = [];
md.renderer.rules.heading_open = (tokens, i) => {
  const t = tokens[i];
  if (["h2", "h3"].includes(t.tag)) {
    const text = tokens[i + 1].content,
      id = "section-" + toc.length;
    toc.push({ text, id, level: t.tag });
    return `<${t.tag} id="${id}">`;
  }
  return `<${t.tag}>`;
};
md.renderer.rules.image = (tokens, i) => {
  const t = tokens[i],
    src = md.utils.escapeHtml(t.attrGet("src")),
    alt = md.utils.escapeHtml(t.content);
  return `<a class="figure-link" href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${alt}" loading="lazy"></a><span class="caption">${alt}</span>`;
};
const text = fs.readFileSync(
  path.join(dir, "iec61850-service-studio.md"),
  "utf8",
);
const body = md.render(text);
const links = toc
  .filter((x) => x.level === "h2")
  .map((x) => `<a href="#${x.id}">${md.utils.escapeHtml(x.text)}</a>`)
  .join("");
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IEC61850 Service Studio · 工程设计与二次开发</title><style>
:root{color-scheme:light;--ink:#243644;--muted:#607181;--line:#dce4eb;--blue:#1f5b8c}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f4f6f8;color:var(--ink);font:17px/1.9 "Microsoft YaHei","PingFang SC",sans-serif}nav{position:fixed;left:0;top:0;bottom:0;width:264px;padding:32px 22px;overflow:auto;border-right:1px solid var(--line);background:#f8fafc}nav b{font-size:13px;letter-spacing:.12em;display:block;color:var(--blue);margin-bottom:24px}nav a{display:block;font-size:13px;line-height:1.65;padding:8px 0;color:#526473;text-decoration:none}nav a:hover{color:var(--blue)}main{max-width:1180px;margin:0 auto 0 264px;background:white;padding:55px 64px 90px}h1{font-size:35px;line-height:1.5;letter-spacing:-.025em;margin:0 0 32px;color:#142e44}h2{font-size:27px;line-height:1.5;border-top:1px solid var(--line);padding-top:36px;margin-top:54px;scroll-margin-top:20px}h3{font-size:21px;line-height:1.6;margin:32px 0 14px}p{margin:18px 0}a{color:var(--blue);text-underline-offset:3px}strong{font-weight:650;color:#183d5a}img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:4px;background:white}.figure-link{display:block;margin-top:30px;cursor:zoom-in}.caption{display:block;font-size:13px;line-height:1.65;color:var(--muted);margin:10px 0 28px}table{border-collapse:collapse;display:block;overflow:auto;width:100%;font-size:14px;line-height:1.75;margin:24px 0}th,td{border:1px solid var(--line);padding:13px 15px;min-width:120px;vertical-align:top}th{background:#eaf0f5;color:#173d5a;text-align:left}tr:nth-child(even){background:#f8fafc}pre{background:#f1f5f8;border:1px solid var(--line);border-radius:5px;padding:20px;overflow:auto;font-size:14px;line-height:1.65}code{font-family:Consolas,monospace;overflow-wrap:anywhere}p code,li code,td code{background:#edf2f6;padding:2px 4px;font-size:.88em}li{padding-left:4px;margin:8px 0}.footnotes{font-size:13px;line-height:1.8;overflow-wrap:anywhere}.footnote-ref{font-size:11px}em{font-size:14px;color:var(--muted)}.meta{font-size:13px;color:var(--muted);margin-bottom:24px}.top{position:fixed;right:18px;bottom:18px;background:#234f71;color:white;padding:8px 14px;text-decoration:none;border-radius:4px;font-size:13px}@media(min-width:1550px){main{margin-left:calc((100vw - 1280px)/2 + 150px)}}@media(max-width:1000px){nav{display:none}main{margin:0;padding:30px 24px;max-width:none}h1{font-size:28px}h2{font-size:24px}}@media print{nav,.top,.meta{display:none}main{margin:0;padding:0;max-width:none}body{background:white;font-size:11pt}h2{break-before:page}figure,img,pre{break-inside:avoid}a{color:inherit}table{font-size:9pt}}
</style></head><body id="top"><nav><b>SERVICE STUDIO / 技术深读</b>${links}<hr><a href="iec61850-service-studio.md">Markdown 原稿</a><a href="README.md">资料与复现说明</a></nav><main><div class="meta">源码审查 · 真实 MMS 联调 · 19 张运行截图 · 5 张架构与时序图</div>${body}</main><a class="top" href="#top">回到顶部 ↑</a></body></html>`;
fs.writeFileSync(path.join(dir, "index.html"), html);
const missing = [];
for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
  const url = match[1];
  if (!/^(https?:|#)/.test(url) && !fs.existsSync(path.resolve(dir, url)))
    missing.push(url);
}
if (missing.length) throw Error("Missing assets: " + missing.join(", "));
console.log(
  JSON.stringify({
    characters: text.length,
    images: (text.match(/!\[/g) || []).length,
    sections: toc.length,
    missing: 0,
  }),
);
