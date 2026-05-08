/** Sync the `.dark` class on <html> with the OS color-scheme preference.
 *  shadcn/ui themes are class-based; the app inherits from the OS, so we
 *  bridge `prefers-color-scheme` → DOM class on startup and on change. */
export function initTheme(): void {
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = (dark: boolean) => {
    document.documentElement.classList.toggle('dark', dark)
  }
  apply(mql.matches)
  mql.addEventListener('change', (e) => apply(e.matches))
}
