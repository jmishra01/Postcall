# Postcall installation and development

## Install a released version

Download the installer for your operating system from the repository's GitHub Releases page.

### Windows

Use the x64 NSIS `.exe` installer for the standard setup experience, or the x64 WiX `.msi` package for managed installation.

### macOS

Download the `.dmg` matching your Mac:

- `aarch64` for Apple Silicon Macs
- `x86_64` for Intel Macs

Open the disk image and drag Postcall into Applications. Official release packages must be signed with a Developer ID Application certificate and notarized by Apple so Gatekeeper can verify them.

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

### Configure macOS signing and notarization

The macOS jobs intentionally fail instead of publishing an unverifiable DMG when Apple credentials are missing. Membership in the Apple Developer Program is required.

Create a **Developer ID Application** certificate, install it in Keychain Access, and export the certificate together with its private key as a password-protected `.p12` file. Convert that file to a single-line Base64 value:

```bash
openssl base64 -A -in DeveloperIDApplication.p12 -out certificate-base64.txt
```

Add these repository secrets under **Settings → Secrets and variables → Actions**:

- `APPLE_CERTIFICATE`: contents of `certificate-base64.txt`
- `APPLE_CERTIFICATE_PASSWORD`: password used when exporting the `.p12`
- `KEYCHAIN_PASSWORD`: a strong temporary password for the CI keychain
- `APPLE_ID`: Apple Developer account email
- `APPLE_PASSWORD`: app-specific password for that Apple ID
- `APPLE_TEAM_ID`: Apple Developer Team ID

The workflow imports the certificate into a temporary keychain, signs the application with the Developer ID identity, submits it to Apple's notarization service, and lets Tauri staple the notarization ticket to the distributed package.

Configure Windows code-signing credentials separately before distributing Windows packages publicly to avoid SmartScreen trust warnings.

### Opening an older ad-hoc build

Previously generated ad-hoc builds cannot become trusted without being rebuilt or notarized. For a Postcall build you created or obtained from a trusted source, you can approve it using **System Settings → Privacy & Security → Open Anyway**, then confirm **Open**. Replace that installation with a signed and notarized release when one is available.
