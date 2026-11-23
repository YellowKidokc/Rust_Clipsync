# ClipSync encryption format v1

Derive 32 bytes with Argon2id version 19 using the UTF-8 passphrase, a 16-byte random salt, 65,536 KiB of memory, three iterations, and one lane. Keep the salt with the local vault and store the derived key in the OS keychain. With libsodium, use `crypto_pwhash_ALG_ARGON2ID13`, an ops limit of 3, and a memory limit of 67,108,864 bytes.

Each envelope is one version byte (`01`), a random 24-byte nonce, and the XChaCha20-Poly1305 IETF combined output (ciphertext followed by the 16-byte authentication tag). Authenticate the UTF-8 item ULID as associated data. Generate a fresh nonce for every encryption, including when updating metadata. Reject unknown versions, truncated envelopes, and authentication failures.

The envelope accepts arbitrary bytes. The Phase 1 SQLite store uses bincode 1.x for its local payload. An interoperable sync payload can be specified independently of the envelope.

[`vectors.json`](vectors.json) contains one vector generated with libsodium. All fields other than `passphrase` use hex encoding.
