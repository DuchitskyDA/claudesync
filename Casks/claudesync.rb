cask "claudesync" do
  version "0.9.2"

  on_arm do
    sha256 "ca198bdd943a52eae094df2a50fa23406b6897fd9e455c6ada5503aedd5c2a2f"
    url "https://github.com/DuchitskyDA/claudesync/releases/download/v#{version}/claudesync-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "d085e55aacbf4a419a577621d940dd9854c94ea722a0483ec187d3acb5becbb9"
    url "https://github.com/DuchitskyDA/claudesync/releases/download/v#{version}/claudesync-#{version}.dmg"
  end

  name "claudesync"
  desc "Sync Claude Code configs across machines"
  homepage "https://github.com/DuchitskyDA/claudesync"

  app "claudesync.app"

  # The app is ad-hoc signed (no Apple Developer ID — that's $99/yr we don't pay).
  # macOS Gatekeeper still applies a quarantine attribute when Homebrew downloads
  # the .dmg, and on Apple Silicon it refuses to launch arm64 binaries that
  # don't have a fresh signature. Strip quarantine + re-apply ad-hoc signature
  # automatically here so the user never has to open Terminal.
  postflight do
    system_command "/usr/bin/xattr",
                   args:         ["-cr", "#{appdir}/claudesync.app"],
                   must_succeed: false
    system_command "/usr/bin/codesign",
                   args:         ["--force", "--deep", "--sign", "-", "#{appdir}/claudesync.app"],
                   must_succeed: false
  end

  zap trash: [
    "~/Library/Application Support/claudesync",
    "~/Library/Logs/claudesync",
    "~/Library/Preferences/com.duchitskyda.claudesync.plist",
    "~/Library/Saved Application State/com.duchitskyda.claudesync.savedState",
  ]
end
