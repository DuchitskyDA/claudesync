cask "claudesync" do
  version "0.7.0"

  on_arm do
    sha256 "d1de5230e7e264ca5fe05ba18ab2aba91338063a861a27a13e65b0f0460bf96d"
    url "https://github.com/DuchitskyDA/claudesync/releases/download/v#{version}/claudesync-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "8d8260c2067423c340f9e29febd8d867d590e3d58935f10aeb8692ff2a95b9b3"
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
