export type DiffRowType = 'context' | 'add' | 'del'
export type DiffRow = { type: DiffRowType; text: string }

/** Split into lines, treating the empty string as zero lines (not `['']`). */
function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n')
}

/**
 * Line-level unified diff between `oldText` and `newText` using the classic
 * longest-common-subsequence DP. Unchanged lines are `context`, lines only in
 * `oldText` are `del`, lines only in `newText` are `add`. Ties between an
 * equally-optimal deletion and addition favour the deletion first.
 *
 * O(n·m) time and memory — callers must cap input size before calling.
 */
export function lineDiff(oldText: string, newText: string): DiffRow[] {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  const m = a.length
  const n = b.length

  // dp[i][j] = LCS length of a[i..) and b[j..)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rows.push({ type: 'context', text: a[i]! })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ type: 'del', text: a[i]! })
      i++
    } else {
      rows.push({ type: 'add', text: b[j]! })
      j++
    }
  }
  while (i < m) {
    rows.push({ type: 'del', text: a[i]! })
    i++
  }
  while (j < n) {
    rows.push({ type: 'add', text: b[j]! })
    j++
  }
  return rows
}

/**
 * Heuristic: a decoded string is "probably binary" if it contains a NUL byte
 * or the Unicode replacement char (U+FFFD), which appears when non-UTF-8 bytes
 * were decoded. Good enough to skip rendering a meaningless text diff.
 */
export function isProbablyBinary(text: string): boolean {
  const nul = String.fromCharCode(0)
  const replacement = String.fromCharCode(0xfffd)
  return text.includes(nul) || text.includes(replacement)
}
