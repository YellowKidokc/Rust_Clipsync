# ClipSync

ClipSync Phase 1 is an offline desktop clipboard manager. It captures text, images, and regular files into an encrypted local vault. Open quick search with **Ctrl+Shift+V**. Use the arrow keys and **Enter** to paste, or **Alt+1–5** for the first five matches. You can keep or delete a clip in either window. Closing the main window leaves capture running in the tray. Choose **Quit** from the tray to exit.

## Run locally

Install Node.js 24, a current stable Rust toolchain, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform. On Windows, install the MSVC C++ build tools and WebView2. On Linux, use an X11 session with an unlocked Secret Service keyring. In addition to the Tauri libraries, install the D-Bus and libxkbcommon development packages (`libdbus-1-dev` and `libxkbcommon-dev` on Debian/Ubuntu). On macOS, grant Accessibility permission if the popup cannot send paste to the previous app.

```sh
npm ci
npm run tauri dev
```

On first launch, create a vault passphrase. ClipSync derives its encryption key and saves the key in the OS keychain. **Settings** lets you pause capture, choose which clip types to save, and set the maximum clip size.

## Local AI

Run Ollama with an installed local model. In **Settings → AI**, enter the model name and leave the URL at `http://localhost:11434` for the default Ollama setup. Select a text clip and choose **Tag this** or **Summarize**. Secret clips are masked, excluded from search indexing and AI, and cleared from the clipboard after 30 seconds if they are still current.

## Verify and build

```sh
npm run build
cargo test --locked
cargo clippy --locked -- -D warnings
npm run tauri -- build
```

See [Phase 1 decisions](DECISIONS.md) and the [build spec](SPEC.md) for platform behavior and later phases.

## Encrypted desktop sync

Phase 2 adds opt-in desktop sync through a Cloudflare relay. **Settings → Encrypted sync** enrolls a device or pauses sync while retaining local changes. See the [relay setup](worker/README.md) to run it locally or configure Cloudflare and issue device credentials.

## Synology archive

Phase 4 adds a headless Docker service that archives synced clip history in PostgreSQL. See [Synology setup and clip recovery](apps/nas/README.md).
