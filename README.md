# Pandopia CLI

Une CLI pour l'API catalogue de Pandopia, compatible macOS, Linux et Windows.

## Installation

### Développement local

```bash
bun install
bun run build
npm install -g .
```

### Utilisation

```bash
pandopia
pandopia --version
pandopia setServer test
pandopia setFormat md
pandopia login cyril.bele@gmail.com
pandopia status
pandopia types
pandopia params diag_dpereglementaire
pandopia list diag_dpereglementaire --DIAG_STATUS=valide --organismeRef=lmh_6
pandopia find diag_dpereglementaire "lmh"
pandopia get diag_dpereglementaire 1235
pandopia history diag_dpereglementaire 1235 DIAG_STATUS
```

## Sélection du serveur

Par défaut, la CLI cible `https://app.pandopia.com`.

Vous pouvez changer le serveur actif:

```bash
pandopia setServer test
pandopia setServer local
pandopia setServer https://app.pandopia.com/api/catalog
```

Valeurs de serveur acceptées :

- `app`
- `test`
- `local`
- une origine brute comme `https://app.pandopia.com`
- une URL complète de base catalogue comme `https://app.pandopia.com/api/catalog`

Le serveur actif est enregistré dans `~/.config/pandopia/config.json` et toutes les commandes utilisent ensuite ce serveur.

## Format de sortie

Par défaut, la CLI rend les commandes de lecture au format Markdown (`md`).

Vous pouvez :

- forcer un format ponctuellement avec `--md`, `--json` ou `--jsonl`
- définir le format par défaut avec `pandopia setFormat <md|json|jsonl>`
- vérifier le format courant avec `pandopia status`

Exemples :

```bash
pandopia types --json
pandopia list diag_dpereglementaire --jsonl
pandopia get diag_dpereglementaire 1235 --md
pandopia setFormat jsonl
```

## Authentification

`pandopia login` pour vous identifier avec votre login et mot de passe.

## Commandes

### `pandopia`

Affiche l'aide, le serveur actif et l'état de connexion.

### `pandopia --version`

Affiche la version de la CLI depuis `package.json`.

### `pandopia login [email]`

Demande le mot de passe avec saisie masquée. Si l'email est omis, la CLI le demande aussi.

### `pandopia logout`

Supprime le profil du serveur actif et les secrets associés.

### `pandopia setServer <serveur>`

Définit le serveur actif sans nécessiter de login.

### `pandopia setFormat <format>`

Définit le format de sortie par défaut. Valeurs acceptées : `md`, `json`, `jsonl`.

### `pandopia whoiam`

Indique si la CLI est connectée, le serveur actuellement visé, le format de sortie par défaut, l'email, la référence d'organisation et l'identifiant de clé API.

### `pandopia status`

Alias de `pandopia whoiam`.

### `pandopia types`

Liste les types de catalogue exposés.

### `pandopia params <catalogType>`

Affiche les filtres et paramètres d'un type de catalogue.

### `pandopia list <catalogType> [flags]`

Options réservées :

- `--md`
- `--page`
- `--per-page`
- `--search`
- `--params`
- `--json`
- `--jsonl`

Toute autre option `--key value` ou `--KEY=value` est transmise telle quelle à la query string de l'API.

Exemples :

```bash
pandopia list diag_dpereglementaire --DIAG_STATUS=valide --organismeRef=lmh_6
pandopia list diag_dpereglementaire --page 2 --per-page 20 --params DIAG_STATUS,DIAG_DPE_ETIQUETTEDPE
```

### `pandopia find <catalogType> <text> [flags]`

Alias de `pandopia list <catalogType> --search <text>`.

Exemple :

```bash
pandopia find diag_dpereglementaire "lmh"
```

### `pandopia get <catalogType> <objectId>`

Récupère un objet. Prend en charge `--params`, `--md`, `--json` et `--jsonl`.

### `pandopia history <catalogType> <objectId> <paramCode>`

Récupère l'historique d'un paramètre pour un objet. Prend en charge `--md`, `--json` et `--jsonl`.

## Licence

Ce projet est distribué sous licence MIT. Vous pouvez l'utiliser, le modifier, le redistribuer et l'intégrer dans d'autres projets, y compris commerciaux, sans garantie.

## Publication npm automatique

Le dépôt contient un workflow GitHub Actions qui publie automatiquement le package sur npm à chaque `push` sur la branche `main`, uniquement si la version courante de `package.json` n'existe pas encore sur npm.

La publication repose sur npm Trusted Publishing via OpenID Connect (OIDC). Aucune injection de `NPM_TOKEN` n'est nécessaire pour `npm publish`.

Points de configuration à vérifier sur npmjs.com :

- le package `@pandopia/cli` doit être relié au dépôt GitHub `pandopia/cli.pandopia.com`
- le workflow déclaré côté npm doit être `publish.yml`
- le workflow GitHub doit disposer de la permission `id-token: write`

Commandes utiles :

- `npm run publish:npm` : publie manuellement le package
- `npm run publish:ci` : vérifie si la version existe déjà, puis publie seulement si nécessaire
