cask "claudesync" do
  version "0.11.1"

  on_arm do
    sha256 "c084c5bbfd56fabf83570834eab133ee1ef3922d92eb0c63dc4176a143421793"
    url "https://github.com/DuchitskyDA/claudesync/releases/download/v#{version}/claudesync-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "b3765a2a314ed7c94c5c2396e25b766a880a9f4ca8384f3af529684dc0f1c6ef"
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
