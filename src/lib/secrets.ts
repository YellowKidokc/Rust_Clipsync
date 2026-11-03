// Secret detection + masking. Mirrored in src-tauri/src/secrets.rs and server/src/secrets.js:
// keep the three rule lists in step. Masking runs on capture, before anything leaves the device.

export interface SecretRule { name: string; re: RegExp }

export const SECRET_RULES: SecretRule[] = [
  { name: 'private_key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'aws_access_key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'github_token', re: /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { name: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'openai_key', re: /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: 'slack_token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'stripe_key', re: /\b[rs]k_(live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: 'google_api_key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'conn_string_password', re: /\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi },
  { name: 'assigned_secret', re: /\b((?:password|passwd|pwd|secret|api[_-]?key|token|auth)\s*[:=]\s*["']?)([^\s"']{6,})/gi },
]

export interface MaskResult { text: string; found: string[]; masked: boolean }

export function maskSecrets(input: string): MaskResult {
  const found = new Set<string>()
  let text = input
  for (const { name, re } of SECRET_RULES) {
    re.lastIndex = 0
    text = text.replace(re, (...m: any[]) => {
      found.add(name)
      // Rules with a captured prefix keep it (so "password=" stays readable) and mask the value.
      if (name === 'conn_string_password') return `${m[1]}[REDACTED]${m[3]}`
      if (name === 'assigned_secret') return `${m[1]}[REDACTED]`
      return `[REDACTED:${name}]`
    })
  }
  return { text, found: [...found], masked: found.size > 0 }
}
