# Pandopia CLI

Une CLI pensée d'abord pour macOS pour l'API catalogue de Pandopia.

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

Vous pouvez changer de serveur pour chaque commande :

```bash
pandopia --server test types
pandopia --server local params diag_dpereglementaire
pandopia --server https://app.pandopia.com/api/catalog types
```

Valeurs de serveur acceptées :

- `app`
- `test`
- `local`
- une origine brute comme `https://app.pandopia.com`
- une URL complète de base catalogue comme `https://app.pandopia.com/api/catalog`

Le serveur sélectionné est enregistré dans `~/.config/pandopia/config.json`.

## Authentification

`pandopia login` exécute le flux d'authentification Pandopia en deux étapes :

1. `POST /api/auth/loginensureclient`
2. `POST /api/auth/accesstoken`

Les secrets sont stockés dans le trousseau macOS via `/usr/bin/security`.

Si un jeton expire pendant une commande, la CLI tente automatiquement une fois `POST /api/auth/refreshtoken`, puis relance la requête.

## Commandes

### `pandopia`

Affiche l'aide, le serveur actif et l'état de connexion.

### `pandopia --version`

Affiche la version de la CLI depuis `package.json`.

### `pandopia login [email]`

Demande le mot de passe avec saisie masquée. Si l'email est omis, la CLI le demande aussi.

### `pandopia logout`

Supprime le profil du serveur actif et les secrets associés.

### `pandopia whoiam`

Indique si la CLI est connectée, l'email, la référence d'organisation et l'identifiant de clé API.

### `pandopia status`

Alias de `pandopia whoiam`.

### `pandopia types`

Liste les types de catalogue exposés.

### `pandopia params <catalogType>`

Affiche les filtres et paramètres d'un type de catalogue.

### `pandopia list <catalogType> [flags]`

Options réservées :

- `--page`
- `--per-page`
- `--search`
- `--params`
- `--json`
- `--server`

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

Récupère un objet. Prend en charge `--params`, `--json` et `--server`.

### `pandopia history <catalogType> <objectId> <paramCode>`

Récupère l'historique d'un paramètre pour un objet.
