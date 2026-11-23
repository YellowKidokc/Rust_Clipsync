use regex::Regex;
use std::sync::LazyLock;

static KNOWN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b(?:cs(?:key|dev)_[a-f0-9]{64}|sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,})\b|\b(?:password|passphrase|passwd|pwd|api[_ -]?key|secret|token)\s*[:=]\s*\S").unwrap()
});
static TOKEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[A-Za-z0-9_+/=-]{24,}").unwrap());
static CARD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[0-9](?:[ -]?[0-9])+").unwrap());

pub fn is_secret(text: &str) -> bool {
    KNOWN.is_match(text)
        || TOKEN.find_iter(text).any(|m| {
            let bytes = m.as_str().as_bytes();
            if !bytes.iter().any(u8::is_ascii_digit) || !bytes.iter().any(u8::is_ascii_alphabetic) {
                return false;
            }
            let mut counts = [0; 128];
            for byte in bytes {
                counts[*byte as usize] += 1;
            }
            let entropy: f64 = counts
                .into_iter()
                .filter(|&n| n > 0)
                .map(|n| {
                    let p = n as f64 / bytes.len() as f64;
                    -p * p.log2()
                })
                .sum();
            entropy >= 4.2
        })
        || CARD.find_iter(text).any(|m| {
            let digits: Vec<_> = m
                .as_str()
                .bytes()
                .filter(u8::is_ascii_digit)
                .map(|b| b - b'0')
                .collect();
            (13..=19).contains(&digits.len())
                && digits.iter().any(|&n| n != digits[0])
                && digits
                    .iter()
                    .rev()
                    .enumerate()
                    .map(|(i, &n)| {
                        if i % 2 == 0 {
                            u32::from(n)
                        } else {
                            u32::from(n * 2 - if n > 4 { 9 } else { 0 })
                        }
                    })
                    .sum::<u32>()
                    % 10
                    == 0
        })
}

#[cfg(test)]
mod tests {
    use super::is_secret;

    #[test]
    fn detects_credentials_and_cards() {
        for sample in [
            "password=example",
            "4111 1111 1111 1111",
            "AKIA0123456789ABCDEF",
            "-----BEGIN PRIVATE KEY-----",
            "eyJhbGci.eyJzdWI.signature",
            "cskey_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "csdev_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ] {
            assert!(is_secret(sample));
        }
        assert!(!is_secret("A meeting at 4 tomorrow"));
        assert!(!is_secret("4111 1111 1111 1112"));
    }
}
