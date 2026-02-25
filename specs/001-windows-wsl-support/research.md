# Research: Windows WSL2 Support

## R-001: node-pty on Windows with ConPTY

**Decision:** Use node-pty directly on Windows — no special wrapper needed. Spawn `wsl.exe` as the PTY executable to get a Linux shell.

**Rationale:**
- node-pty includes native Win32 ConPTY support (requires Windows 10 build 18309+, which is within our Windows 10 21H2+ minimum).
- Win32 prebuilds for `x64` and `arm64` are included in the node-pty npm package. `asarUnpack: ["**/node-pty/**"]` already in `package.json` handles unpacking.
- ConPTY handles `wsl.exe` as the spawned process correctly — no special treatment needed.
- Terminal resize works via `pty.resize(cols, rows)` which calls `ResizePseudoConsole()` internally.
- Pass `--` as a regular array element: `['--', command, ...args]` — node-pty does not interpret it specially.

**Alternatives considered:**
- Using a separate WSL-side Node.js bridge over named pipes — rejected as over-engineered for initial support.
- winpty — deprecated and removed from node-pty.

---

## R-002: WSL Path Translation

**Decision:** Use simple regex for the Windows→WSL mount conversion (`C:\` → `/mnt/c/`). Strongly recommend users store repos in WSL-native storage (`/home/…`) to avoid the performance and symlink issues.

**Rationale:**
- `wslpath` exists only inside WSL; calling it via `wsl.exe wslpath -u "C:\..."` works but adds subprocess overhead on every path operation.
- Simple regex is deterministic and fast: replace drive letter + backslashes inline.
- `/mnt/c/…` paths suffer 10–50× slower git I/O due to cross-filesystem overhead and require Developer Mode for symlinks.
- WSL-native storage (`/home/alice/projects/`) has no such restrictions and is the primary tested path.

**Alternatives considered:**
- UNC path format (`\\wsl$\Ubuntu\…`) — read-only in most contexts, not suitable for git operations.
- Storing repos in Windows FS only — rejected; symlinks do not work without Developer Mode.

---

## R-003: WSL2 Detection at App Startup

**Decision:** Two-step detection using `wsl.exe --version` (presence + WSL2 check) then `wsl.exe --list --verbose` (default distro name). Cache results in process environment at startup. 5-second timeout per call.

**Rationale:**
- `wsl.exe --version` is the fastest unambiguous check; unavailable on WSL1 (which lacks this flag), confirming WSL2.
- `--list --verbose` output marks the default distro with `*` at line start, reliably parsed with a simple regex.
- Caching in `process.env.WSL_DISTRO` and `process.env.WSL_PATH` avoids re-detection on every PTY/git call.
- 5-second timeout aligns with FR-011 and allows for cold WSL2 bootstrap on first launch.

**Alternatives considered:**
- Checking registry for WSL installation — fragile across Windows versions.
- Using `wsl.exe --status` — output format varies across WSL versions.

---

## R-004: NSIS electron-builder Configuration

**Decision:** Use the config from `port/windows-native-approach.md` as-is. The existing `asarUnpack` config is already correct.

**Rationale:**
- `win` target with `[{ "target": "nsis", "arch": ["x64", "arm64"] }]` produces two separate installers.
- node-pty prebuilds for `win32-x64` and `win32-arm64` are automatically included when `asarUnpack: ["**/node-pty/**"]` is set.
- `allowToChangeInstallationDirectory: true` is safe; no auto-updater is currently used.
- A `build/icon.ico` multi-resolution icon file must be added to the repo.

**Alternatives considered:**
- Portable exe (no installer) — rejected; worse UX for Windows users unfamiliar with portable apps.
- Single universal installer — not supported by electron-builder NSIS for different CPU architectures.

---

## R-005: IPC Channel Impact

**Decision:** No new IPC channels are required. All Windows-specific logic is encapsulated within existing handler implementations (`pty.ts`, `git.ts`, `register.ts`). The channel contract remains unchanged.

**Rationale:**
- PTY spawn, resize, and kill channels already exist. The Windows change is purely in how the command is constructed before calling `pty.spawn()`.
- Git operations use the same channel names; the `wsl.exe` delegation is internal to handler implementations.
- `validatePath` change in `register.ts` is additive (accepts Win32 paths in addition to POSIX paths).

**Alternatives considered:**
- Adding a `IPC.WslStatus` channel to expose WSL detection status to the renderer — deferred to a future UX enhancement if a status indicator is needed.
