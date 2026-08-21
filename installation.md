# Postcall installation and development

## Install a released version

Download the installer for your operating system from the repository's GitHub Releases page.

### Windows

Use the x64 NSIS `.exe` installer for the standard setup experience, or the x64 WiX `.msi` package for managed installation.

### macOS

Download the `.dmg` matching your Mac:

- `aarch64` for Apple Silicon Macs
- `x86_64` for Intel Macs

Open the disk image and drag Postcall into Applications.

Release packages are **not** signed with an Apple Developer ID certificate or notarized, so Gatekeeper will block the first launch with a message such as "Postcall is damaged and can't be opened" or "cannot be opened because the developer cannot be verified". To run it anyway:

1. Try to open Postcall from Applications (it will be blocked).
2. Open **System Settings > Privacy & Security**, scroll to the Security section, and click **Open Anyway** next to the message about Postcall.
3. Confirm **Open** in the dialog that appears.

Alternatively, remove the quarantine attribute from Terminal before the first launch:

```bash
xattr -cr /Applications/Postcall.app
```

### Linux

Use the x64 `.deb` package on Debian and Ubuntu-based distributions, or the `.AppImage` package on other supported distributions. Make an AppImage executable before launching it:

```bash
chmod +x Postcall*.AppImage
./Postcall*.AppImage
```

## Technology

Postcall uses:

- Rust and `reqwest` for native HTTP execution
- Tauri 2 for the cross-platform desktop application
- Svelte 5 and TypeScript for the interface
- SQLite for local workspace persistence
- Vite for frontend development and production builds

## Development prerequisites

Install:

- Node.js LTS and npm
- The stable Rust toolchain
- The platform dependencies required by Tauri 2

Linux development additionally requires WebKitGTK and related bundling libraries. On Ubuntu 22.04:

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils
```

## Run from source

Install dependencies and start the desktop application:

```bash
npm ci
npm run tauri:dev
```

Run only the frontend development server:

```bash
npm run dev
```

## Verification

Run the frontend checks, production build, and Rust tests:

```bash
npm run check
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Create a local desktop build:

```bash
npm run tauri:build
```

Create a debug build:

```bash
npm run tauri:build -- --debug
```

Native bundles are written beneath `src-tauri/target/release/bundle` or `src-tauri/target/debug/bundle`.

## GitHub Actions installers

The **Build desktop installers** workflow builds:

- macOS Apple Silicon and Intel `.dmg` installers
- Windows x64 NSIS `.exe` and WiX `.msi` installers
- Linux x64 `.deb` and `.AppImage` packages

Run the workflow manually from the repository's **Actions** tab to download workflow artifacts.

To publish installers on a GitHub Release, keep the versions in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` synchronized, then push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```
