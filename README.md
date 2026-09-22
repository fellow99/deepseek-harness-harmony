[中文](./README_zh.md) | English

---

# DeepSeek Harness HarmonyOS Desktop

> A HarmonyOS desktop wrapper for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) built on the "Electron-on-HarmonyOS" runtime ([harmonypc-electron](https://atomgit.com/jianguoxu/harmonypc-electron), Electron 37 / Node 22.17.0) — runs the dsh Host (with webserver) inside the Electron main process on HarmonyOS devices, and the renderer loads the dsh Web UI same-origin, 100% reusing the dsh Web UI.

**Version**: `0.1.5` · **Status**: ✅ Verified on device — HarmonyOS 6.1.0.135 (API 24), Electron 37 / Node 22.17.0, dsh Web UI runs normally (core chat / agent / tool calling / Web UI all functional). See [docs/工程规划.md](docs/工程规划.md) for the full engineering plan and final implementation record.

---

## Current versions

| Field | Value |
|---|---|
| `versionName` | `0.1.5` |
| `versionCode` | `1005` |

Source: `AppScope/app.json5`. `versionCode` must be a number and must **strictly increase** on every AppGallery submission — see [AppGallery submission](#appgallery-submission).

---

## What is this

DeepSeek Harness (`dsh`) is an open-source agent harness by DeepSeek AI, built on an "everything is a plugin" architecture (driven by [Cordis](https://github.com/cordiverse/cordis)); its native entry is `dsh web` (a browser Web UI).

This project wraps the dsh Web UI in a native HarmonyOS desktop shell (Electron-on-HarmonyOS runtime), 100% reusing the dsh frontend, making the agent harness run like a first-class desktop app on HarmonyOS devices. It is **not** a thin "wrap `dsh web` pointing at localhost" shell, but a first-class desktop app built on dsh's existing architecture, benchmarked against `deepseek-harness-desktop`.

## Core design

`dsh` has completed its **Host/Client split**, and its webserver **serves both the SPA dist and `/api`**. This project therefore uses an **in-process Host + webserver + same-origin data plane**:

```
┌─ HarmonyOS HAP ─────────────────────────────────────────────────┐
│  electron module (entry): EntryAbility boots Electron-on-HarmonyOS│
│  web_engine module (HAR): ArkTS bridge layer + resfile carries dsh│
│         ┌─ Electron main process (Node.js, also hosts dsh Host)─┐│
│         │  main.js: extract dsh-dist.tar.gz → runProfile('desktop')│
│         │    ├─ webserver ← 0.0.0.0:<free port>, serves dist+/api│
│         │    ├─ apiProxy  ← RPC gateway                         │
│         │    └─ connection ← /api + WebSocket registration      │
│         │  once ready: loadURL(http://<LAN IP>:<port>/)         │
│         └────────────────────▲──────────────────────────────────┘│
│                              │ same-origin (no CORS/auth) + Host header rewrite│
│         ┌────────────────────┴──────────────────────────────────┐│
│         │ Renderer: loadURL(LAN IP) ← same-origin               ││
│         │   standard dsh Web UI (WebApiClient: fetch /api + WS) ││
│         └───────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────┘
```

Key point: **the renderer loads same-origin — zero CORS, zero auth, zero custom protocol, zero IPC carrier** — reusing dsh's existing `WebApiClient` (HTTP uplink + WebSocket downlink), **zero upstream changes** (only 13 patches).

**Differences from desktop** (HarmonyOS-specific adaptations, see `docs/工程规划.md` §18):

- HarmonyOS NEXT isolates renderer access to `127.0.0.1` (**loopback network isolation**) → webserver binds `0.0.0.0` and the renderer connects via the LAN IP, with the embedded renderer's outgoing requests rewriting `Host`/`Origin` to `127.0.0.1:<port>` before they leave the session, so dsh's loopback-only privileged-method fence passes (security semantics unchanged — other LAN devices still get 403).
- HarmonyOS sandbox forbids symlink (`EACCES`) → dsh profile falls back to `cpSync` recursive copy (patch).
- `os.homedir()` returns an out-of-sandbox directory (`EPERM`) → the main process points `HOME` at the sandbox-writable `userData` directory before startup.

## MVP capabilities

- ✅ dsh Web UI runs in a window (100% reuses dsh frontend)
- ✅ Session persistence / full-text search (better-sqlite3, Electron 37 / Node ABI v138 aarch64 artifact, injected by collect-dsh)
- ✅ Plugin marketplace (dsh-market built-in)
- ✅ Window state persistence (maximized / bounds restored) + F11 fullscreen toggle
- ⚠️ Image attachments (sharp is replaced by a pure-JS stub that parses PNG/JPEG/GIF/WebP container headers; any conversion the stub cannot perform itself is routed through the platform image framework by an ArkTS bridge — decode, EXIF orientation, scale, and re-encode to JPEG/WebP/PNG. Already-clean 8-bit sRGB PNG/JPEG/WebP inside the limits still pass through byte-identically and cost no conversion. When no bridge is reachable — plain Node, such as the stub's own test — every conversion is refused with an explicit, attributed error. No thumbnails.)
- ✅ Command execution — the `bash` tool (plugin `harmony-plugin-exec`): a **non-PTY resident `/system/bin/sh`** driven by a sentinel-line protocol, plus a tool-layer path fence. Verified on device; the upstream `tool-bash` row stays disabled (`node-pty` has no aarch64 artifact, and PTY is denied by SELinux). ⚠️ The fence is **best-effort and bypassable — not a sandbox**; see the plugin README's Known Limitations.
- ❌ Process sandbox (koffi / landlock)
- ⛔ **Bundling our own Node / pnpm / python runtime — NOT POSSIBLE for this project.** Shipping an ELF requires a **binary certificate** (AGC `certType: 4`), and Huawei **does not grant it to individual developers** (it needs an enterprise entity, applied for through the online work-order system).
  - **0.1.5 decision (2026-09-22): take "route 1" — the host installs `pnpm`, and this app makes NO AppGallery commitment for this capability.** Concretely: the app already sees `/data/service/hnp/bin` on its `PATH` and a structurally valid `node` lives there — only `pnpm` is missing. Once the user installs `pnpm` **from the system terminal** (the symlink ban is app-domain-only, so it must NOT be installed from within the app), the marketplace's `probePnpm()` succeeds and plugin install/uninstall works. It is treated as an **optional dependency, never a product capability** — do not advertise it.
  - Nothing else in the MVP depends on a bundled runtime: command execution spawns the **system's own** `sh`/toybox, and the file/search/skill/subagent/workflow/image features are pure JS. Analysis: [`docs/鸿蒙环境能力清单-v0.1.5.md`](docs/鸿蒙环境能力清单-v0.1.5.md) §C.8.

(Phase 2: system tray, frameless window, launch at login; native file picker reuses dsh's standard frontend directory browser)

## Target platforms & distribution

- **Platforms**: HarmonyOS 2in1 / tablet (`deviceTypes: ["2in1", "tablet"]`)
- **Distribution**: local debug-signed HAP for development (DevEco auto-signing + Huawei cert) **and AppGallery submission** — release-signed App Pack (`.app`) built with a Huawei-issued release certificate + release profile (see [AppGallery submission](#appgallery-submission)). Auto-update is not implemented yet.

## Tech stack

- **Electron-on-HarmonyOS** (harmonypc-electron, Electron 37 / Node 22.17.0) — native SO + ArkTS bridge layer (aki / adapter / addon + libshim.a)
- **ArkTS / ArkUI** (Stage model, `web_engine` HAR bridge: ~46 Adapters + ~44 AdapterBinds)
- **deepseek-harness** (`dsh`, sibling directory `../deepseek-harness`, not a submodule, source reference) — current build is based on **`dsh-v0.1.5-rc.2`**; its patches live in `patches/dsh-v0.1.5-rc.2/`
- **dsh-market** (sibling directory `../dsh-market`, npm package `dshmarket`, built-in plugin marketplace)
- **hvigor / DevEco Studio** (HAP build + signing)

## Development

### Integration approach

- **Runtime copy**: `harmonypc-electron` is a sibling HarmonyOS project (not an npm package); `collect-runtime.mjs` physically copies its `electron` + `web_engine` modules + 3 SOs into this project at build time (sibling layout, artifact embedding), and injects `libc++_shared.so`.
- **Source reference**: dsh and dsh-market are sibling-directory source references (not submodules), consumed via patch + build + artifact collection.
- **Host integration**: `src-main/main.js` dynamically imports dsh's `runProfile` (apps/cli build artifact), hosting the dsh Host in-process (webserver bound to `0.0.0.0`), returning a `{ ctx, shutdown, port, url }` handle.
- **Same-origin data plane**: the renderer does `loadURL(http://<LAN IP>:<port>/)` to load the dsh Web UI same-origin, reusing `WebApiClient` — zero CORS, zero auth, zero new carrier.
- **desktop profile**: `profiles/desktop/` (`dsh.profile.bundles = [dsh-base, dsh-web-app, dshmarket]`, cordis.patch.yml overriding `web-runtime.printUrl: false`, `webserver.host: 0.0.0.0`), copied to `$DSH_HOME/profiles/desktop` at runtime.

### Build process (four stages + 13 patches)

dsh depends on Node internal APIs (HMR, native directory dialog) and conflicts with the HarmonyOS sandbox (symlink, loopback isolation), so 13 patches must be applied first (idempotent — `--reverse --check` detects already-applied and skips):

The pipeline is **four stages** (⓪–③), followed by the local build + signing step (④). Stage ⓪ is the runtime sync: it force-copies the upstream runtime **and re-applies this app's own customizations** (prune + overlay), so it must always be the first thing that runs.

```bash
# ⓪ sync runtime + re-apply app customizations: copy ../harmonypc-electron's electron + web_engine
#    modules + 3 SOs + libc++_shared.so, prune unwanted upstream files, then overlay runtime-overlays/
node scripts/collect-runtime.mjs

# ① build dsh: clean workspace residue → apply 13 patches → pnpm build host/client/web → build ../dsh-market
node scripts/build-dsh.mjs

# ② collect dsh artifacts: pnpm deploy materialize → fill packages → sharp stub → better-sqlite3 injection → web dist + profile + dshmarket + plugins
node scripts/collect-dsh.mjs

# ③ compress dsh-dist into dsh-dist.tar.gz (--format=ustar, ~143MB, streaming decompression at runtime)
tar -czf web_engine/src/main/resources/resfile/resources/app/dsh-dist.tar.gz --format=ustar -C . dsh-dist

# ④ build + sign (dedicated entry points; see "Signing" and "Run")
#    powershell -ExecutionPolicy Bypass -File scripts\build-debug.ps1      # debug  (default: -Task Hap)
#    powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1    # release (default: -Task App)
```

#### Runtime overlay + prune (app customizations)

Stage ⓪ (`scripts/collect-runtime.mjs`) does a whole-directory `cpSync(..., { recursive: true, force: true })` of the upstream runtime (`../harmonypc-electron/ohos_hap` → `electron/` + `web_engine/`) over this project, so **any app customization that is not re-applied afterwards is silently reverted**. Two mechanisms preserve this project's own changes:

- **Prune (stage 1b)** — deletes the 4 upstream Bluetooth files this app does not use: `BluetoothAdapter.ets`, `BluetoothLowEnergyAdapter.ets` and their two `*Bind.ets` jsbindings. Each file's existence is asserted first: a missing file is a **hard failure**, signalling upstream structural drift that must be re-evaluated (never silently skipped).
- **Overlay (stage 3)** — re-copies each file listed in `OVERLAY_FILES` from `runtime-overlays/<same relative path>` over the project. Currently 8 entries: both `module.json5` files (`electron` + `web_engine`), `electron/src/main/resources/base/profile/shortcuts_config.json`, `web_engine`'s `MediaAdapter.ets` and `JsBindingMethod.ets`, plus the 3 locale `string.json` files (`base` / `en_US` / `zh_CN`).
- `OVERLAY_PRE_REWRITE_FILES` (1 entry: `web_engine/src/main/ets/adapter/PermissionManagerAdapter.ets`) is overlaid in stage 3 but is **also** rewritten by stage 4 (bundleName literal replacement). Its overlay copy therefore intentionally keeps the generic literal `com.huawei.ohos_electron`, which stage 4 rewrites to the app bundle name. Because source and destination legitimately differ after stage 4, it is excluded from the stage-7.6 md5 check and guarded by stage 7.4 plus the new guard 7.9 instead.
- **Guards** — 7.8 asserts every `PRUNE_FILES` entry is absent; 7.9 asserts that for each `OVERLAY_PRE_REWRITE_FILES` entry the overlay source still contains the generic literal, and that the destination contains the app bundle name and no longer the generic literal.

**To protect a new app customization:** place the modified file under `runtime-overlays/<same relative path>`, add its relative path to the correct list (`OVERLAY_FILES` / `OVERLAY_PRE_REWRITE_FILES` / `PRUNE_FILES`) in `collect-runtime.mjs`, then run `node scripts/collect-runtime.mjs` to prove it. `collect-runtime.mjs` requires `DEVECO_SDK_HOME`; `--verify-only` runs the guards only.

#### Plugins: two directories, two roles

This wrapper's plugins are split by **who can consume them**:

| Directory | Role | Naming |
|---|---|---|
| `../dsh-plugins/` (parent workspace) | **Generic**, pluggable plugins — no dependency on any wrapper-specific patch, so any shell can consume them | `dsh-plugin-XXX` |
| `plugins/` (this project) | **This project's own** plugins — they depend on this wrapper's patch set / profile / runtime adaptations; baked into the HAP at build time and **all loaded by default** at runtime | `harmony-plugin-XXX` |

Either way the directory name equals the npm package name (a bare / unscoped name). The test for which side a plugin belongs on: *"would it still work if installed into another dsh shell (e.g. `deepseek-harness-desktop`)?"* Yes → generic, parent `dsh-plugins/`; no → this project's `plugins/`. See [`plugins/README.md`](plugins/README.md) and [`../dsh-plugins/README.md`](../dsh-plugins/README.md).

- **Materialization is automatic (stage ②).** `scripts/collect-dsh.mjs` → `collectPlugins()` globs `plugins/harmony-plugin-*/`, reads each plugin's `package.json` `name`, and copies the directory to `dsh-dist/node_modules/<name>/` — the same non-scoped layout `dshmarket` uses. The destination name comes from `package.json`, so **a new plugin needs no build-script change**.
- **Failure is loud.** If `plugins/` exists but a matched plugin has no readable `package.json`, or its name does not match `harmony-plugin-*`, the collect stage exits non-zero. If `plugins/` is absent or holds no `harmony-plugin-*` directory, the stage is a no-op with one log line.
- **No keep-list entry.** The plugins land inside `dsh-dist.tar.gz`, and `collectPlugins()` is the last materialization step (after the `.pnpm` removal and the prebuild prune). `APP_KEEP` (in `collect-runtime.mjs`) only guards `resfile/resources/app` — which is why the loose `skills/` directory needs it, while `dshmarket`, shipped in the same node_modules layout as plugins, does not.
- **Mounting.** Agent presets are composed per session, so the host `cordis.patch.yml` cannot reach them: a plugin is mounted by a row in `HARMONY_ENSURED_PRESET_ROWS`. `src-main/main.js` applies those rows at runtime and `collect-dsh.mjs` bakes the same rows into the artifact — the two lists are kept identical. `requireRow` confines a row to presets that already mount it (`minimal` stays untouched).
- **Runtime mirroring.** A bare package name in a preset row is resolved by `dsh-agent-presets`' discovery walking `node_modules` **upward from the profile directory** (`$DSH_HOME/profiles/desktop`), so living in `dsh-dist/node_modules` is not enough: `ensureDshPluginsProfileLink()` (in `src-main/main.js`) copies every `harmony-plugin-*` into `$DSH_HOME/profiles/node_modules/` on each start (copy, not symlink — the HarmonyOS sandbox rejects symlinks with `EACCES`), and prunes same-family stale directories left behind by a rename.

**To add a plugin:** create `plugins/harmony-plugin-XXX/package.json` (name `harmony-plugin-XXX`) plus its `lib/`, add one row to `HARMONY_ENSURED_PRESET_ROWS` in **both** `src-main/main.js` and `scripts/collect-dsh.mjs`, then re-run stage ②.

> ⚠️ A preset row's `name` is a **runtime import specifier**, not a comment: miss one of the two lists and nothing fails at compile time — session creation simply breaks (`agent-preset/invalid`, `row "<id>" names a plugin that cannot be resolved`).

> Each plugin owns its own documentation. See [`plugins/harmony-plugin-fs-mutate/README.md`](plugins/harmony-plugin-fs-mutate/README.md) for its configuration and its **Known Limitations** — most notably that `move` copies text files only, because `ctx.fs.writeText` rejects binary content.

#### Skills: two directories, two roles

Tool skills follow the same two-tier split, with one deliberate difference: **skill names carry no prefix.** A skill's `name` is a model-visible identifier and the string a human types after `/name`, and dsh's own skills are unprefixed too — so ownership is expressed by the **directory**, not the name.

| Directory | Role |
|---|---|
| `../skills/` (parent workspace) | **Generic** — applies to any dsh shell |
| `skills/` (this project) | **This project's own** — describes this wrapper's runtime (HarmonyOS HAP sandbox, `hmdfs`, capability gaps); shipped inside the HAP and provided at runtime as the dsh **bundled** skill root |

- **The wiring is already complete — no build-script change is needed.** Stage ⓪ `collect-runtime.mjs` restores `skills/` into `resfile/resources/app/skills` (`restoreTree`), `APP_KEEP` keeps that directory across re-runs, and `src-main/main.js` sets `DSH_BUNDLED_SKILL_DIR` to it at startup. The directory deliberately sits **outside** `dsh-dist.tar.gz`, so updating a skill needs only a new HAP — no ② collect-dsh, no re-tar, and no clearing the device's extracted `dsh-dist` (it lives under `userData` as a **sibling** of `$DSH_HOME`, not inside `.dsh`).
- **Bundled is the lowest-precedence skill root (rank 600).** A same-named skill in the project (`.dsh/skills`, rank 100) or the user's `$DSH_HOME/skills` (rank 400) **overrides** the bundled one. That follows directly from the rank ordering, and it is the behaviour that lets a user replace built-in behaviour — do not "fix" it, since that would remove the override capability.
- **Loading is lazy, not startup.** At process start only `DSH_BUNDLED_SKILL_DIR` is configured. The model automatically sees just the skill **catalog** (name + a description truncated to 500 chars), injected as a durable user-role message before a session's **first request**; a skill **body** loads on demand via the `skill` tool or a human `/name`, and is never cached. (The catalog is emitted only when the `skill` tool is visible and at least one model-invocable skill exists; an incomplete discovery emits nothing.)
- **The skill format is dsh's, not ours:** top level only (`<name>/SKILL.md` or `<name>.md` — a nested `**/SKILL.md` is not discovered); frontmatter requires `name` + `description`, optionally `whenToUse` / `metadata` / `disable-model-invocation` / `user-invocable` (the camelCase legacy keys are rejected). Full rules in [`skills/README.md`](skills/README.md), generic side in [`../skills/README.md`](../skills/README.md).

> ⚠️ A skill describes this build's **capability boundary**, so a **stale** skill is worse than none: `harmony-runtime-capabilities` once still claimed `delete`/`move` were absent after they shipped, and the model then refused to use the delivered tools. Update the skills that reference a capability whenever that capability changes.

### Signing (externalized — secrets never committed)

Signing material is **externalized** so `build-profile.json5` stays secret-free and safe to commit. There are **two** gitignored config files, one per signing mode:

| Mode | Config (gitignored) | Committed template |
|---|---|---|
| `debug` | `signing.debug.local.json` | `signing.debug.local.json.sample` |
| `release` | `signing.release.local.json` | `signing.release.local.json.sample` |

Both files share the same schema (relative paths resolve against the project root):

```json5
{
  "certpath":      ".ohos/release/release.cer",
  "storeFile":     ".ohos/release/release.p12",
  "profile":       ".ohos/release/release.p7b",
  "keyAlias":      "debugKey",            // optional, defaults to "debugKey"
  "keyPassword":   "<hvigor DecipherUtil AES-GCM ciphertext hex>",
  "storePassword": "<hvigor DecipherUtil AES-GCM ciphertext hex>",
  "signAlg":       "SHA256withECDSA"      // optional, defaults to SHA256withECDSA
}
```

Mode selection is driven by the **`SIGN_MODE`** environment variable (`debug` | `release`); when unset it defaults to `debug`. Any other value is a **hard failure** — there is no silent fallback to `debug`.

- **`hvigorfile.ts`** — at `afterNodeEvaluate`, resolves `app.signingConfigs` in priority order:
  1. CI env vars: all of `CERTPATH` / `STORE_FILE` / `STORE_PASSWORD` / `KEY_PASSWORD` (plus optional `PROFILE` / `KEY_ALIAS` / `SIGN_ALG`)
  2. `signing.<SIGN_MODE>.local.json`
  3. nothing found → `signingConfigs` is left untouched and a **loud warning names the missing path** (the build then yields an unsigned / IDE-auto-signed package)
- Injection is **in-memory only** (`setBuildProfileOpt`): **`build-profile.json5` is committed with `"signingConfigs": []`** and is never written to.
- **`scripts/build-hap.ps1`** — CLI build+sign using DevEco's bundled JBR (avoids the Temurin/sdkman JDK 21 `Invalid CEN header` zip64 failure in `hap-sign-tool.jar`). It sets `SIGN_MODE` for the hvigor child process.

> `keyPassword` / `storePassword` in either config **must be hvigor DecipherUtil AES-GCM ciphertext** (≥32 hex chars, not plaintext), and the `.p12` directory must contain the `material/{fd,ac,ce}` keychain — otherwise signing fails.

> **Post-build signature assertion.** After a successful build, `build-hap.ps1` runs the SDK's `hap-sign-tool verify-app` on the produced artifact, extracts the embedded provisioning profile's `type`, and compares it with the requested `-SignMode`. A mismatch is a prominent error with a non-zero exit. (The `.p7b` is binary, so the profile JSON is located via a Latin-1 byte mapping plus brace-matching.) This guard exists because the project previously shipped a release build that was silently signed with debug material.

> **dsh version pin.** This project builds against deepseek-harness tag **`dsh-v0.1.5-rc.2`**. Patches are organized per dsh version (`patches/<dsh-tag>/`) and `scripts/build-dsh.mjs` pins `patches/dsh-v0.1.5-rc.2/` — when bumping to a new dsh tag, add a matching `patches/<new-tag>/` directory and update that pin.

| Patch | Purpose |
|---|---|
| `patches/dsh-v0.1.5-rc.2/dsh-symlink-to-copy.patch` | HarmonyOS sandbox forbids symlink (`EACCES`) → fall back to `cpSync` recursive copy |
| `patches/dsh-v0.1.5-rc.2/dsh-allow-all-interfaces.patch` | Remove webserver's `--host 0.0.0.0` rejection check (loopback isolation requires binding all interfaces + LAN IP) |
| `patches/dsh-v0.1.5-rc.2/dsh-disable-hmr.patch` | Add `DSH_DISABLE_HMR` switch, skipping watch-only HMR (HMR depends on `--expose-internals`) |
| `patches/dsh-v0.1.5-rc.2/dsh-disable-native-picker.patch` | Force directory-picker to use browse (native dialog worker fails to spawn under Electron) |
| `patches/dsh-v0.1.5-rc.2/dsh-flock-openharmony.patch` | Grant the POSIX flock write lock in-process on `openharmony` (no native addon; single-process host, same rationale as dsh's browser-worker stub) |
| `patches/dsh-v0.1.5-rc.2/dsh-hardlink-to-rename.patch` | HarmonyOS sandbox refuses hard links (`EACCES`) → publish exclusively by same-directory `rename`, keeping the `link`-then-`EEXIST` preference everywhere else (session-log materialization + generation publication) |
| `patches/dsh-v0.1.5-rc.2/dsh-fs-hardlink-fallback.patch` | Also refuses hard links on hmdfs user-directory mounts (`EPERM`, no `.link` handler) → `writeFileAtomic`'s guarded-create path falls back to a same-directory `rename` when the target is verified absent, instead of failing the create with `FS_IO_ERROR`. Scoped to `fs-local`; the link preference is unchanged wherever links work |
| `patches/dsh-v0.1.5-rc.2/dsh-fs-remove-primitive.patch` | Adds the `ctx.fs` seam's missing `remove` mutation primitive so a file tool can delete through the same sandbox fence as write/edit: a **non-abstract** `FileSystem.remove` whose default body throws (an abstract member would fail compilation for the six concrete `extends FileSystem` classes), a `fs-local` implementation in its own `remove.ts`, and a `fs-sandbox` override that runs `checkedTarget` first |
| `patches/dsh-v0.1.5-rc.2/dsh-disable-lefthook-postinstall.patch` | Drops dsh's root `postinstall` (the lefthook git-hook installer). It refuses any checkout whose common git config carries `core.worktree` — true of every submodule checkout — so `collect-dsh`'s `pnpm deploy` aborted with `ELIFECYCLE`. Git hooks are irrelevant to a shipped HAP, and the installer never succeeded here (`dsh-hooks/` is absent) |
| `patches/dsh-v0.1.5-rc.2/dsh-fs-write-bytes.patch` | Adds the `ctx.fs` seam's missing `writeBytes` mutation so a file tool can publish raw bytes behind the same sandbox fence as `writeText`: a **non-abstract** `FileSystem.writeBytes` whose default body throws, a `fs-local` implementation reusing the atomic-write path undecoded, and a `fs-sandbox` override that runs `checkedTarget` first |
| `patches/dsh-v0.1.5-rc.2/dsh-fs-chmod-primitive.patch` | Adds the `ctx.fs` seam's missing `chmod` mutation: a **non-abstract** `FileSystem.chmod` whose default body throws, a `fs-local` implementation (`chmod.ts`) that applies the bits and **reads them back**, failing when the storage layer accepted the call without applying the mode (the HarmonyOS `hmdfs` user mounts do), and a `fs-sandbox` override that runs `checkedTarget` first |
| `patches/dsh-v0.1.5-rc.2/dsh-extra-writable-roots.patch` | Teaches `writableRoots()` to honour `DSH_EXTRA_WRITABLE_ROOTS` (a `path.delimiter`-separated list) as deployment state, so a product can grant the user's Desktop/Documents/Download directories once at startup instead of leaving every write inside them to a per-operation escalation |
| `patches/dsh-v0.1.5-rc.2/dsh-attachment-durable-walk-sandbox.patch` | The attachment store fsyncs every ancestor directory up to the filesystem root, but the HarmonyOS sandbox denies `open()` on `/`, `/data`, `/data/storage` and `/data/storage/el2`. `syncDirectory()` now ends its participation at the first directory the platform refuses to open — matching the existing Windows early return — instead of failing the save |

**Prerequisite — sibling source checkouts.** This project consumes 3 sibling projects (not submodules); clone them next to this project before building:

```bash
git clone --branch dsh-v0.1.5-rc.2 https://github.com/deepseek-ai/deepseek-harness.git ../deepseek-harness
git clone --branch v1.26.0           https://github.com/dsh-market/dsh-market.git       ../dsh-market
# ../harmonypc-electron is the Electron-on-HarmonyOS runtime project; extract the Electron 37 build artifacts to supply the 3 SOs
```

`collect-runtime.mjs` validates the 3 SOs (`libelectron.so`/`libadapter.so`/`libffmpeg.so`) and errors if any is missing; `collect-dsh.mjs` hard-fails if `../dsh-market` is missing (the packaged app bundles it as `dsh-dist/node_modules/dshmarket`).

### Run

Build with the dedicated scripts (config/`SIGN_MODE` details in [Signing](#signing-externalized--secrets-never-committed)):

```powershell
# debug (default task: Hap) — debug-signed packages CAN be side-loaded
powershell -ExecutionPolicy Bypass -File scripts\build-debug.ps1

# release (default task: App) — produces build\outputs\default\*-signed.app
#   + build\outputs\default\symbol\release\app-symbol.zip
powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1

# release-compiled but debug-signed — needed for on-device regression
powershell -ExecutionPolicy Bypass -File scripts\build-hap.ps1 -BuildMode release -SignMode debug
```

`scripts/build-hap.ps1` is the engine (params: `-Task Hap|App`, `-BuildMode debug|release`, `-SignMode auto|debug|release`, plus `-JbrHome -SdkHome -NodeHome -Hvigorw -DevEcoHome`); `-SignMode auto` (the default) resolves to `-BuildMode`. The two thin wrappers pin their own defaults: `build-debug.ps1` always uses `-BuildMode debug -SignMode debug`, `build-release.ps1` always uses `-BuildMode release -SignMode release`.

Install the debug build over HDC and launch it:

```bash
hdc tconn <device-ip>:<port>   # wireless (IP) debugging first; the port is shown by Developer options → Wireless debugging
hdc uninstall org.fellow99.DeepseekHarnessHarmony   # uninstall first on fresh install / artifact change, to clear stale dsh-dist in userData
hdc app install -r electron/build/default/outputs/default/electron-default-signed.hap
hdc shell aa start -a EntryAbility -b org.fellow99.DeepseekHarnessHarmony
```

> ⚠️ **Release-signed packages cannot be side-loaded.** `hdc app install` on a release-signed package fails with `code:9568322 ... signature verification failed due to not trusted app source`. For on-device regression use `-BuildMode release -SignMode debug` (release-compiled, debug-signed); release-signed packages exist only for AppGallery submission.

> Requirements: DevEco Studio 4.0+, HarmonyOS SDK API 17+ (targetSdk 6.1.1(24)), Node 18+, pnpm@11, HDC.

### Debugging a packaged app on device

Everything below runs against an **installed** debug-signed HAP — no rebuild, no code change.

#### Main-process inspector (the most capable entry point)

The runtime already launches Electron with `--inspect`, so the main process exposes a Node inspector on port 9229. That inspector context has `require`, which reaches `electron` — so it can both query the dsh Host and drive the renderer.

```bash
export MSYS_NO_PATHCONV=1   # Git Bash otherwise rewrites /data/... into a Windows path
hdc fport tcp:19229 tcp:9229            # local 19229 → device 9229 (non-default local port avoids clashes)
curl -s http://127.0.0.1:19229/json/list   # note the webSocketDebuggerUrl
```

Evaluate over CDP with Node's global `WebSocket` (Node ≥ 22):

```js
// cdp.mjs <ws-url> <expression | @file>
import { readFileSync } from 'node:fs';
const [wsUrl, arg] = process.argv.slice(2);
const expression = arg.startsWith('@') ? readFileSync(arg.slice(1), 'utf8') : arg;
const ws = new WebSocket(wsUrl);
ws.addEventListener('open', async () => {
  const send = (method, params) => new Promise(resolve => {
    const id = Math.floor(Math.random() * 1e9);
    const onMessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      resolve(msg.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable', {});
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  console.log(result.exceptionDetails
    ? 'EXCEPTION: ' + result.exceptionDetails.exception?.description
    : JSON.stringify(result.result?.value, null, 1));
  process.exit(0);
});
```

Useful expressions:

```js
// which windows exist, and what URL each is on
(async () => { const { BrowserWindow } = require('electron'); return JSON.stringify(BrowserWindow.getAllWindows().map(w => w.webContents.getURL())); })()
// read the renderer's visible text
(async () => { const { BrowserWindow } = require('electron'); return await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('document.body.innerText'); })()
```

**Typing into the composer.** It is a `contenteditable` rich-text editor, not a `<textarea>`, and it is React-controlled — assigning `value` or `innerText` does not register. Use CDP `Input.insertText` against the attached debugger:

```js
(async () => {
  const { BrowserWindow } = require('electron');
  const wc = BrowserWindow.getAllWindows()[0].webContents;
  const SEL = '[contenteditable="true"][role="textbox"]';
  await wc.executeJavaScript(`document.querySelector('${SEL}').focus()`);
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Input.insertText', { text: '…' });
  return await wc.executeJavaScript(`document.querySelector('${SEL}').innerText.length`);
})()
```

To send, click the button whose `aria-label` is `发送消息`.

#### Why an external browser (Playwright and friends) cannot be used

Every Host RPC method requires one browser session: `GET /` accepts the launch token only as `?token=<launchToken>` and writes an authority-bound signed cookie, while a missing cookie returns **401 before RPC dispatch**. The launch token is never logged (`web-runtime` runs with `printUrl: false`), and the renderer redirects to a clean `/` after the exchange — so an external browser cannot authenticate, not even through `hdc fport`.

#### Renderer UI automation via `uitest` (clicks only)

```bash
hdc shell uitest dumpLayout -p /data/local/tmp/layout.json
hdc file recv /data/local/tmp/layout.json ./layout.json   # every node's text and bounds
hdc shell uitest uiInput click <x> <y>                     # clicks DO reach the Web content
```

- ⚠️ `uitest uiInput text` and `uiInput keyEvent` do **not** reach Web content (the editor is not a native control) — use the inspector's `Input.insertText` for text.
- The dump spans the whole screen, so other windows (system Settings, for example) appear alongside the app. Run `hdc shell aa start -a EntryAbility -b org.fellow99.DeepseekHarnessHarmony`, then re-dump, to confirm the app is in the foreground before clicking.

#### Is the Host up, and on which port?

```bash
hdc shell "hilog -x | grep dsh-harmony | tail -20"   # "host 就绪: http://<lan-ip>:<port>/"
```

Probing `http://127.0.0.1:<port>/` through `hdc fport` and getting **401** confirms the webserver is reachable and its auth fence is active.

> ⚠️ **Security.** `--inspect` lets anyone with `hdc` fully control the host process (`require` is available in that context). It comes from the upstream runtime's default arguments, not from this project. That is acceptable for local debugging, but evaluate removing it from a release build before AppGallery submission.

### Signing & restricted permissions (full procedure)

The app cannot be installed until its provisioning profile (`.p7b`) grants
`ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` (a `system_basic` restricted
permission, `system_grant`, tablet/2in1 only). There are two ways to obtain it:

**A. Release path (AppGallery) — apply for the permission as an ACL in AGC**

A restricted permission is **not** obtained by hand-editing a profile. The app applies for an
**ACL** (跨级别权限) in AppGallery Connect, Huawei reviews the usage scenario, and the approved
permissions are **written into the profile automatically** when the release profile is created —
so the release signing path needs no manual `.p7b` surgery at all.

1. AGC → 开发与服务 → your project → your app → `项目设置` → **ACL权限** tab.
2. Under 未获取权限 tick 我已知晓, select `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`, and submit 申请
   (at most 30 permissions per application; wait for approval before a new application).
3. Review (≈ 3 business days) checks that the permission matches the app's usage scenario — this app
   enables the JIT compilation feature of a bundled engine, is tablet/2in1 only, does not use the
   permission for hot updates, and adapts to JShield mode (坚盾模式).
4. Create the **release profile** in AGC *after* approval — the granted ACL permissions are written into
   it automatically. **If the ACL permissions change after the profile was created, recreate the profile.**
5. Currently only developer accounts registered in **mainland China** can use ACL permissions.

See [AppGallery submission](#appgallery-submission) for the full release-certificate / release-profile flow.

**B. Debug path — regenerate the debug profile in DevEco (unchanged)**

The `.p7b` provisioning profile is signed by Huawei — it **cannot be regenerated locally**
(no local profile-signing CA; editing the SDK `Unsigned*ProfileTemplate.json` does not
auto-regenerate an existing `.p7b`). A default DevEco debug profile does **not** grant the
restricted permission, so installing a debug build fails with:

> `install failed due to grant request permissions failed. PermissionName: ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`

Regenerate it in DevEco Studio:

1. Open the project in DevEco Studio.
2. `File → Project Structure → Signing Configs`.
3. Tick **Automatically generate signature** and log in with your Huawei developer account.
4. DevEco regenerates a debug keystore + provisioning profile under `~/.ohos/config/`
   (`<bundle>_…=.p12/.cer/.p7b` + `material/` keychain).
5. Ensure the requested permissions include the restricted one. The module already
   declares it (`web_engine/src/main/module.json5` → `requestPermissions` + `definePermissions`
   → `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`). For a cross-level (ACL) grant on a
   `normal`-APL app, DevEco's signing dialog surfaces the restricted permission for approval;
   accept it so the regenerated `.p7b` carries it in `acls.allowed-acls`.
6. Point `signing.debug.local.json` at the regenerated material (template:
   `signing.debug.local.json.sample`; paths relative to the project root are fine).

**Build + sign**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-debug.ps1     # debug
powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1   # release (App Pack)
```

`build-hap.ps1` verifies after every build that the artifact's embedded profile `type` matches the
requested signing mode (see [Signing](#signing-externalized--secrets-never-committed)).

**Install & launch**

```bash
hdc uninstall org.fellow99.DeepseekHarnessHarmony
hdc app install -r electron/build/default/outputs/default/electron-default-signed.hap
hdc shell aa start -a EntryAbility -b org.fellow99.DeepseekHarnessHarmony
```

> If install still reports a permission grant failure for a debug build, the `.p7b` does not yet carry the
> restricted permission — repeat the DevEco regeneration (confirm the ACL approval) before rebuilding.
> A *release*-signed package can never be installed this way; release signing is for AppGallery only.

## AppGallery submission

Distribution is no longer "personal-use HAP only": shipping on **AppGallery** is now an objective.
AppGallery only accepts packages signed with a Huawei-issued **release certificate + release profile** —
debug-signed packages cannot be listed.

### Prerequisites

- A **real-name-verified (实名认证) Huawei developer account** — required to create a release certificate.
- Currently the ACL permissions this app needs are only available to developer accounts registered in
  **mainland China**.
- Qualification material: release preparation on AGC asks for items such as a privacy statement, an
  electronic copyright certificate, and an app copyright or agency certificate, plus filing/approval —
  confirm the exact list on AGC's 发布准备工作 page. The APP software copyright certificate (软著) is a
  **non-mandatory** qualification for non-game apps (recommended variants: 计算机软件著作权登记证书 /
  APP 电子版权证书 / 软件著作权认证证书); games additionally require a license number (版号).

### Size limits

| Artifact | Limit |
|---|---|
| App Pack (`.app`) | ≤ **4GB** |
| HAP — PC/2-in-1, tablet, phone | ≤ **4GB** |
| HAP — smartwatch / smart display | ≤ 2GB |
| HAP — sports watch | ≤ 20MB |

This project's release HAP is ≈360MB and the App Pack ≈245MB — well within the limits. HAPs must not be
`installationFree`, and `bundleType` must be `app`.

### 1. Create a release certificate

AGC → `证书、APP ID和Profile` → `证书` → `新增证书`, type **发布证书**, upload a `.csr` (generate it in
DevEco Studio via `Build > Generate Key and CSR`, or with `keytool`), then download the `.cer`.

- Max **3 release certificates** per account; validity **3 years** for real-name-verified developers.
- Updating a release certificate requires updating the release profile too.

### 2. Apply for the restricted permission (ACL)

AGC → 开发与服务 → your project → your app → `项目设置` → **ACL权限** tab → under 未获取权限 tick
我已知晓 → select `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` → 申请.

- At most **30** permissions per application; wait for approval before making a new application.
- Some permissions require 申请原因 (≤256 chars), a 使用场景 selection, and optional attachments.
- Review after application is ≈ **3 business days**.
- Once approved, the permission appears under 已获取权限 and is **automatically written into the profile**
  when it is created. **If the ACL permissions change after the profile was created, the profile must be
  recreated.**
- A 试用调试Profile (trial debug profile) also exists: 5-day validity, max 5 per app.

The permission itself is officially classified as level `system_basic`, grantMode `system_grant`,
type 受限开放权限, `startVersion` API 14; available **only for tablet and PC/2-in-1** devices; permitted
**only for apps that enable the JIT compilation feature of a bundled engine** and **not permitted for hot
updates**; the app must actively adapt to **JShield mode (坚盾模式)** and must not crash under it.

### 3. Create a release profile

AGC → `证书、APP ID和Profile` → `Profile` → `添加`, type **发布**, bound to the bundle name + a release
certificate. Unlike a debug profile, a release profile's device list is **empty** (not device-bound).

### 4. Build, version and upload

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1   # -Task App -BuildMode release -SignMode release
```

- Upload the signed App Pack: `build\outputs\default\*-signed.app`.
- Optionally upload `build\outputs\default\symbol\release\app-symbol.zip` so crash reports can be
  symbolicated.
- `versionCode` (currently `1005`) must be a number and must **strictly increase** on every subsequent
  submission — see [Current versions](#current-versions).
- There is **no separate PC/2-in-1 review track** in the official review guide. At submission, if the
  package supports PC/2-in-1 but the configured distribution devices do not include it, AGC prompts you
  to update the supported devices.

> **To be confirmed:** the end-to-end review duration for the AppGallery listing itself (only the ACL
> review's ≈3 business days is documented above), and the exact release-preparation document set — both
> must be read off AGC's own pages before the first submission.

## Directory structure

This project and the 3 consumed projects plus 1 architecture-reference project live in **sibling directories** (not submodules):

```
(sibling directories)
├── deepseek-harness-harmony/      # This project (HarmonyOS HAP, HarmonyOS desktop port)
│   ├── AppScope/                  # App scope (icon/name/signing)
│   ├── electron/                  # Entry module (copied from harmonypc-electron, contains SOs)
│   ├── web_engine/                # Bridge HAR (ArkTS bridge layer + resfile carries dsh artifacts)
│   ├── src-main/                  # Main process main.js (extract + runProfile + loadURL + HarmonyOS adaptations)
│   ├── scripts/                   # Four-stage build: collect-runtime → build-dsh → collect-dsh, plus build-debug / build-release
│   ├── runtime-overlays/          # App customizations re-applied after every runtime copy (prune + overlay)
│   ├── profiles/desktop/          # Custom desktop profile (cordis.patch.yml + package.json)
│   ├── patches/                   # dsh upstream patches (13)
│   ├── docs/                      # Engineering plan and final implementation record
│   ├── plugins/                   # This project's own plugins (harmony-plugin-XXX; baked into the HAP, all loaded by default)
│   ├── skills/                    # This project's own tool skills (kebab-case, no prefix; shipped in the HAP as the bundled skill root)
│   └── specs/                     # Spec documents (as-built; see specs/README.md for index)
│
├── harmonypc-electron/            # Electron-on-HarmonyOS runtime (Electron 37 / Node 22.17.0)
│   └── ohos_hap/                  # electron + web_engine modules + SO source (collect-runtime copy source)
│
├── deepseek-harness/              # The wrapped host (dsh, source reference, not a submodule)
│   ├── apps/                      # cli (dsh bin / profile-boot), web (frontend, build:web produces dist)
│   ├── packages/                  # host / client / core / session workspace packages
│   ├── vendor/                    # vendored cordis framework packages (cordis / loader / hmr / …)
│   └── native/                    # landlock-run native module (Linux sandbox, cut in MVP)
│
└── dsh-market/                    # Plugin marketplace (source reference, npm pkg "dshmarket")
    ├── src/                       # host half (mounts /dsh-market/* routes)
    ├── client/                    # browser half (settings-page UI)
    ├── lib/                       # compiled host output (materialized into dsh-dist/node_modules/dshmarket)
    └── cordis.patch.yml           # loader insert declaration ({ id: dsh-market, name: dshmarket })
```

> `../deepseek-harness-desktop` is an **architecture-design reference** (reuses its architecture decisions + patches + main-process orchestration logic) and does not participate in this project's build/packaging.

## Related docs

- [docs/工程规划.md](docs/工程规划.md) — full engineering plan + final implementation record (Electron 37 landing, key adaptation changes, MVP trade-offs, cross-compilation optimization path)
- [specs/README.md](specs/README.md) — spec document index (project-level + 9 module spec/plan, as-built)

## References

- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (sibling directory `../deepseek-harness`) — the wrapped host; its `docs/` directory contains full architecture docs
- [dsh-market](https://github.com/dsh-market/dsh-market) (sibling directory `../dsh-market`) — the built-in visual plugin marketplace (npm package `dshmarket`), materialized via `collect-dsh.mjs`
- [harmonypc-electron](https://atomgit.com/jianguoxu/harmonypc-electron) (sibling directory `../harmonypc-electron`) — the Electron-on-HarmonyOS runtime
- [deepseek-harness-desktop](https://github.com/fellow99/deepseek-harness-desktop) (sibling directory `../deepseek-harness-desktop`) — architecture-design reference (Electron desktop shell)

## License

[MIT](LICENSE) © 2026 fellow99
