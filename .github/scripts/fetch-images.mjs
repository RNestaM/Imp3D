// Ajoute image (et vrai titre) aux éléments de data/ideas.xml qui n'en ont pas.
// Lancé par GitHub Actions (.github/workflows/images.yml) : Printables bloque les
// requêtes venant des serveurs Cloudflare, pas celles de GitHub.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseXml, toXml, titleFromUrl, decodeEntities } from "../../functions/api/items.js";

const DATA = "data/ideas.xml";
const MAX_PER_RUN = 25;
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const BOTS = [
  ["Chrome", CHROME],
  ["Discordbot", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"],
  ["Facebook", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
const printablesId = (url) => url.match(/printables\.com\/(?:[a-z]{2}\/)?model\/(\d+)/)?.[1];
const errMsg = (e) => (e.name === "TimeoutError" ? "délai dépassé" : e.message);
const cleanTitle = (t) =>
  t && (decodeEntities(t).split(/\s+\|\s+/)[0].replace(/\s+by\s+[^|]+$/i, "").trim() || undefined);

// Une requête groupée à l'API GraphQL de Printables pour tous les modèles.
async function printablesApi(ids) {
  const query = `query { ${ids.map((id, n) => `p${n}: print(id: ${JSON.stringify(id)}) { name image { filePath } }`).join(" ")} }`;
  const res = await fetch("https://api.printables.com/graphql/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": CHROME,
      origin: "https://www.printables.com",
      referer: "https://www.printables.com/",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  const body = JSON.parse(text);
  if (!body.data) throw new Error(body.errors?.[0]?.message || "réponse vide");
  return ids.map((_, n) => {
    const p = body.data[`p${n}`];
    return p && { title: p.name, image: p.image?.filePath ? `https://media.printables.com/${p.image.filePath}` : undefined };
  });
}

async function ogTags(url, ua) {
  const res = await fetch(url, {
    headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml", "accept-language": "fr,en;q=0.8" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = (await res.text()).slice(0, 500000);
  const meta = (prop) => {
    const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i"))?.[0];
    return tag?.match(/content=["']([^"']*)["']/i)?.[1];
  };
  let image = meta("og:image") || meta("og:image:url") || meta("twitter:image");
  if (image) image = new URL(decodeEntities(image), url).href;
  return { title: cleanTitle(meta("og:title") || meta("twitter:title")), image };
}

async function pageMeta(url) {
  const errors = [];
  for (const [name, ua] of BOTS) {
    try {
      const m = await ogTags(url, ua);
      if (m.image) return m;
      errors.push(`${name} : pas d'image`);
    } catch (e) {
      errors.push(`${name} : ${errMsg(e)}`);
    }
    await sleep(500);
  }
  throw new Error("page (" + errors.join(", ") + ")");
}

// ---- 1. Recherche ----
const todo = parseXml(readFileSync(DATA, "utf8")).filter((i) => i.url && !i.image).slice(0, MAX_PER_RUN);
console.log(`${todo.length} élément(s) sans image`);
const found = new Map();

const pr = todo.filter((i) => printablesId(i.url));
if (pr.length) {
  try {
    const metas = await printablesApi(pr.map((i) => printablesId(i.url)));
    pr.forEach((i, n) => metas[n]?.image && found.set(i.id, metas[n]));
    console.log(`API Printables : ${found.size}/${pr.length}`);
  } catch (e) {
    console.log(`API Printables : ${errMsg(e)}`);
  }
}
for (const i of todo.filter((i) => !found.has(i.id))) {
  try {
    found.set(i.id, await pageMeta(i.url));
    console.log(`OK page : ${i.url}`);
  } catch (e) {
    console.log(`ÉCHEC ${i.url} — ${e.message}`);
  }
  await sleep(1000);
}
console.log(`${found.size} image(s) trouvée(s)`);
if (!found.size) process.exit(0);

// ---- 2. Écriture (sur la dernière version de main : le site a pu écrire entre-temps) ----
sh('git config user.name "github-actions[bot]"');
sh('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
for (let attempt = 1; attempt <= 4; attempt++) {
  sh("git fetch -q origin main");
  sh("git reset -q --hard origin/main");
  const items = parseXml(readFileSync(DATA, "utf8"));
  let n = 0;
  for (const item of items) {
    const m = found.get(item.id);
    if (!m || item.image) continue;
    item.image = m.image;
    if (m.title && item.title === titleFromUrl(item.url)) item.title = m.title;
    n++;
  }
  if (!n) process.exit(0);
  writeFileSync(DATA, toXml(items));
  sh(`git commit -q -am "Images : ${n} élément(s) [CF-Pages-Skip]"`);
  try {
    sh("git push -q origin HEAD:main");
    console.log(`Poussé : ${n} image(s)`);
    process.exit(0);
  } catch {
    console.log(`Push refusé (tentative ${attempt}), on recommence`);
    await sleep(2000 * attempt);
  }
}
process.exit(1);
