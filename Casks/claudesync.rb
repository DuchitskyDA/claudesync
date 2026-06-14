cask "claudesync" do
  version "0.11.0"

  on_arm do
    sha256 "f9bfae30c3542b26d87df95c096358aab2b759bde25e5fdcf95d9e62465651cf"
    url "https://github.com/DuchitskyDA/claudesync/releases/download/v#{version}/claudesync-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "a88625db73f973ed7c20f3ab086d35b8cea9185569f3cdd15c1adbc4bdc6eaec"
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
