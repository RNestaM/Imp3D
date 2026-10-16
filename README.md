# Imp3D

Liste d'idées / file d'attente d'impressions 3D. Site statique + une Cloudflare Pages Function ;
les données sont dans `data/ideas.xml` de ce repo.

## Mise en ligne sur Cloudflare Pages

1. **Token GitHub** : GitHub → Settings → Developer settings → *Fine-grained tokens* → nouveau token,
   accès au seul repo `RNestaM/Imp3D`, permission **Contents : Read and write**.
2. **Cloudflare** → Workers & Pages → *Create* → Pages → *Connect to Git* → choisir `RNestaM/Imp3D`.
   - Production branch : `main`
   - Framework preset : None — Build command : *(vide)* — Build output directory : `public`
3. Projet → *Settings* → *Variables and Secrets* (environnement **Production**) :
   | Nom | Valeur |
   |---|---|
   | `APP_PASSWORD` | ton mot de passe (Secret) |
   | `GITHUB_TOKEN` | le token de l'étape 1 (Secret) |
   | `GITHUB_REPO` | `RNestaM/Imp3D` |
   | `GITHUB_BRANCH` | `main` |
4. Projet → *Settings* → *Builds & deployments* → *Branch control* : preview branches → **None**
   (déploiement uniquement sur `main`).
5. Redéployer une fois (pour prendre en compte les variables), ouvrir `https://<projet>.pages.dev`,
   entrer le mot de passe. Il est mémorisé sur l'appareil.

Astuce téléphone : « Ajouter à l'écran d'accueil » depuis le navigateur.

## Dev local

```sh
cp .dev.vars.example .dev.vars   # puis remplir
npx wrangler pages dev public
```
