# Pandopia CLI

A mac-first CLI for the Pandopia catalog API.

## Install

### Local development

```bash
bun install
bun run build
npm install -g .
```

### Usage

```bash
pandopia
pandopia login cyril.bele@gmail.com
pandopia types
pandopia params diag_dpereglementaire
pandopia list diag_dpereglementaire --DIAG_STATUS=valide --organismeRef=lmh_6
pandopia get diag_dpereglementaire 1235
```

## Server selection

By default the CLI targets `https://app.pandopia.com`.

You can switch server per command:

```bash
pandopia --server test types
pandopia --server local params diag_dpereglementaire
pandopia --server https://app.pandopia.com/api/catalog types
```

Accepted server values:

- `app`
- `test`
- `local`
- a raw origin like `https://app.pandopia.com`
- a full catalog base URL like `https://app.pandopia.com/api/catalog`

The selected server is persisted in `~/.config/pandopia/config.json`.

## Authentication

`pandopia login` runs the two-step Pandopia auth flow:

1. `POST /api/auth/loginensureclient`
2. `POST /api/auth/accesstoken`

Secrets are stored in the macOS Keychain via `/usr/bin/security`.

If a token expires during a command, the CLI automatically tries `POST /api/auth/refreshtoken` once and retries the request.

## Commands

### `pandopia`

Shows help, active server, and login status.

### `pandopia login [email]`

Prompts for the password with hidden input. If the email is omitted, the CLI prompts for it too.

### `pandopia logout`

Clears the active server profile and its stored secrets.

### `pandopia types`

Lists exposed catalog types.

### `pandopia params <catalogType>`

Shows the filters and params for a catalog type.

### `pandopia list <catalogType> [flags]`

Reserved flags:

- `--page`
- `--per-page`
- `--search`
- `--params`
- `--json`
- `--server`

Any other `--key value` or `--KEY=value` flag is forwarded as-is to the API query string.

Examples:

```bash
pandopia list diag_dpereglementaire --DIAG_STATUS=valide --organismeRef=lmh_6
pandopia list diag_dpereglementaire --page 2 --per-page 20 --params DIAG_STATUS,DIAG_DPE_ETIQUETTEDPE
```

### `pandopia get <catalogType> <objectId>`

Fetches one object. Supports `--params`, `--json`, and `--server`.
