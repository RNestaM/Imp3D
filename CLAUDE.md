# Imp3D — règles pour Claude

## Règles de travail (obligatoires)

1. **Déploiement uniquement sur `main`.** Cloudflare Pages déploie la branche `main` en production ;
   les déploiements de preview sont désactivés. Tout travail destiné à être en ligne est poussé sur `main`.
2. **Version visible, +1 à chaque push.** Avant chaque push, incrémenter de 1 la constante
   `APP_VERSION` dans `public/index.html` (seul endroit où elle est définie). Elle s'affiche dans l'en-tête
   (`v12`) et le pied de page. Mentionner la nouvelle version dans le message de commit (`v12 : …`).
3. **Ne jamais modifier à la main `data/ideas.xml`** sauf demande explicite : c'est la base de données,
   écrite par le site. Les commits faits par le site contiennent `[CF-Pages-Skip]` pour ne pas redéployer.

## Le projet

Site perso, accessible partout (Cloudflare Pages), pour suivre mes idées / ma liste d'attente d'impression 3D.
Doit rester **phone friendly**.

- On colle du texte en vrac : une ou plusieurs URL (Printables, Thingiverse, MakerWorld…) et/ou des idées
  en texte libre. Le site trie : chaque URL → un élément (titre tiré de la page ou de l'URL, source,
  image si dispo) ; chaque ligne sans URL → une idée texte. Les URL déjà présentes sont ignorées.
- Statuts, changés via des boutons rapides sur chaque carte :
  `idee` (Idée), `a_faire` (À faire), `attente` (Liste d'attente), `fait` (Fait), `a_garder` (À garder).

## Architecture

- `public/index.html` — toute l'interface (HTML/CSS/JS vanilla, pas de build).
- `functions/api/items.js` — Cloudflare Pages Function `/api/items` (GET liste, POST ajout depuis texte,
  PATCH statut/titre/note, DELETE `?id=`). Protégée par l'en-tête `x-app-password`.
- `data/ideas.xml` — la base : un `<item id status created updated>` avec `<title> <url> <source> <image> <note>`.
  Lue/écrite via l'API GitHub Contents (gestion des conflits par `sha`, avec réessai).
- Config Cloudflare : voir `README.md`.

## Plus tard (pas maintenant)

- Import des fichiers STL / 3MF directement dans le site (stockage probablement Cloudflare R2 plutôt que le repo).
