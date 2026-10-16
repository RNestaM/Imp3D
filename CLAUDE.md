# Imp3D — règles pour Claude

## Règles de travail (obligatoires)

1. **Déploiement uniquement sur `main`.** Cloudflare (Worker, `npx wrangler deploy`) déploie la branche `main` en production ;
   les autres branches ne sont pas déployées. Tout travail destiné à être en ligne est poussé sur `main`.
2. **Version visible, +1 à chaque push.** Avant chaque push, incrémenter de 1 la constante
   `APP_VERSION` dans `public/index.html` (seul endroit où elle est définie). Elle s'affiche dans l'en-tête
   (`v12`) et le pied de page. Mentionner la nouvelle version dans le message de commit (`v12 : …`).
3. **Ne jamais modifier à la main `data/ideas.xml`** sauf demande explicite : c'est la base de données,
   écrite par le site. Les commits faits par le site contiennent `[CF-Pages-Skip]` pour ne pas redéployer.

## Le projet

Site perso, accessible partout (Cloudflare Worker), pour suivre mes idées / ma liste d'attente d'impression 3D.
Doit rester **phone friendly**.

- On colle du texte en vrac : une ou plusieurs URL (Printables, Thingiverse, MakerWorld…) et/ou des idées
  en texte libre. Le site trie : chaque URL → un élément (titre tiré de la page ou de l'URL, source,
  image si dispo) ; chaque ligne sans URL → une idée texte. Les URL déjà présentes sont ignorées.
- Statuts, changés via des boutons rapides sur chaque carte :
  `idee` (Idée), `a_faire` (À faire), `attente` (Liste d'attente), `fait` (Fait), `a_garder` (À garder).

## Architecture

- `public/index.html` — toute l'interface (HTML/CSS/JS vanilla, pas de build).
- `src/worker.js` — point d'entrée du Worker (`wrangler.toml`) : sert `public/` et route `/api/items`.
- `functions/api/items.js` — l'API `/api/items` (format Pages Function, aussi utilisée par le Worker) (GET liste, POST ajout depuis texte,
  PATCH statut/titre/note, DELETE `?id=`). Protégée par l'en-tête `x-app-password`.
- `data/ideas.xml` — la base : un `<item id status created updated>` avec `<title> <url> <source> <image> <note>`.
  Lue/écrite via l'API GitHub Contents (gestion des conflits par `sha`, avec réessai).
- `.github/workflows/images.yml` + `.github/scripts/fetch-images.mjs` — à chaque modif de `data/ideas.xml`,
  GitHub Actions ajoute image + vrai titre aux éléments qui n'en ont pas (API Printables, sinon balises og:).
  Pas côté Worker : Printables renvoie 429 à toutes les requêtes venant de Cloudflare.
- Le site committe sur `main` : toujours `git pull --rebase origin main` avant de pousser.
- Config Cloudflare : voir `README.md`.

## Plus tard (pas maintenant)

- Import des fichiers STL / 3MF directement dans le site (stockage probablement Cloudflare R2 plutôt que le repo).
