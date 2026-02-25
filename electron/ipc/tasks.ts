import { randomUUID } from 'crypto';
import { createWorktree, removeWorktree } from './git.js';
import { killAgent, notifyAgentListChanged } from './pty.js';

const MAX_SLUG_LEN = 72;

function slug(name: string): string {
  let result = '';
  let prevWasHyphen = false;
  for (const c of name.toLowerCase()) {
    if (result.length >= MAX_SLUG_LEN) break;
    if (/[a-z0-9]/.test(c)) {
      result += c;
      prevWasHyphen = false;
    } else if (!prevWasHyphen) {
      result += '-';
      prevWasHyphen = true;
    }
  }
  return result.replace(/^-+|-+$/g, '');
}

function sanitizeBranchPrefix(prefix: string): string {
  const parts = prefix
    .split('/')
    .map(slug)
    .filter((p) => p.length > 0);
  return parts.length === 0 ? 'task' : parts.join('/');
}

export async function createTask(
  name: string,
  projectRoot: string,
  symlinkDirs: string[],
  branchPrefix: string,
): Promise<{ id: string; branch_name: string; worktree_path: string; warnMountedDrive?: boolean }> {
  const prefix = sanitizeBranchPrefix(branchPrefix);
  const branchName = `${prefix}/${slug(name)}`;
  const worktree = await createWorktree(projectRoot, branchName, symlinkDirs);

  // On Windows, paths from the renderer are Windows-native (e.g. C:\Users\...).
  // Any Windows-native path maps to a /mnt/X/... WSL mount path, which has
  // 10-50× slower git I/O and requires Developer Mode for symlinks.
  // WSL-native paths (e.g. /home/alice/...) arrive as POSIX and don't match.
  const warnMountedDrive = process.platform === 'win32' && /^[A-Za-z]:[/\\]/.test(projectRoot);

  return {
    id: randomUUID(),
    branch_name: worktree.branch,
    worktree_path: worktree.path,
    ...(warnMountedDrive && { warnMountedDrive: true }),
  };
}

export async function deleteTask(
  agentIds: string[],
  branchName: string,
  deleteBranch: boolean,
  projectRoot: string,
): Promise<void> {
  for (const agentId of agentIds) {
    try {
      killAgent(agentId);
    } catch {
      /* already dead */
    }
  }
  await removeWorktree(projectRoot, branchName, deleteBranch);
  notifyAgentListChanged();
}
