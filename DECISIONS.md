# Phase 1 decisions

- The React and Vite source from this repository moves into `apps/web/`. The desktop reuses the existing theme and controls with a local clipboard view and a preloaded, separate popup. The original cloud dashboard is available in standalone browser development with `VITE_ENABLE_LEGACY_UI=true`.
- The SQLite file contains a ULID and an authenticated encrypted payload for each clip. An in-memory SQLite FTS5 index is rebuilt at startup. Masked clips are excluded from the index. Images can be found by kind, and file clips can be found by filename. The 2,000 newest unkept clips are retained. Kept clips stay until deleted.
- First run derives the key from a passphrase and stores the key in the OS keychain. The vault opens automatically while the OS keychain is available. The app can retry after the keychain is unlocked. There is no passphrase recovery UI.
- The background watcher reads the clipboard. Explicit paste and copy actions write to it. Detected secrets are cleared after 30 seconds if the clipboard still holds the watched entry. Windows checks the clipboard sequence under the clipboard lock. macOS and Linux compare the current contents before clearing. This does not remove copies held by other apps or the operating system's clipboard history. Detection is heuristic and supports known credentials, labeled passwords, high-entropy tokens, card numbers, and supported concealment markers.
- Windows records the foreground executable when capture fires, when available. Linux hotkeys, capture, and paste target X11. macOS polls the pasteboard change counter and may need Accessibility permission for simulated paste.
- Explicit file copy or paste restores captured bytes to private temporary directories for the life of the app session, so the receiving application can read them. Secret file clips stay masked and cannot be restored through this mechanism. Folder capture, OCR, and foreground-app attribution on Linux and macOS are deferred.
- Ollama actions accept non-secret text clips and HTTP loopback URLs only. Tags and summaries save to the selected clip. Manual triggering is the only enabled run mode.

## Phase 2 decisions

- Phase 2 covers the relay and desktop-to-desktop sync. Devices are enrolled using a random shared sync key and separate per-device bearer tokens. The OS keychain stores both credentials. A local vault binds to one relay origin, account key, and device identity. Device token rotation preserves that binding.
- Connecting queues existing non-secret clips. Clipboard capture and editing still work without connectivity. SQLite commits each local change and its encrypted outbox entry together. Pause keeps changes queued. The WebSocket provides wake-ups, and cursor-based polling recovers from disconnections and missed updates.
- The wire transfer uses encrypted full snapshots for saves. Once received, clip content and its original capture metadata are immutable. Keep, tags, and note each resolve by Lamport clock and event ID. Delete is terminal for the item ID. Synced clips stay in the local store until deleted, so the offline cache policy cannot silently discard synced history.
- A corrupted event leaves the cursor at the last authenticated event and surfaces a sync error. The relay serves ciphertext and routing metadata. The shared sync key stays on the desktops.

## Phase 4 decisions

- The NAS uses an outbound HTTPS poll and a dedicated read-only relay token. PostgreSQL stores the authenticated original envelopes and a minimal sequence and item index. It retains snapshots and deletion events independently of the desktop vault.
- Archive status, history and recovery are local commands in the container. Recovery decrypts a selected event using the existing account key. PostgreSQL stores no decrypted clip payloads. Vector indexing and NAS AI belong to a later phase.
