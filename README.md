# Imp3D

Liste d'idées / file d'attente d'impressions 3D. Cloudflare Worker (fichiers statiques + une API) ;
les données sont dans `data/ideas.xml` de ce repo.

## Mise en ligne sur Cloudflare (Worker)

1. **Token GitHub** : GitHub → Settings → Developer settings → *Fine-grained tokens* → nouveau token,
   accès au seul repo `RNestaM/Imp3D`, permission **Contents : Read and write**.
2. **Cloudflare** → Workers & Pages → *Create* → *Import a repository* → `RNestaM/Imp3D`.
   - Branche de production : `main`
   - Build command : *(vide)* — Deploy command : `npx wrangler deploy` (lit `wrangler.toml`)
3. Projet → *Settings* → *Variables and Secrets* :
   | Nom | Type | Valeur |
   |---|---|---|
   | `APP_PASSWORD` | Secret | ton mot de passe |
   | `GITHUB_TOKEN` | Secret | le token de l'étape 1 |
   | `GITHUB_REPO` | Text | `RNestaM/Imp3D` |
   | `GITHUB_BRANCH` | Text | `main` |
4. Projet → *Settings* → *Build* : désactiver les builds des branches autres que `main`
   (déploiement uniquement sur `main`).
5. Relancer un déploiement, ouvrir `https://imp3d.<ton-compte>.workers.dev`, entrer le mot de passe.
   Il est mémorisé sur l'appareil.

Astuce téléphone : « Ajouter à l'écran d'accueil » depuis le navigateur.

## Dev local

```sh
cp .dev.vars.example .dev.vars   # puis remplir
npx wrangler dev
```
