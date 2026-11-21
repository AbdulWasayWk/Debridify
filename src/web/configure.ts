import { ALL_RESOLUTIONS, DEFAULT_CONFIG, env, QUALITY_GROUPS, type UserConfig } from "../config.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const configurePage = (current: UserConfig, hasEnvKey: boolean) => {
	const checks = (name: string, values: readonly string[], selected: string[]) =>
		values
			.map(
				(v) =>
					`<label class="chip"><input type="checkbox" name="${name}" value="${v}" ${selected.includes(v) ? "checked" : ""}> ${v}</label>`,
			)
			.join("");
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Debridify</title>
<style>
:root{--bg:#0f1115;--card:#181b22;--fg:#e8e8ea;--muted:#9aa0aa;--accent:#7c5cff;--line:#2a2e38}
@media (prefers-color-scheme: light){:root{--bg:#f6f7f9;--card:#fff;--fg:#14161a;--muted:#5b6170;--line:#dfe2e8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;padding:24px 16px}
main{max-width:640px;margin:0 auto}h1{margin:0 0 4px;font-size:24px}p.sub{color:var(--muted);margin:0 0 20px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 10px}
label.row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:8px 0}
input[type=text],input[type=number],select{background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:8px;min-width:0}
input[type=text]{width:100%}input[type=number]{width:90px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--line);border-radius:999px;padding:4px 10px;cursor:pointer}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}
a.btn,button{background:var(--accent);color:#fff;border:0;border-radius:10px;padding:10px 16px;font-weight:600;text-decoration:none;cursor:pointer}
button.secondary{background:transparent;color:var(--fg);border:1px solid var(--line)}
code{display:block;word-break:break-all;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px;margin-top:10px;font-size:12px}
small{color:var(--muted)}
</style></head><body><main>
<h1>Debridify</h1>
<p class="sub">Live torrent search for movies, series and anime, streamed through TorBox.</p>
<form id="f">
<section><h2>TorBox</h2>
<label class="row" style="display:block">API key ${hasEnvKey ? "<small>(optional: TORBOX_API_KEY is set in .env)</small>" : ""}
<input type="text" name="torboxKey" placeholder="${hasEnvKey ? "Using key from .env" : "Paste your TorBox API key"}" value="${esc(current.torboxKey ?? "")}" autocomplete="off"></label>
<label class="row">Only show cached results <input type="checkbox" name="cachedOnly" ${current.cachedOnly ? "checked" : ""}></label>
<label class="row">Also show P2P streams <input type="checkbox" name="includeP2P" ${current.includeP2P ? "checked" : ""}></label>
</section>
<section><h2>Sorting &amp; limits</h2>
<label class="row">Sort by <select name="sort">
${[
	["quality", "Quality, then seeders"],
	["qualitysize", "Quality, then size"],
	["seeders", "Seeders"],
	["size", "Size"],
]
	.map(([v, l]) => `<option value="${v}" ${current.sort === v ? "selected" : ""}>${l}</option>`)
	.join("")}
</select></label>
<label class="row">Max results (0 = all) <input type="number" min="0" name="maxResults" value="${current.maxResults}"></label>
<label class="row">Max per resolution (0 = all) <input type="number" min="0" name="maxPerResolution" value="${current.maxPerResolution}"></label>
<label class="row">Max size in GB (0 = any) <input type="number" min="0" name="maxSizeGb" value="${current.maxSizeGb}"></label>
<label class="row" style="display:block">Preferred languages <small>(ISO codes, comma separated, e.g. <i>en,ja</i>)</small>
<input type="text" name="languages" value="${esc(current.languages.join(","))}"></label>
</section>
<section><h2>Hide resolutions</h2><div class="chips">${checks("excludeResolutions", ALL_RESOLUTIONS, current.excludeResolutions)}</div></section>
<section><h2>Hide qualities</h2><div class="chips">${checks("excludeQualities", QUALITY_GROUPS, current.excludeQualities)}</div>
<small>cam = CAM / TS / TC / SCR</small></section>
<section><h2>Install</h2>
<div class="actions"><a class="btn" id="install" href="#">Install in Stremio</a><button type="button" class="secondary" id="copy">Copy manifest URL</button></div>
<code id="url"></code></section>
</form></main>
<script>
const DEFAULTS = ${JSON.stringify(DEFAULT_CONFIG)};
const BASE = ${JSON.stringify(env.baseUrl)};
const f = document.getElementById("f");
const b64url = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");
function build() {
  const d = new FormData(f), cfg = {};
  const key = (d.get("torboxKey") || "").trim(); if (key) cfg.torboxKey = key;
  for (const k of ["cachedOnly","includeP2P"]) if (f.elements[k].checked !== DEFAULTS[k]) cfg[k] = f.elements[k].checked;
  if (d.get("sort") !== DEFAULTS.sort) cfg.sort = d.get("sort");
  for (const k of ["maxResults","maxPerResolution","maxSizeGb"]) { const v = Number(d.get(k)); if (v !== DEFAULTS[k]) cfg[k] = v; }
  const langs = String(d.get("languages")||"").split(",").map(s=>s.trim().toLowerCase()).filter(s=>/^[a-z]{2}$/.test(s)); if (langs.length) cfg.languages = langs;
  for (const k of ["excludeResolutions","excludeQualities"]) { const v = d.getAll(k); if (JSON.stringify(v) !== JSON.stringify(DEFAULTS[k])) cfg[k] = v; }
  const seg = Object.keys(cfg).length ? "/" + b64url(JSON.stringify(cfg)) : "";
  const url = BASE + seg + "/manifest.json";
  document.getElementById("url").textContent = url;
  document.getElementById("install").href = url.replace(/^https?:/, "stremio:");
  return url;
}
f.addEventListener("input", build); f.addEventListener("change", build); build();
document.getElementById("copy").onclick = () => navigator.clipboard.writeText(build());
</script></body></html>`;
};
