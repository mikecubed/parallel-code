import { execFileSync } from 'child_process';

export interface PowerShellInfo {
  available: boolean;
  /** Absolute path to the preferred PowerShell executable */
  exePath: string;
  /** 'pwsh' (PowerShell 7+) | 'powershell' (Windows PowerShell 5.1) | '' */
  variant: 'pwsh' | 'powershell' | '';
  version: string;
}

/**
 * Detects whether PowerShell is available on Windows.
 * Prefers PowerShell 7 (pwsh.exe) over Windows PowerShell 5.1 (powershell.exe).
 * Safe to call on macOS/Linux — returns { available: false } immediately.
 */
export function detectPowerShell(): PowerShellInfo {
  if (process.platform !== 'win32') {
    return { available: false, exePath: '', variant: '', version: '' };
  }

  // Try PowerShell 7 first (pwsh.exe)
  for (const [exe, variant] of [
    ['pwsh.exe', 'pwsh'],
    ['powershell.exe', 'powershell'],
  ] as const) {
    try {
      const out = execFileSync(
        exe,
        ['-NoLogo', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'],
        { encoding: 'utf8', timeout: 5000 },
      ).trim();
      return { available: true, exePath: exe, variant, version: out };
    } catch {
      // Try next variant
    }
  }

  return { available: false, exePath: '', variant: '', version: '' };
}
