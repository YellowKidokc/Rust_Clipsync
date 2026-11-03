// Same rules as src/lib/secrets.ts and src-tauri/src/secrets.rs. The vault masks again on ingest
// so nothing that slipped past an older client is stored in plain text.
export const SECRET_RULES = [
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['aws_access_key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['github_token', /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g],
  ['anthropic_key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ['openai_key', /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ['slack_token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ['stripe_key', /\b[rs]k_(live|test)_[A-Za-z0-9]{16,}\b/g],
  ['google_api_key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ['conn_string_password', /\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi],
  ['assigned_secret', /\b((?:password|passwd|pwd|secret|api[_-]?key|token|auth)\s*[:=]\s*["']?)([^\s"']{6,})/gi],
]

export function maskSecrets(input) {
  const found = new Set()
  let text = String(input ?? '')
  for (const [name, re] of SECRET_RULES) {
    re.lastIndex = 0
    text = text.replace(re, (...m) => {
      found.add(name)
      if (name === 'conn_string_password') return `${m[1]}[REDACTED]${m[3]}`
      if (name === 'assigned_secret') return `${m[1]}[REDACTED]`
      return `[REDACTED:${name}]`
    })
  }
  return { text, found: [...found], masked: found.size > 0 }
}
