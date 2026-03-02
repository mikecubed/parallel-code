import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { toWslPath, toWinPath } from '../lib/wsl.js';

const execFileRaw = promisify(execFile);

const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

/**
 * On Windows, a PTY process may still be alive (and holding a directory handle)
 * for a brief window after being signalled. Retry with backoff before giving up.
 */
async function rmDirWithRetry(p: string, maxAttempts = 4, baseDelayMs = 250): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
      return;
    } catch (e) {
      lastErr = e;
      await new Promise<void>((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Convert a POSIX path to a Windows-accessible path for Node.js fs operations.
 * On non-Windows platforms the path is returned unchanged.
 */
function fsPath(p: string): string {
  if (process.platform !== 'win32') return p;
  return toWinPath(p, process.env.WSL_DISTRO ?? 'Ubuntu');
}

/**
 * On PowerShell-only Windows (no WSL), convert any stored POSIX path
 * (e.g. /mnt/c/Users/...) to a Windows path for use with native git args.
 * Uses forward slashes so git accepts the path cross-platform.
 * Returns the path unchanged on all other platforms or when WSL is active.
 */
function toNativePath(p: string): string {
  if (process.platform !== 'win32' || process.env.WSL_DISTRO) return p;
  if (!p.startsWith('/')) return p; // already a Windows path
  return toWinPath(p, '').replace(/\\/g, '/');
}

/**
 * Join path segments using POSIX separators.
 * All stored paths are POSIX on Windows too, so path.join (win32) would
 * produce wrong separators.
 */
function pjoin(...parts: string[]): string {
  return parts
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^(.+)\/$/, '$1');
}

/**
 * Execute a git command, delegating through wsl.exe on Windows when WSL2 is
 * available so that git runs inside the WSL2 distro rather than Windows git.
 * When WSL2 is absent (PowerShell-only), native Windows git is used directly.
 */
async function gitExec(
  args: string[],
  options?: { cwd?: string; maxBuffer?: number },
): Promise<{ stdout: string; stderr: string }> {
  const cwd = options?.cwd;
  const maxBuffer = options?.maxBuffer ?? MAX_BUFFER;

  if (process.platform === 'win32') {
    if (process.env.WSL_DISTRO) {
      // WSL2 available — run git inside the distro.
      // Node.js can't use a WSL path as cwd for a Windows process, so pass
      // the working directory via `git -C <wslCwd>` instead.
      const wslArgs = cwd ? ['-C', toWslPath(cwd), ...args] : args;
      return execFileRaw('wsl.exe', ['git', ...wslArgs], {
        maxBuffer,
        encoding: 'utf8',
      });
    } else {
      // PowerShell-only — use native Windows git.
      // Stored paths may be POSIX (/mnt/c/...) from a previous WSL setup;
      // convert them to Windows paths before passing as cwd.
      const winCwd = cwd ? toNativePath(cwd) : undefined;
      return execFileRaw('git', args, { cwd: winCwd, maxBuffer, encoding: 'utf8' });
    }
  }

  return execFileRaw('git', args, { cwd, maxBuffer, encoding: 'utf8' });
}

// --- TTL Caches ---

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const mainBranchCache = new Map<string, CacheEntry>();
const mergeBaseCache = new Map<string, CacheEntry>();
const MAIN_BRANCH_TTL = 60_000; // 60s
const MERGE_BASE_TTL = 30_000; // 30s

function invalidateMergeBaseCache(): void {
  mergeBaseCache.clear();
}

function cacheKey(p: string): string {
  return p.replace(/\/+$/, '');
}

// --- Worktree lock serialization ---

const worktreeLocks = new Map<string, Promise<void>>();

function withWorktreeLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = worktreeLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  worktreeLocks.set(
    key,
    next.then(
      () => {},
      () => {},
    ),
  );
  return next;
}

// --- Symlink candidates ---

const SYMLINK_CANDIDATES = [
  '.claude',
  '.cursor',
  '.aider',
  '.copilot',
  '.codeium',
  '.continue',
  '.windsurf',
  'node_modules',
];

// --- Internal helpers ---

async function detectMainBranch(repoRoot: string): Promise<string> {
  const key = cacheKey(repoRoot);
  const cached = mainBranchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const result = await detectMainBranchUncached(repoRoot);
  mainBranchCache.set(key, { value: result, expiresAt: Date.now() + MAIN_BRANCH_TTL });
  return result;
}

async function detectMainBranchUncached(repoRoot: string): Promise<string> {
  // Try remote HEAD reference first
  try {
    const { stdout } = await gitExec(['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd: repoRoot,
    });
    const refname = stdout.trim();
    const prefix = 'refs/remotes/origin/';
    if (refname.startsWith(prefix)) return refname.slice(prefix.length);
  } catch {
    /* ignore */
  }

  // Check if 'main' exists
  try {
    await gitExec(['rev-parse', '--verify', 'main'], { cwd: repoRoot });
    return 'main';
  } catch {
    /* ignore */
  }

  // Fallback to 'master'
  try {
    await gitExec(['rev-parse', '--verify', 'master'], { cwd: repoRoot });
    return 'master';
  } catch {
    /* ignore */
  }

  // Empty repo (no commits yet) — use configured default branch or fall back to "main"
  try {
    const { stdout } = await gitExec(['config', '--get', 'init.defaultBranch'], {
      cwd: repoRoot,
    });
    const configured = stdout.trim();
    if (configured) return configured;
  } catch {
    /* ignore */
  }

  return 'main';
}

async function getCurrentBranchName(repoRoot: string): Promise<string> {
  const { stdout } = await gitExec(['symbolic-ref', '--short', 'HEAD'], { cwd: repoRoot });
  return stdout.trim();
}

async function detectMergeBase(repoRoot: string): Promise<string> {
  const key = cacheKey(repoRoot);
  const cached = mergeBaseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const mainBranch = await detectMainBranch(repoRoot);
  let result: string;
  try {
    const { stdout } = await gitExec(['merge-base', mainBranch, 'HEAD'], { cwd: repoRoot });
    const hash = stdout.trim();
    result = hash || mainBranch;
  } catch {
    result = mainBranch;
  }

  mergeBaseCache.set(key, { value: result, expiresAt: Date.now() + MERGE_BASE_TTL });
  return result;
}

async function detectRepoLockKey(p: string): Promise<string> {
  const { stdout } = await gitExec(['rev-parse', '--git-common-dir'], { cwd: p });
  const commonDir = stdout.trim();
  // All stored paths are POSIX; use pjoin to avoid win32 path.join inserting backslashes.
  const commonPath = commonDir.startsWith('/') ? commonDir : pjoin(p, commonDir);
  try {
    return fs.realpathSync(fsPath(commonPath));
  } catch {
    return commonPath;
  }
}

function normalizeStatusPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Handle rename/copy "old -> new"
  const destination = trimmed.split(' -> ').pop()?.trim() ?? trimmed;
  return destination.replace(/^"|"$/g, '');
}

function parseConflictPath(line: string): string | null {
  const trimmed = line.trim();

  // Format: "CONFLICT (...): Merge conflict in <path>"
  const mergeConflictIdx = trimmed.indexOf('Merge conflict in ');
  if (mergeConflictIdx !== -1) {
    const p = trimmed.slice(mergeConflictIdx + 'Merge conflict in '.length).trim();
    return p || null;
  }

  if (!trimmed.startsWith('CONFLICT')) return null;

  // Format: "CONFLICT (...): path <marker>"
  const parenClose = trimmed.indexOf('): ');
  if (parenClose === -1) return null;
  const afterParen = trimmed.slice(parenClose + 3);

  const markers = [' deleted in ', ' modified in ', ' added in ', ' renamed in ', ' changed in '];
  let cutoff = Infinity;
  for (const m of markers) {
    const idx = afterParen.indexOf(m);
    if (idx !== -1 && idx < cutoff) cutoff = idx;
  }

  const candidate = (cutoff === Infinity ? afterParen : afterParen.slice(0, cutoff)).trim();
  return candidate || null;
}

async function computeBranchDiffStats(
  projectRoot: string,
  mainBranch: string,
  branchName: string,
): Promise<{ linesAdded: number; linesRemoved: number }> {
  // Use '--' to unambiguously separate revisions from paths (avoids git
  // "ambiguous argument" error when branch names look like file paths).
  const { stdout } = await gitExec(['diff', '--numstat', `${mainBranch}..${branchName}`, '--'], {
    cwd: projectRoot,
    maxBuffer: MAX_BUFFER,
  });
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of stdout.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    linesAdded += parseInt(parts[0], 10) || 0;
    linesRemoved += parseInt(parts[1], 10) || 0;
  }
  return { linesAdded, linesRemoved };
}

// --- Public functions (used by tasks.ts and register.ts) ---

export async function createWorktree(
  repoRoot: string,
  branchName: string,
  symlinkDirs: string[],
): Promise<{ path: string; branch: string }> {
  const worktreePath = `${repoRoot}/.worktrees/${branchName}`;
  // On PowerShell-only Windows, git args must use Windows-style paths.
  const gitWorktreePath = toNativePath(worktreePath);

  // Try -b first (new branch), fall back to existing branch
  try {
    await gitExec(['worktree', 'add', '-b', branchName, gitWorktreePath], { cwd: repoRoot });
  } catch {
    await gitExec(['worktree', 'add', gitWorktreePath, branchName], { cwd: repoRoot });
  }

  // Symlink selected directories
  for (const name of symlinkDirs) {
    // Reject names that could escape the worktree directory
    if (name.includes('/') || name.includes('\\') || name.includes('..') || name === '.') continue;
    const source = pjoin(repoRoot, name);
    const target = pjoin(worktreePath, name);
    try {
      if (fs.statSync(fsPath(source)).isDirectory() && !fs.existsSync(fsPath(target))) {
        if (process.platform === 'win32') {
          if (process.env.WSL_DISTRO) {
            // fs.symlinkSync can't resolve POSIX paths; create the symlink inside WSL.
            await execFileRaw('wsl.exe', ['ln', '-sf', source, target]);
          } else {
            // PowerShell-only: use a junction (no Developer Mode required for directories).
            fs.symlinkSync(fsPath(source), fsPath(target), 'junction');
          }
        } else {
          fs.symlinkSync(source, target);
        }
      }
    } catch {
      /* ignore */
    }
  }

  return { path: worktreePath, branch: branchName };
}

export async function removeWorktree(
  repoRoot: string,
  branchName: string,
  deleteBranch: boolean,
): Promise<void> {
  const worktreePath = `${repoRoot}/.worktrees/${branchName}`;
  const gitWorktreePath = toNativePath(worktreePath);

  if (!fs.existsSync(fsPath(repoRoot))) return;

  if (fs.existsSync(fsPath(worktreePath))) {
    try {
      await gitExec(['worktree', 'remove', '--force', gitWorktreePath], { cwd: repoRoot });
    } catch {
      // git worktree remove may fail on Windows when the PTY process still holds
      // a handle to the directory (it was just killed but hasn't fully exited).
      // Retry with backoff; fall back to immediate rmSync on non-Windows.
      if (process.platform === 'win32') {
        await rmDirWithRetry(fsPath(worktreePath));
      } else {
        fs.rmSync(fsPath(worktreePath), { recursive: true, force: true });
      }
    }
  }

  // Prune stale worktree entries
  try {
    await gitExec(['worktree', 'prune'], { cwd: repoRoot });
  } catch {
    /* ignore */
  }

  if (deleteBranch) {
    try {
      await gitExec(['branch', '-D', '--', branchName], { cwd: repoRoot });
    } catch (e: unknown) {
      const msg = String(e);
      if (!msg.toLowerCase().includes('not found')) throw e;
    }
  }
}

// --- IPC command functions ---

export async function getGitIgnoredDirs(projectRoot: string): Promise<string[]> {
  const results: string[] = [];
  for (const name of SYMLINK_CANDIDATES) {
    const dirPath = pjoin(projectRoot, name);
    try {
      if (!fs.statSync(fsPath(dirPath)).isDirectory()) continue;
    } catch {
      continue;
    }
    try {
      await gitExec(['check-ignore', '-q', name], { cwd: projectRoot });
      results.push(name);
    } catch {
      /* not ignored */
    }
  }
  return results;
}

export async function getMainBranch(projectRoot: string): Promise<string> {
  return detectMainBranch(projectRoot);
}

export async function getCurrentBranch(projectRoot: string): Promise<string> {
  return getCurrentBranchName(projectRoot);
}

export async function getChangedFiles(worktreePath: string): Promise<
  Array<{
    path: string;
    lines_added: number;
    lines_removed: number;
    status: string;
    committed: boolean;
  }>
> {
  const base = await detectMergeBase(worktreePath).catch(() => 'HEAD');

  // git diff --raw --numstat <base>
  let diffStr = '';
  try {
    const { stdout } = await gitExec(['diff', '--raw', '--numstat', base], {
      cwd: worktreePath,
      maxBuffer: MAX_BUFFER,
    });
    diffStr = stdout;
  } catch {
    /* empty */
  }

  const statusMap = new Map<string, string>();
  const numstatMap = new Map<string, [number, number]>();

  for (const line of diffStr.split('\n')) {
    if (line.startsWith(':')) {
      // --raw format
      const parts = line.split('\t');
      if (parts.length >= 2) {
        const statusLetter = parts[0].split(/\s+/).pop()?.charAt(0) ?? 'M';
        const rawPath = parts[parts.length - 1];
        const p = normalizeStatusPath(rawPath);
        if (p) statusMap.set(p, statusLetter);
      }
      continue;
    }
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const added = parseInt(parts[0], 10);
      const removed = parseInt(parts[1], 10);
      if (!isNaN(added) && !isNaN(removed)) {
        const rawPath = parts[parts.length - 1];
        const p = normalizeStatusPath(rawPath);
        if (p) numstatMap.set(p, [added, removed]);
      }
    }
  }

  // git status --porcelain for uncommitted paths
  let statusStr = '';
  try {
    const { stdout } = await gitExec(['status', '--porcelain'], {
      cwd: worktreePath,
      maxBuffer: MAX_BUFFER,
    });
    statusStr = stdout;
  } catch {
    /* empty */
  }

  const uncommittedPaths = new Set<string>();
  for (const line of statusStr.split('\n')) {
    if (line.length < 3) continue;
    const p = normalizeStatusPath(line.slice(3));
    if (!p) continue;
    if (line.startsWith('??')) {
      if (!statusMap.has(p)) statusMap.set(p, '?');
    }
    uncommittedPaths.add(p);
  }

  const files: Array<{
    path: string;
    lines_added: number;
    lines_removed: number;
    status: string;
    committed: boolean;
  }> = [];
  const seen = new Set<string>();

  for (const [p, [added, removed]] of numstatMap) {
    const status = statusMap.get(p) ?? 'M';
    const committed = !uncommittedPaths.has(p);
    seen.add(p);
    files.push({ path: p, lines_added: added, lines_removed: removed, status, committed });
  }

  // Files from statusMap not in numstat (untracked)
  for (const [p, status] of statusMap) {
    if (seen.has(p)) continue;
    const fullPath = pjoin(worktreePath, p);
    let added = 0;
    try {
      const stat = await fs.promises.stat(fsPath(fullPath));
      if (stat.isFile() && stat.size < MAX_BUFFER) {
        const content = await fs.promises.readFile(fsPath(fullPath), 'utf8');
        added = content.split('\n').length;
      }
    } catch {
      /* ignore */
    }
    files.push({
      path: p,
      lines_added: added,
      lines_removed: 0,
      status,
      committed: !uncommittedPaths.has(p),
    });
  }

  files.sort((a, b) => {
    if (a.committed !== b.committed) return a.committed ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  return files;
}

export async function getFileDiff(worktreePath: string, filePath: string): Promise<string> {
  const base = await detectMergeBase(worktreePath).catch(() => 'HEAD');

  try {
    const { stdout } = await gitExec(['diff', base, '--', filePath], {
      cwd: worktreePath,
      maxBuffer: MAX_BUFFER,
    });
    if (stdout.trim()) return stdout;
  } catch {
    /* empty */
  }

  // Untracked file — format as all-additions
  const fullPath = pjoin(worktreePath, filePath);
  try {
    const stat = await fs.promises.stat(fsPath(fullPath));
    if (stat.isFile() && stat.size < MAX_BUFFER) {
      const content = await fs.promises.readFile(fsPath(fullPath), 'utf8');
      const lines = content.split('\n');
      let pseudo = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n`;
      for (const line of lines) {
        pseudo += `+${line}\n`;
      }
      return pseudo;
    }
  } catch {
    /* file doesn't exist or unreadable */
  }

  return '';
}

export async function getWorktreeStatus(
  worktreePath: string,
): Promise<{ has_committed_changes: boolean; has_uncommitted_changes: boolean }> {
  let hasUncommittedChanges = false;
  try {
    const { stdout: statusOut } = await gitExec(['status', '--porcelain'], {
      cwd: worktreePath,
      maxBuffer: MAX_BUFFER,
    });
    hasUncommittedChanges = statusOut.trim().length > 0;
  } catch (e) {
    console.error('[getWorktreeStatus] git status failed:', e);
  }

  const mainBranch = await detectMainBranch(worktreePath).catch(() => 'HEAD');
  let hasCommittedChanges = false;
  try {
    const { stdout: logOut } = await gitExec(['log', `${mainBranch}..HEAD`, '--oneline'], {
      cwd: worktreePath,
    });
    hasCommittedChanges = logOut.trim().length > 0;
  } catch {
    // mainBranch ref may not exist yet (fresh repo with no commits on main/master).
    // Fall back: if HEAD has any commits at all, there is something to merge.
    try {
      const { stdout: countOut } = await gitExec(['rev-list', '--count', 'HEAD'], {
        cwd: worktreePath,
      });
      hasCommittedChanges = parseInt(countOut.trim(), 10) > 0;
    } catch (e) {
      console.error('[getWorktreeStatus] git rev-list fallback failed:', e);
    }
  }

  return {
    has_committed_changes: hasCommittedChanges,
    has_uncommitted_changes: hasUncommittedChanges,
  };
}

export async function checkMergeStatus(
  worktreePath: string,
): Promise<{ main_ahead_count: number; conflicting_files: string[] }> {
  const mainBranch = await detectMainBranch(worktreePath);

  let mainAheadCount = 0;
  try {
    const { stdout } = await gitExec(['rev-list', '--count', `HEAD..${mainBranch}`], {
      cwd: worktreePath,
    });
    mainAheadCount = parseInt(stdout.trim(), 10) || 0;
  } catch {
    /* ignore */
  }

  if (mainAheadCount === 0) return { main_ahead_count: 0, conflicting_files: [] };

  const conflictingFiles: string[] = [];
  try {
    await gitExec(['merge-tree', '--write-tree', 'HEAD', mainBranch], { cwd: worktreePath });
  } catch (e: unknown) {
    // merge-tree outputs conflict info on failure
    const output = String(e);
    for (const line of output.split('\n')) {
      const p = parseConflictPath(line);
      if (p) conflictingFiles.push(p);
    }
  }

  return { main_ahead_count: mainAheadCount, conflicting_files: conflictingFiles };
}

export async function mergeTask(
  projectRoot: string,
  branchName: string,
  squash: boolean,
  message: string | null,
  cleanup: boolean,
): Promise<{ main_branch: string; lines_added: number; lines_removed: number }> {
  const lockKey = await detectRepoLockKey(projectRoot).catch(() => projectRoot);

  return withWorktreeLock(lockKey, async () => {
    const mainBranch = await detectMainBranch(projectRoot);
    // Diff stats are cosmetic — don't let a failure here block the merge.
    const { linesAdded, linesRemoved } = await computeBranchDiffStats(
      projectRoot,
      mainBranch,
      branchName,
    ).catch(() => ({ linesAdded: 0, linesRemoved: 0 }));

    // Verify clean working tree
    const { stdout: statusOut } = await gitExec(['status', '--porcelain'], {
      cwd: projectRoot,
    });
    if (statusOut.trim())
      throw new Error(
        'Project root has uncommitted changes. Please commit or stash them before merging.',
      );

    const originalBranch = await getCurrentBranchName(projectRoot).catch(() => null);

    // Checkout main
    await gitExec(['checkout', mainBranch], { cwd: projectRoot });

    const restoreBranch = async () => {
      if (originalBranch) {
        try {
          await gitExec(['checkout', originalBranch], { cwd: projectRoot });
        } catch {
          /* ignore */
        }
      }
    };

    if (squash) {
      try {
        await gitExec(['merge', '--squash', '--', branchName], { cwd: projectRoot });
      } catch (e) {
        await gitExec(['reset', '--hard', 'HEAD'], { cwd: projectRoot }).catch(() => {});
        await restoreBranch();
        throw new Error(`Squash merge failed: ${e}`);
      }
      const msg = message ?? 'Squash merge';
      try {
        await gitExec(['commit', '-m', msg], { cwd: projectRoot });
      } catch (e) {
        await gitExec(['reset', '--hard', 'HEAD'], { cwd: projectRoot }).catch(() => {});
        await restoreBranch();
        throw new Error(`Commit failed: ${e}`);
      }
    } else {
      try {
        await gitExec(['merge', '--', branchName], { cwd: projectRoot });
      } catch (e) {
        await gitExec(['merge', '--abort'], { cwd: projectRoot }).catch(() => {});
        await restoreBranch();
        throw new Error(`Merge failed: ${e}`);
      }
    }

    invalidateMergeBaseCache();

    if (cleanup) {
      await removeWorktree(projectRoot, branchName, true);
    }

    await restoreBranch();

    return { main_branch: mainBranch, lines_added: linesAdded, lines_removed: linesRemoved };
  });
}

export async function getBranchLog(worktreePath: string): Promise<string> {
  const mainBranch = await detectMainBranch(worktreePath).catch(() => 'HEAD');
  try {
    const { stdout } = await gitExec(['log', `${mainBranch}..HEAD`, '--pretty=format:- %s'], {
      cwd: worktreePath,
      maxBuffer: MAX_BUFFER,
    });
    return stdout;
  } catch {
    return '';
  }
}

export async function pushTask(projectRoot: string, branchName: string): Promise<void> {
  await gitExec(['push', '-u', 'origin', '--', branchName], { cwd: projectRoot });
}

export async function rebaseTask(worktreePath: string): Promise<void> {
  const lockKey = await detectRepoLockKey(worktreePath).catch(() => worktreePath);

  return withWorktreeLock(lockKey, async () => {
    const mainBranch = await detectMainBranch(worktreePath);
    try {
      await gitExec(['rebase', mainBranch], { cwd: worktreePath });
    } catch (e) {
      await gitExec(['rebase', '--abort'], { cwd: worktreePath }).catch(() => {});
      throw new Error(`Rebase failed: ${e}`);
    }
    invalidateMergeBaseCache();
  });
}
