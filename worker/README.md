# ClipSync relay

The Worker authenticates each device against a hashed bearer token in D1. D1 indexes the account, device, operation ID, event cursor, and ciphertext length. R2 holds the opaque encrypted payload. An account-scoped Durable Object sends WebSocket wake-ups. Clients catch up from their saved cursor after any missed wake-up.

## Local relay and two desktops

In `worker/`, install dependencies and initialize the simulated D1 database:

```sh
npm ci
npx wrangler d1 migrations apply clipsync-relay --local
```

Create a private directory outside the repository, then generate a shared key and two separate device tokens. Replace the example paths below with files in that directory.

```sh
node scripts/provision.mjs /private/credentials.json /private/devices.sql 2
npx wrangler d1 execute clipsync-relay --local --file /private/devices.sql
npm run dev
```

On each desktop, open **Settings → Encrypted sync** and enter the local relay origin (`http://127.0.0.1:8787`), the shared `syncKey`, and a different `devices[].token` from the private file. Loopback requires the relay to run on the same computer. Use an HTTPS relay for separate computers. Vaults stay local until you connect them.

The key decrypts the account's clips. Share it privately with enrolled devices and keep a secure backup. The enrollment SQL contains the public account identifier, device IDs, and token hashes. Only apply the SQL to D1. To enroll additional devices, pass the existing credentials file as the fourth argument to the provisioning script and use new output paths. Rotate a token by replacing its hash for the same device ID in D1, then use **Update credentials** on that device. Removing a device row stops its authenticated HTTP operations. Rotate the account key and use a fresh vault if the shared encryption key is compromised.

## Cloudflare setup

Create a D1 database and an R2 bucket in the selected account, then fill in the real database ID and bucket name in `wrangler.jsonc`. The relay owns a SQLite Durable Object class called `AccountEvents`. Use its HTTPS origin when connecting the desktops.

```sh
npx wrangler d1 create clipsync-relay
npx wrangler r2 bucket create clipsync-ciphertext
npx wrangler d1 migrations apply clipsync-relay --remote
npx wrangler d1 execute clipsync-relay --remote --file /private/devices.sql
npx wrangler deploy
```

## Verification

```sh
npm run check
npm test
```

The integration test starts Wrangler with disposable local bindings and exercises device authorization, account isolation, idempotent upload, pagination, ciphertext download, and WebSocket notification.

## Protocol v1

All `/v1/` endpoints require the device bearer token.

| Request | Response |
| --- | --- |
| `GET /v1/session` | Authenticated account and device IDs |
| `PUT /v1/events/{operation}` | Durable event receipt `{ "seq": number }` |
| `GET /v1/events?after={seq}` | Up to 50 entries with sequence, device, operation, and ciphertext size |
| `GET /v1/events/{device}/{operation}` | Original ciphertext bytes |
| `GET /v1/live` | WebSocket with `changed` wake-up messages |

The ciphertext uses the [ClipSync v1 envelope](../crates/clip-crypto/FORMAT.md). Associated data is the UTF-8 string `clipsync-relay-v1/{account}/{device}/{operation}`. The desktop payload is a bincode 1.x message with a Lamport clock and either a clip snapshot with field clocks or a deletion tombstone. Operation IDs are canonical ULIDs. Retries preserve IDs; a duplicate upload returns the first receipt and keeps the first stored ciphertext. D1 publishes an event only after R2 stores it.

The relay is an append-only event log in this phase. A delete hides the clip on devices and prevents older events from restoring it. Earlier ciphertext remains in R2. A new desktop replays that history to catch up.

For a NAS token, apply all D1 migrations and pass `--archive` with the existing credentials file to the provisioning script. That token can download ciphertext for its account and the Worker rejects its uploads. See the [Synology setup](../apps/nas/README.md).
