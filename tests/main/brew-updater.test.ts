import { describe, it, expect } from 'vitest'
import {
  extractAppBundleName,
  findAppBundleForRelaunch,
  isBrewNoOp,
} from '../../src/main/brew-updater'

describe('extractAppBundleName', () => {
  it('extracts the .app from a Caskroom realpath', () => {
    expect(
      extractAppBundleName(
        '/opt/homebrew/Caskroom/claudesync/0.7.0/claudesync.app/Contents/MacOS/claudesync',
      ),
    ).toBe('claudesync.app')
  })

  it('extracts the .app from an /Applications symlink path', () => {
    expect(
      extractAppBundleName('/Applications/claudesync.app/Contents/MacOS/claudesync'),
    ).toBe('claudesync.app')
  })

  it('returns null for paths with no .app ancestor', () => {
    expect(extractAppBundleName('/usr/local/bin/node')).toBeNull()
  })

  it('returns null at filesystem root', () => {
    expect(extractAppBundleName('/')).toBeNull()
  })
})

describe('findAppBundleForRelaunch', () => {
  it('prefers /Applications when it exists', () => {
    const exists = (p: string) => p === '/Applications/claudesync.app'
    expect(
      findAppBundleForRelaunch(
        '/opt/homebrew/Caskroom/claudesync/0.7.0/claudesync.app/Contents/MacOS/claudesync',
        exists,
      ),
    ).toBe('/Applications/claudesync.app')
  })

  it('falls back to ~/Applications when /Applications is missing', () => {
    const home = process.env.HOME ?? '/tmp'
    const expected = `${home}/Applications/claudesync.app`
    const exists = (p: string) => p === expected
    expect(
      findAppBundleForRelaunch(
        '/opt/homebrew/Caskroom/claudesync/0.7.0/claudesync.app/Contents/MacOS/claudesync',
        exists,
      ),
    ).toBe(expected)
  })

  it('returns null when no canonical symlink exists', () => {
    expect(
      findAppBundleForRelaunch(
        '/opt/homebrew/Caskroom/claudesync/0.7.0/claudesync.app/Contents/MacOS/claudesync',
        () => false,
      ),
    ).toBeNull()
  })

  it('returns null when execPath has no .app ancestor', () => {
    expect(findAppBundleForRelaunch('/usr/local/bin/node', () => true)).toBeNull()
  })
})

describe('isBrewNoOp', () => {
  it.each([
    ['Warning: claudesync 0.8.1 is already installed and up-to-date.'],
    ['claudesync 0.8.1 is already installed'],
    ['No available upgrade for claudesync'],
    ['No casks to upgrade.'],
    ['Nothing to upgrade'],
    ['claudesync is up-to-date'],
    ['claudesync are up-to-date'],
    ['==> 0 outdated packages'],
  ])('detects no-op output: %s', (out) => {
    expect(isBrewNoOp(out)).toBe(true)
  })

  it('returns false for genuine upgrade output', () => {
    const upgraded = `==> Upgrading claudesync
==> Caveats
==> Downloading https://github.com/...
==> Verifying checksum
==> Installing Cask claudesync
==> Purging files for version 0.7.0 of Cask claudesync
🍺  claudesync was successfully upgraded!`
    expect(isBrewNoOp(upgraded)).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isBrewNoOp('NOTHING TO UPGRADE')).toBe(true)
  })
})
