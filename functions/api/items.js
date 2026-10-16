// API Imp3D (Cloudflare Pages Function) — /api/items
// La "base" est un fichier XML stocké dans le repo GitHub (data/ideas.xml),
// lu et écrit via l'API GitHub Contents.
//
// Variables d'environnement (Cloudflare Pages > Settings > Variables and Secrets) :
//   APP_PASSWORD   mot de passe demandé par le site (secret)
//   GITHUB_TOKEN   token fine-grained, droit "Contents: Read and write" sur le repo (secret)
//   GITHUB_REPO    ex. "RNestaM/Imp3D"
//   GITHUB_BRANCH  "main" (défaut)
//   DATA_PATH      "data/ideas.xml" (défaut)

export const STATUSES = ["idee", "a_faire", "attente", "fait", "a_garder"];
const FIELDS = ["title", "url", "source", "image", "note"];
const URL_RE = /https?:\/\/[^\s<>"']+/gi;

// ---------- HTTP ----------

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function onRequest({ request, env }) {
  if (!env.APP_PASSWORD || !env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return json({ error: "Configuration manquante : APP_PASSWORD, GITHUB_TOKEN et GITHUB_REPO sont requis." }, 500);
  }
  if ((request.headers.get("x-app-password") || "") !== env.APP_PASSWORD) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    switch (request.method) {
      case "GET": {
        const { items } = await loadDb(env);
        return json({ items });
      }
      case "POST": {
        const { text = "", status = "idee", action, id } = await request.json();
        if (action === "refresh") return json(await refreshImages(env, id));
        return json(await addFromText(env, text, STATUSES.includes(status) ? status : "idee"));
      }
      case "PATCH": {
        const body = await request.json();
        return json(await updateItem(env, body));
      }
      case "DELETE": {
        const id = new URL(request.url).searchParams.get("id");
        return json(await deleteItem(env, id));
      }
      default:
        return json({ error: "method not allowed" }, 405);
    }
  } catch (e) {
    return json({ error: e.message || String(e) }, e.status || 500);
  }
}

// ---------- Opérations ----------

async function addFromText(env, text, status) {
  const entries = parseInput(text);
  if (!entries.length) return { added: [], duplicates: [], items: (await loadDb(env)).items };

  // Métadonnées (titre / image) récupérées hors verrou, en parallèle.
  // Limité pour rester sous le plafond de sous-requêtes d'un Worker (50 en gratuit).
  await Promise.all(entries.filter((e) => e.url).slice(0, MAX_FETCH).map((e) => enrich(e, true)));

  let added = [];
  let duplicates = [];
  const items = await mutate(env, (items) => {
    added = [];
    duplicates = [];
    const known = new Set(items.filter((i) => i.url).map((i) => urlKey(i.url)));
    const now = new Date().toISOString();
    for (const e of entries) {
      if (e.url) {
        const key = urlKey(e.url);
        if (known.has(key)) { duplicates.push(e.url); continue; }
        known.add(key);
      }
      const item = { id: newId(), status, created: now, updated: now, ...e };
      items.unshift(item);
      added.push(item);
    }
    return added.length ? `Ajout de ${added.length} élément(s)` : null;
  });
  return { added, duplicates, items };
}

// Récupère image (et titre s'il n'a pas été modifié à la main) des éléments sans image,
// ou d'un seul élément si id est fourni. Renvoie le détail des échecs pour diagnostic.
async function refreshImages(env, id) {
  const { items: current } = await loadDb(env);
  const todo = current.filter((i) => i.url && (id ? i.id === id : !i.image));
  const batch = todo.slice(0, MAX_FETCH);
  const results = await Promise.all(
    batch.map(async (i) => {
      const entry = { url: i.url, title: i.title };
      const r = await enrich(entry, i.title === titleFromUrl(i.url));
      return { id: i.id, entry, ...r, label: i.title || i.url };
    })
  );
  const found = results.filter((r) => r.entry.image);
  const items = await mutate(env, (items) => {
    let n = 0;
    for (const r of found) {
      const item = items.find((i) => i.id === r.id);
      if (!item) continue;
      item.image = r.entry.image;
      item.title = r.entry.title || item.title;
      n++;
    }
    return n ? `Images récupérées pour ${n} élément(s)` : null;
  });
  return {
    found: found.length,
    failed: results.filter((r) => !r.entry.image).map((r) => ({ title: r.label, reason: r.reason })),
    remaining: todo.length - batch.length,
    items,
  };
}

async function updateItem(env, { id, status, title, note }) {
  if (status !== undefined && !STATUSES.includes(status)) throw httpError(400, "statut invalide");
  let item;
  const items = await mutate(env, (items) => {
    item = items.find((i) => i.id === id);
    if (!item) throw httpError(404, "élément introuvable");
    if (status !== undefined) item.status = status;
    if (title !== undefined) item.title = String(title).trim();
    if (note !== undefined) item.note = String(note).trim();
    item.updated = new Date().toISOString();
    return `Mise à jour : ${item.title || item.url}${status ? ` → ${status}` : ""}`;
  });
  return { item, items };
}

async function deleteItem(env, id) {
  const items = await mutate(env, (items) => {
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) throw httpError(404, "élément introuvable");
    const [gone] = items.splice(idx, 1);
    return `Suppression : ${gone.title || gone.url}`;
  });
  return { items };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---------- Analyse du texte collé ----------

// Chaque URL devient un élément ; chaque ligne sans URL devient une idée texte.
// Le texte présent sur la même ligne qu'une URL unique devient sa note.
export function parseInput(text) {
  const entries = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const urls = (line.match(URL_RE) || []).map((u) => u.replace(/[)\].,;:!?]+$/, ""));
    const rest = line.replace(URL_RE, "").replace(/^[-*•\s]+/, "").trim();
    if (!urls.length) {
      entries.push({ title: rest || line });
      continue;
    }
    for (const url of urls) {
      const entry = { url, source: sourceOf(url), title: titleFromUrl(url) };
      if (urls.length === 1 && rest) entry.note = rest;
      entries.push(entry);
    }
  }
  return entries;
}

function urlKey(url) {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

const SOURCES = {
  "printables.com": "Printables",
  "thingiverse.com": "Thingiverse",
  "makerworld.com": "MakerWorld",
  "cults3d.com": "Cults3D",
  "thangs.com": "Thangs",
  "myminifactory.com": "MyMiniFactory",
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
};

function sourceOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const match = Object.keys(SOURCES).find((d) => host === d || host.endsWith("." + d));
    return match ? SOURCES[match] : host;
  } catch {
    return "";
  }
}

// "…/model/1863635-hollow-skeleton-duck" → "Hollow skeleton duck"
export function titleFromUrl(url) {
  try {
    const segs = new URL(url).pathname.split("/").filter(Boolean);
    let slug = decodeURIComponent(segs[segs.length - 1] || new URL(url).hostname);
    slug = slug.replace(/^\d+[-_]/, "").replace(/[-_]+/g, " ").replace(/:/g, " ").trim();
    return slug ? slug[0].toUpperCase() + slug.slice(1) : url;
  } catch {
    return url;
  }
}

const MAX_FETCH = 15;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// Essaie chaque stratégie (API du site, puis balises og: de la page) jusqu'à trouver une image.
// Met à jour entry.image, et entry.title si useTitle. Renvoie { reason } en cas d'échec.
async function enrich(entry, useTitle) {
  const errors = [];
  for (const strategy of strategiesFor(entry.url)) {
    try {
      const meta = await strategy(entry.url);
      if (useTitle && meta.title) entry.title = meta.title;
      if (meta.image) {
        entry.image = meta.image;
        return {};
      }
      errors.push(`${strategy.label} : pas d'image`);
    } catch (e) {
      errors.push(`${strategy.label} : ${e.name === "TimeoutError" ? "délai dépassé" : e.message}`);
    }
  }
  return { reason: errors.join(" · ") };
}

function strategiesFor(url) {
  return /printables\.com\/model\/\d+/.test(url) ? [printablesApi, ogTags] : [ogTags];
}

async function printablesApi(url) {
  const id = url.match(/\/model\/(\d+)/)[1];
  const res = await fetch("https://api.printables.com/graphql/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": UA,
      origin: "https://www.printables.com",
      referer: "https://www.printables.com/",
    },
    body: JSON.stringify({
      query: "query Print($id: ID!) { print(id: $id) { name image { filePath } } }",
      variables: { id },
    }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const print = body.data?.print;
  if (!print) throw new Error(body.errors?.[0]?.message || "réponse vide");
  return {
    title: print.name,
    image: print.image?.filePath ? `https://media.printables.com/${print.image.filePath}` : undefined,
  };
}
printablesApi.label = "API Printables";

async function ogTags(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "fr,en;q=0.8" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = (await res.text()).slice(0, 400000);
  const meta = (prop) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    return tag?.match(/content=["']([^"']*)["']/i)?.[1];
  };
  const title = meta("og:title") || meta("twitter:title");
  let image = meta("og:image") || meta("og:image:url") || meta("twitter:image");
  if (image) image = new URL(decodeEntities(image), url).href;
  return {
    title: title && (decodeEntities(title).split(/\s+\|\s+/)[0].replace(/\s+by\s+[^|]+$/i, "").trim() || undefined),
    image,
  };
}
ogTags.label = "page";

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// ---------- XML ----------

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function parseXml(xml) {
  const items = [];
  for (const [, attrs, body] of xml.matchAll(/<item\b([^>]*)>([\s\S]*?)<\/item>/g)) {
    const item = {};
    for (const [, k, v] of attrs.matchAll(/(\w+)="([^"]*)"/g)) item[k] = decodeEntities(v);
    for (const f of FIELDS) {
      const m = body.match(new RegExp(`<${f}>([\\s\\S]*?)</${f}>`));
      if (m) item[f] = decodeEntities(m[1]);
    }
    if (!STATUSES.includes(item.status)) item.status = "idee";
    items.push(item);
  }
  return items;
}

export function toXml(items) {
  const rows = items.map((i) => {
    const fields = FIELDS.filter((f) => i[f]).map((f) => `    <${f}>${esc(i[f])}</${f}>`).join("\n");
    return `  <item id="${esc(i.id)}" status="${esc(i.status)}" created="${esc(i.created)}" updated="${esc(i.updated)}">\n${fields}\n  </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<items>\n${rows.join("\n")}${rows.length ? "\n" : ""}</items>\n`;
}

// ---------- GitHub ----------

function gh(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "imp3d-pages",
      "x-github-api-version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
}

const dataPath = (env) => env.DATA_PATH || "data/ideas.xml";
const branch = (env) => env.GITHUB_BRANCH || "main";

async function loadDb(env) {
  const res = await gh(env, `contents/${dataPath(env)}?ref=${branch(env)}`, { headers: { "cache-control": "no-cache" } });
  if (res.status === 404) return { items: [], sha: null };
  if (!res.ok) throw new Error(`GitHub lecture ${res.status} : ${await res.text()}`);
  const body = await res.json();
  const bytes = Uint8Array.from(atob(body.content.replace(/\s/g, "")), (c) => c.charCodeAt(0));
  return { items: parseXml(new TextDecoder().decode(bytes)), sha: body.sha };
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Lit, applique fn, réécrit. Réessaie si le fichier a changé entre-temps (conflit de sha).
// fn renvoie le message de commit, ou null pour ne rien écrire.
async function mutate(env, fn) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { items, sha } = await loadDb(env);
    const message = fn(items);
    if (!message) return items;
    const res = await gh(env, `contents/${dataPath(env)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // [CF-Pages-Skip] : évite un redéploiement Cloudflare à chaque modif de données
        message: `${message} [CF-Pages-Skip]`,
        content: toBase64(toXml(items)),
        branch: branch(env),
        ...(sha ? { sha } : {}),
      }),
    });
    if (res.ok) return items;
    if (res.status !== 409 && res.status !== 422) throw new Error(`GitHub écriture ${res.status} : ${await res.text()}`);
  }
  throw httpError(409, "Conflit d'écriture, réessaie.");
}
