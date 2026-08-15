# Installing Stash

## Install

Grab the installer for your machine from the
[latest release](https://github.com/nixentric/stash/releases/latest):

| Platform | File | Notes |
|---|---|---|
| macOS (Apple Silicon) | `Stash_<version>_aarch64.dmg` | M1 and newer |
| macOS (Intel) | `Stash_<version>_x64.dmg` | |
| Windows | `Stash_<version>_x64-setup.exe` | `.msi` also available |
| Linux (Debian/Ubuntu) | `Stash_<version>_amd64.deb` | `sudo dpkg -i Stash_*.deb` |
| Linux (anything else) | `Stash_<version>_amd64.AppImage` | `chmod +x` then run |

Open the `.dmg` and drag Stash to Applications, or run the `.exe`. There is
nothing else to set up: no account, no API key, no config file.

### First launch

The app is **not signed with a paid Apple or Microsoft certificate**, so both
systems warn about it the first time. The bundles are built in public by
[this workflow](../.github/workflows/release.yml) — you can read exactly what
produced them, or build your own from source below.

**macOS** — the first double-click is refused with *"Apple could not verify
Stash is free of malware"*. Click **Done**, then open **System Settings →
Privacy & Security**, scroll to **Security**, and press **Open Anyway** next to
the message about Stash. That records a permanent exception for this app.

On Sequoia (macOS 15) the old right-click → **Open** trick no longer works —
**Open Anyway** is the only click-through. To skip the dialog entirely, remove
the quarantine flag macOS attaches to downloads:

```bash
xattr -dr com.apple.quarantine /Applications/Stash.app
```

**Windows** — SmartScreen shows a blue "Windows protected your PC" screen. Click
**More info**, then **Run anyway**.

**Linux** — no warning; the `.AppImage` needs `chmod +x Stash_*.AppImage` first.

---
