cask "claudesync" do
  version "0.8.7"

  on_arm do
    sha256 "4c00b7d908ba3c0665b19bb4c97d40ec5b0868eb699ee16023c8ddbdb0ec378e"
    url "https://github.com/DuchitskyDA/claudesync/releases/download/v#{version}/claudesync-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "a9fd730f7a061f64cf1b9d0846d5f65c9ab17b3636f4aa3662ead9e41fdb4259"
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
