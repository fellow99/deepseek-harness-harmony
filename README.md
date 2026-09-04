[中文](./README_zh.md) | English

---

# DeepSeek Harness HarmonyOS Desktop

> A HarmonyOS desktop wrapper for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) built on the "Electron-on-HarmonyOS" runtime ([harmonypc-electron](https://atomgit.com/jianguoxu/harmonypc-electron), Electron 37 / Node 22.17.0) — runs the dsh Host (with webserver) inside the Electron main process on HarmonyOS devices, and the renderer loads the dsh Web UI same-origin, 100% reusing the dsh Web UI.

**Status**: ✅ Verified on device — HarmonyOS 6.1.0.135 (API 24), Electron 37 / Node 22.17.0, dsh Web UI runs normally (core chat / agent / tool calling / Web UI all functional). See [docs/工程规划.md](docs/工程规划.md) for the full engineering plan and final implementation record.

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

Key point: **the renderer loads same-origin — zero CORS, zero auth, zero custom protocol, zero IPC carrier** — reusing dsh's existing `WebApiClient` (HTTP uplink + WebSocket downlink), **zero upstream changes** (only 4 patches).

**Differences from desktop** (HarmonyOS-specific adaptations, see `docs/工程规划.md` §18):

- HarmonyOS NEXT isolates renderer access to `127.0.0.1` (**loopback network isolation**) → webserver binds `0.0.0.0` and the renderer connects via the LAN IP, with the embedded renderer's outgoing requests rewriting `Host`/`Origin` to `127.0.0.1:<port>` before they leave the session, so dsh's loopback-only privileged-method fence passes (security semantics unchanged — other LAN devices still get 403).
- HarmonyOS sandbox forbids symlink (`EACCES`) → dsh profile falls back to `cpSync` recursive copy (patch).
- `os.homedir()` returns an out-of-sandbox directory (`EPERM`) → the main process points `HOME` at the sandbox-writable `userData` directory before startup.

## MVP capabilities

- ✅ dsh Web UI runs in a window (100% reuses dsh frontend)
- ✅ Session persistence / full-text search (better-sqlite3, Electron 37 / Node ABI v138 aarch64 artifact, injected by collect-dsh)
- ✅ Plugin marketplace (dsh-market built-in)
- ⚠️ Image attachment validation/thumbnails (sharp pure-JS stub, no-op)
- ❌ Terminal (bash tool, node-pty has no aarch64 artifact)
- ❌ Process sandbox (koffi / landlock)

(Phase 2: system tray, frameless window, launch at login; native file picker reuses dsh's standard frontend directory browser)

## Target platforms & distribution

- **Platforms**: HarmonyOS 2in1 / tablet (`deviceTypes: ["2in1", "tablet"]`)
- **Distribution**: local signed HAP for personal use (DevEco auto-signing + Huawei cert); no store distribution, auto-update, or code signing yet

## Tech stack

- **Electron-on-HarmonyOS** (harmonypc-electron, Electron 37 / Node 22.17.0) — native SO + ArkTS bridge layer (aki / adapter / addon + libshim.a)
- **ArkTS / ArkUI** (Stage model, `web_engine` HAR bridge: ~46 Adapters + ~44 AdapterBinds)
- **deepseek-harness** (sibling directory `../deepseek-harness`, not a submodule, source reference; patch baseline `dsh-v0.1.0-rc.7`)
- **dsh-market** (sibling directory `../dsh-market`, npm package `dshmarket`, built-in plugin marketplace)
- **hvigor / DevEco Studio** (HAP build + signing)

## Development

### Integration approach

- **Runtime copy**: `harmonypc-electron` is a sibling HarmonyOS project (not an npm package); `collect-runtime.mjs` physically copies its `electron` + `web_engine` modules + 3 SOs into this project at build time (sibling layout, artifact embedding), and injects `libc++_shared.so`.
- **Source reference**: dsh and dsh-market are sibling-directory source references (not submodules), consumed via patch + build + artifact collection.
- **Host integration**: `src-main/main.js` dynamically imports dsh's `runProfile` (apps/cli build artifact), hosting the dsh Host in-process (webserver bound to `0.0.0.0`), returning a `{ ctx, shutdown, port, url }` handle.
- **Same-origin data plane**: the renderer does `loadURL(http://<LAN IP>:<port>/)` to load the dsh Web UI same-origin, reusing `WebApiClient` — zero CORS, zero auth, zero new carrier.
- **desktop profile**: `profiles/desktop/` (`dsh.profile.bundles = [dsh-base, dsh-web-app, dshmarket]`, cordis.patch.yml overriding `web-runtime.printUrl: false`, `webserver.host: 0.0.0.0`), copied to `$DSH_HOME/profiles/desktop` at runtime.

### Build process (three stages + 4 patches)

dsh depends on Node internal APIs (HMR, native directory dialog) and conflicts with the HarmonyOS sandbox (symlink, loopback isolation), so 4 patches must be applied first (idempotent — `--reverse --check` detects already-applied and skips):

```bash
# ① collect runtime: copy ../harmonypc-electron's electron + web_engine modules + 3 SOs + libc++_shared.so
node scripts/collect-runtime.mjs

# ② build dsh: clean workspace residue → apply 4 patches → pnpm build host/client/web → build ../dsh-market
node scripts/build-dsh.mjs

# ③ collect dsh artifacts: pnpm deploy materialize → fill packages → sharp stub → better-sqlite3 injection → web dist + profile + dshmarket
node scripts/collect-dsh.mjs

# ④ compress dsh-dist into dsh-dist.tar.gz (--format=ustar, ~143MB, streaming decompression at runtime)
tar -czf web_engine/src/main/resources/resfile/resources/app/dsh-dist.tar.gz --format=ustar -C . dsh-dist

# ⑤ build + sign HAP (DevEco Studio or hvigor CLI)
#    NODE_HOME=<DevEco>/tools/node DEVECO_SDK_HOME=<sdk>  ohpm install  hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
```

| Patch | Purpose |
|---|---|
| `patches/dsh-symlink-to-copy.patch` | HarmonyOS sandbox forbids symlink (`EACCES`) → fall back to `cpSync` recursive copy |
| `patches/dsh-allow-all-interfaces.patch` | Remove webserver's `--host 0.0.0.0` rejection check (loopback isolation requires binding all interfaces + LAN IP) |
| `patches/dsh-disable-hmr.patch` | Add `DSH_DISABLE_HMR` switch, skipping watch-only HMR (HMR depends on `--expose-internals`) |
| `patches/dsh-disable-native-picker.patch` | Force directory-picker to use browse (native dialog worker fails to spawn under Electron) |

**Prerequisite — sibling source checkouts.** This project consumes 3 sibling projects (not submodules); clone them next to this project before building:

```bash
git clone --branch dsh-v0.1.0-rc.7 https://github.com/deepseek-ai/deepseek-harness.git ../deepseek-harness
git clone --branch v1.26.0           https://github.com/dsh-market/dsh-market.git       ../dsh-market
# ../harmonypc-electron is the Electron-on-HarmonyOS runtime project; extract the Electron 37 build artifacts to supply the 3 SOs
```

`collect-runtime.mjs` validates the 3 SOs (`libelectron.so`/`libadapter.so`/`libffmpeg.so`) and errors if any is missing; `collect-dsh.mjs` hard-fails if `../dsh-market` is missing (the packaged app bundles it as `dsh-dist/node_modules/dshmarket`).

### Run

```bash
hdc uninstall com.huawei.ohos_electron   # uninstall first on fresh install / artifact change, to clear stale dsh-dist in userData
hdc app install -r electron/build/default/outputs/default/electron-default-signed.hap
hdc shell aa start -a EntryAbility -b com.huawei.ohos_electron
```

> Requirements: DevEco Studio 4.0+, HarmonyOS SDK API 17+ (targetSdk 6.1.1(24)), Node 18+, pnpm@11, HDC.

## Directory structure

This project and the 3 consumed projects plus 1 architecture-reference project live in **sibling directories** (not submodules):

```
(sibling directories)
├── deepseek-harness-harmony/      # This project (HarmonyOS HAP, HarmonyOS desktop port)
│   ├── AppScope/                  # App scope (icon/name/signing)
│   ├── electron/                  # Entry module (copied from harmonypc-electron, contains SOs)
│   ├── web_engine/                # Bridge HAR (ArkTS bridge layer + resfile carries dsh artifacts)
│   ├── src-main/                  # Main process main.js (extract + runProfile + loadURL + HarmonyOS adaptations)
│   ├── scripts/                   # Three-stage build: collect-runtime → build-dsh → collect-dsh
│   ├── profiles/desktop/          # Custom desktop profile (cordis.patch.yml + package.json)
│   ├── patches/                   # dsh upstream patches (4)
│   ├── docs/                      # Engineering plan and final implementation record
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
