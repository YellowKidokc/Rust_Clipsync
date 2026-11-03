//! Secret masking on capture. Same rules as src/lib/secrets.ts and server/src/secrets.js.
use once_cell::sync::Lazy;
use regex::Regex;

struct Rule {
    name: &'static str,
    re: Regex,
    /// Some(fmt) keeps capture groups around the value, e.g. "password=" stays readable.
    keep: Option<&'static str>,
}

static RULES: Lazy<Vec<Rule>> = Lazy::new(|| {
    let r = |name, pat: &str, keep| Rule { name, re: Regex::new(pat).unwrap(), keep };
    vec![
        r("private_key", r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----", None),
        r("aws_access_key", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b", None),
        r("github_token", r"\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b", None),
        r("anthropic_key", r"\bsk-ant-[A-Za-z0-9_-]{20,}", None),
        r("openai_key", r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}", None),
        r("slack_token", r"\bxox[abprs]-[A-Za-z0-9-]{10,}", None),
        r("stripe_key", r"\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b", None),
        r("google_api_key", r"\bAIza[0-9A-Za-z_-]{35}", None),
        r("jwt", r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", None),
        r("conn_string_password", r"(?i)\b([a-z][a-z0-9+.-]*://[^:\s/@]+:)([^@\s]+)(@)", Some("${1}[REDACTED]${3}")),
        r("assigned_secret", r#"(?i)\b((?:password|passwd|pwd|secret|api[_-]?key|token|auth)\s*[:=]\s*["']?)([^\s"']{6,})"#, Some("${1}[REDACTED]")),
    ]
});

pub struct Masked {
    pub text: String,
    pub found: Vec<&'static str>,
}

pub fn mask(input: &str) -> Masked {
    let mut text = input.to_string();
    let mut found = Vec::new();
    for rule in RULES.iter() {
        if rule.re.is_match(&text) {
            found.push(rule.name);
            let rep = match rule.keep {
                Some(k) => k.to_string(),
                None => format!("[REDACTED:{}]", rule.name),
            };
            text = rule.re.replace_all(&text, rep.as_str()).into_owned();
        }
    }
    Masked { text, found }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn masks_common_secrets() {
        let m = mask("key sk-ant-api03-abcdefghijklmnopqrstuvwxyz and password=hunter22 and postgres://u:pw123@h/db");
        assert!(!m.text.contains("abcdefghijklmnop"));
        assert!(m.text.contains("password=[REDACTED]"));
        assert!(m.text.contains("postgres://u:[REDACTED]@h/db"));
        assert_eq!(m.found, vec!["anthropic_key", "conn_string_password", "assigned_secret"]);
    }
    #[test]
    fn leaves_plain_text() {
        let m = mask("just a normal sentence about tokens of grace");
        assert!(m.found.is_empty());
    }
}
