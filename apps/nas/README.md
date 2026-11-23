# ClipSync on Synology

The NAS archive polls the relay over an outbound HTTPS connection and stores the original authenticated ciphertext in PostgreSQL. It retains each synced snapshot and deletion event, including clips you later delete on your desktop. Detected secrets and clips that never synced stay outside the archive. The service has no listening port.

## Set up the archive

1. Apply the relay migrations and deploy the Worker version that supports read-only archive devices. See [relay setup](../../worker/README.md).
2. In `worker/`, run the provisioning script with the credentials file for your **existing** sync account. Keep all credential files outside the repo. Apply only the generated SQL to the relay's D1 database.

   ```sh
   node scripts/provision.mjs /private/nas.json /private/nas.sql 1 /private/existing.json --archive
   npx wrangler d1 execute clipsync-relay --remote --file /private/nas.sql
   ```

3. Create a dedicated PostgreSQL database and a login that owns it or can create the `clipsync_archive` schema. PostgreSQL 17 works with the archive. It can use the PostgreSQL instance already on your NAS, including one with pgvector installed. PostgreSQL TLS is required by default. For a trusted private Docker network with plaintext PostgreSQL, explicitly set `CLIPSYNC_ALLOW_PLAINTEXT_DB=1`.
4. Make a private directory on the NAS, such as `/volume1/docker/clipsync/private`. Put one value per file and make the files readable only by the archive's UID or its trusted group.

   | File | Value |
   | --- | --- |
   | `sync-key` | The existing account's `syncKey` |
   | `device-token` | The NAS token from `nas.json` |
   | `database-url` | PostgreSQL connection URI, using a hostname reachable from the container |

5. In `apps/nas/`, set the following values in the Compose environment or a private `.env`. Set the UID and GID to the owner of your credential files.

   ```dotenv
   CLIPSYNC_RELAY_ORIGIN=https://your-relay.workers.dev
   CLIPSYNC_NAS_SECRETS=/volume1/docker/clipsync/private
   CLIPSYNC_NAS_UID=10001
   CLIPSYNC_NAS_GID=10001
   ```

6. Copy the complete repository to the NAS, then open the Compose project in Synology Container Manager or run these commands from `apps/nas/`.

   ```sh
   docker compose up -d --build
   docker compose logs --tail 50 archive
   docker compose exec archive clipsync-nas status
   ```

If the relay or database goes offline, the service retries and resumes from its last committed sequence. The database is bound to one relay origin and sync account. Changing accounts requires a separate database. The container supports Linux hosts that can build its official base images, including x86-64 and ARM64.

## Find and recover a clip

```sh
docker compose exec -T archive clipsync-nas history
docker compose exec -T archive clipsync-nas history 100 CLIP_ULID
```

History prints up to 100 rows after the supplied sequence. Use `0` to start from the beginning. Snapshots retain the clip data even after a later deletion event. Export a snapshot by its sequence to recover the content. For text, read `data.content.Text` in the exported JSON. For images and files, the JSON contains the image bytes and dimensions or the file names and bytes.

```sh
umask 077
docker compose exec -T archive clipsync-nas export 42 > recovered-clip.json
```

The export is plaintext. Keep it in a private location. For backups, dump the `clipsync_archive` PostgreSQL schema and back up the shared sync key separately. The database dump contains encrypted clip payloads and routing metadata, and the original key is required to recover content offline. PostgreSQL and the cloud relay retain their own copies according to their respective storage policies.
