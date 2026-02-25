import { execFileSync } from 'child_process';

export interface WslInfo {
  available: boolean;
  distro: string;
}

/**
 * Detects whether WSL2 is available on Windows.
 * Runs `wsl.exe --version` to confirm WSL2 presence (WSL1 lacks this flag),
 * then `wsl.exe --list --verbose` to find the default distro name.
 * Also resolves the WSL login-shell PATH and caches it in process.env.WSL_PATH.
 *
 * Safe to call on macOS/Linux — returns { available: false, distro: '' } immediately.
 */
export function detectWsl(): WslInfo {
  if (process.platform !== 'win32') return { available: false, distro: '' };

  try {
    // WSL1 does not support --version; this confirms WSL2 presence.
    execFileSync('wsl.exe', ['--version'], { encoding: 'utf8', timeout: 5000 });
  } catch {
    return { available: false, distro: '' };
  }

  let distro = '';
  try {
    // --list --verbose marks the default distro with a leading '*'
    const listOut = execFileSync('wsl.exe', ['--list', '--verbose'], {
      encoding: 'utf16le', // wsl.exe outputs UTF-16 LE on Windows
      timeout: 5000,
    });
    for (const line of listOut.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('*')) {
        // Format: "* Ubuntu   Running   2"
        const parts = trimmed.slice(1).trim().split(/\s+/);
        if (parts[0]) {
          distro = parts[0];
          break;
        }
      }
    }
  } catch {
    return { available: false, distro: '' };
  }

  if (!distro) return { available: false, distro: '' };

  // Resolve WSL login-shell PATH and cache it for PTY spawn
  try {
    const sentinel = '__P__';
    const pathOut = execFileSync(
      'wsl.exe',
      ['-d', distro, 'bash', '-ilc', `printf "${sentinel}%s${sentinel}" "$PATH"`],
      { encoding: 'utf8', timeout: 5000 },
    );
    const match = pathOut.match(/__P__(.+?)__P__/);
    if (match?.[1]) {
      process.env.WSL_PATH = match[1];
    }
  } catch {
    // PATH resolution is best-effort; detection still succeeds
  }

  return { available: true, distro };
}

/**
 * Converts a Windows absolute path to its WSL mount equivalent.
 *   C:\Users\alice\project  →  /mnt/c/Users/alice/project
 *   /home/alice/project     →  /home/alice/project  (returned unchanged)
 *
 * Throws a TypeError for paths that are neither Windows absolute nor POSIX absolute.
 */
export function toWslPath(winPath: string): string {
  // Already a POSIX absolute path — return unchanged
  if (winPath.startsWith('/')) return winPath;

  // Windows absolute path: drive letter + colon + separator
  const driveMatch = /^([A-Za-z]):[/\\](.*)$/.exec(winPath);
  if (driveMatch) {
    const driveLetter = driveMatch[1].toLowerCase();
    const rest = driveMatch[2].replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '');
    return `/mnt/${driveLetter}/${rest}`;
  }

  throw new TypeError(
    `toWslPath: unrecognised path format — expected a Windows absolute path (e.g. C:\\Users\\...) or a POSIX absolute path (e.g. /home/...), got: ${winPath}`,
  );
}
