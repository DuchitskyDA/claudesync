import type { GitDiagCmd } from '@shared/api'

/** Fixed, read-only git arg arrays keyed by diagnostic command. Centralised so
 *  the only git invocations the popover can trigger are these four — nothing
 *  user-supplied reaches the spawn. */
export function gitDiagArgs(cmd: GitDiagCmd): string[] {
  switch (cmd) {
    case 'status':
      return ['status']
    case 'log':
      return ['log', '--oneline', '-10']
    case 'show':
      return ['show', 'HEAD', '--stat']
    case 'remote':
      return ['remote', '-v']
  }
}

/** Narrow an untrusted IPC payload to a known diagnostic command. */
export function isGitDiagCmd(x: unknown): x is GitDiagCmd {
  return x === 'status' || x === 'log' || x === 'show' || x === 'remote'
}
