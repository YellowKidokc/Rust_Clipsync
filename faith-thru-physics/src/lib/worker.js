// Anything live goes through a Cloudflare Worker, never straight from the browser,
// and no API key ever lives in this site. These are placeholders until the Worker exists.
export const WORKER_BASE = "/api";

export async function search(query) {
  return { placeholder: true, query, results: [], message: "Search will call a Cloudflare Worker (AI Search / Vectorize) at /api/search. Not connected yet." };
}

export async function converse(message) {
  return { placeholder: true, message, reply: "The conversation will run through a Cloudflare Worker at /api/converse (AI Gateway to DeepSeek). Not connected yet." };
}
