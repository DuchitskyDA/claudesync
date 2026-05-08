/**
 * electron-builder afterPack hook.
 *
 * On macOS, force-applies an ad-hoc codesign to the packaged .app bundle.
 * Without this, electron-builder may produce an arm64 .app whose internal
 * binaries lack a valid signature, and Apple Silicon refuses to launch it
 * with "claudesync is damaged" — even after `xattr -dr com.apple.quarantine`.
 *
 * Apple Silicon (arm64) requires every executable to carry at minimum an
 * ad-hoc signature. `codesign --force --deep --sign -` re-signs the entire
 * bundle (including embedded helpers and .framework binaries).
 *
 * On Windows / Linux this hook is a no-op.
 */
const { execSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const productName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${productName}.app`)

  console.log(`[afterPack] Ad-hoc signing ${appPath}`)
  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' })
    console.log('[afterPack] codesign succeeded')
  } catch (err) {
    console.error('[afterPack] codesign FAILED:', err.message)
    throw err
  }
}
