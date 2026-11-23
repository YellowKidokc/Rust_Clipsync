use anyhow::{anyhow, bail, Result};
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, Payload},
    KeyInit, XChaCha20Poly1305,
};
use zeroize::Zeroizing;

pub type Key = Zeroizing<[u8; 32]>;

pub fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0; N];
    getrandom::getrandom(&mut bytes).map_err(|error| anyhow!(error.to_string()))?;
    Ok(bytes)
}

pub fn derive(passphrase: &[u8], salt: &[u8; 16]) -> Result<Key> {
    let params = Params::new(65_536, 3, 1, Some(32)).map_err(|e| anyhow!(e.to_string()))?;
    let mut key = Zeroizing::new([0; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase, salt, key.as_mut())
        .map_err(|e| anyhow!(e.to_string()))?;
    Ok(key)
}

pub fn seal(key: &Key, aad: &[u8], bytes: &[u8]) -> Result<Vec<u8>> {
    seal_with_nonce(key, random()?, aad, bytes)
}

fn seal_with_nonce(key: &Key, nonce: [u8; 24], aad: &[u8], bytes: &[u8]) -> Result<Vec<u8>> {
    let ciphertext = XChaCha20Poly1305::new((&**key).into())
        .encrypt((&nonce).into(), Payload { msg: bytes, aad })
        .map_err(|_| anyhow!("Encryption failed"))?;
    Ok([&[1], nonce.as_slice(), &ciphertext].concat())
}

pub fn open(key: &Key, aad: &[u8], envelope: &[u8]) -> Result<Vec<u8>> {
    if envelope.len() < 41 || envelope[0] != 1 {
        bail!("Invalid ClipSync envelope");
    }
    XChaCha20Poly1305::new((&**key).into())
        .decrypt(
            envelope[1..25].into(),
            Payload {
                msg: &envelope[25..],
                aad,
            },
        )
        .map_err(|_| anyhow!("Clip authentication failed"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agrees_with_libsodium_and_rejects_tampering() -> Result<()> {
        let vector: serde_json::Value = serde_json::from_str(include_str!("../vectors.json"))?;
        let bytes = |name: &str| hex::decode(vector[name].as_str().unwrap()).unwrap();
        let key = derive(
            vector["passphrase"].as_str().unwrap().as_bytes(),
            &bytes("salt").try_into().unwrap(),
        )?;
        assert_eq!(key.as_slice(), bytes("key"));
        let aad = bytes("aad");
        let plaintext = bytes("plaintext");
        let nonce = bytes("nonce").try_into().unwrap();
        let mut envelope = seal_with_nonce(&key, nonce, &aad, &plaintext)?;
        assert_eq!(envelope, bytes("envelope"));
        assert_eq!(open(&key, &aad, &envelope)?, plaintext);
        assert!(open(&key, b"different item", &envelope).is_err());
        *envelope.last_mut().unwrap() ^= 1;
        assert!(open(&key, &aad, &envelope).is_err());
        Ok(())
    }
}
