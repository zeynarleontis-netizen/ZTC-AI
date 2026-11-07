/**
 * ZTC AI V24 — Vercel Edge Function CORS relay.
 * Deploy this file at /api/relay.js. Configure RELAY_TOKEN as a Vercel
 * Environment Variable (Production/Preview as needed), then redeploy.
 * Optional ALLOWED_HOSTS: comma-separated exact hosts or subdomain suffixes.
 */
export const config = { runtime: "edge" };

const DEFAULT_HOSTS = [
  "gen.pollinations.ai", "text.pollinations.ai", "api.pollinations.ai",
  "glm.cognix.sryze.cc", "api.groq.com", "integrate.api.nvidia.com",
  "openrouter.ai", "oai.endpoints.kepler.ai.cloud.ovh.net", "api.kilo.ai",
  "ai.hackclub.com", "api.llm7.io", "g4f.space", "api.cerebras.ai",
  "api.mistral.ai", "open.bigmodel.cn", "api.sambanova.ai",
  "api.siliconflow.com", "api.cohere.com", "generativelanguage.googleapis.com",
  "api.cloudflare.com", "api.llmfaucet.dev", "aihorde.net", "models.github.ai",
  "router.huggingface.co", "router.requesty.ai", "api.aionlabs.ai",
  "inference.hetzner.com", "api.airforce", "api.unorouter.com", "ollama.com",
  "api.free.ai", "blockrun.ai", "flm.stonech.at", "dg-ai.scriptsnsenses.workers.dev",
  "net.beaverai.org", "chatgpt-free-api-sasa-dev.vercel.app",
  "api.murakumo.cloud", "vireonix.ai", "animica.dev", "api.jarvisclaw.ai",
  "api.opentyphoon.ai", "ai-gateway.vercel.sh", "r.jina.ai", "en.wikipedia.org"
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-Target-URL, X-Relay-Token, HTTP-Referer, X-Title, X-KILOCODE-EDITORNAME, Client-Agent, X-API-Key, Anthropic-Version",
  "Access-Control-Expose-Headers": "Content-Type, Retry-After, X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
};

function reply(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { ...CORS, "Cache-Control": "no-store", ...extra }
  });
}

function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function allowedHost(host, extraHosts) {
  const extras = String(extraHosts || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  return DEFAULT_HOSTS.concat(extras).some(domain => host === domain || host.endsWith("." + domain));
}

function forwardedHeaders(incoming) {
  const headers = new Headers();
  for (const [name, value] of incoming.entries()) {
    const n = name.toLowerCase();
    if (["host", "origin", "referer", "content-length", "connection", "transfer-encoding", "accept-encoding", "x-target-url", "x-relay-token"].includes(n)) continue;
    if (n.startsWith("sec-") || n.startsWith("x-vercel-") || n.startsWith("x-forwarded-") || n.startsWith("x-real-")) continue;
    headers.set(name, value);
  }
  return headers;
}

export default async function handler(request) {
  const requestUrl = new URL(request.url);
  if (request.method === "OPTIONS") return reply(null, 204);

  if (request.method === "GET" && requestUrl.searchParams.get("health") === "1") {
    return reply(JSON.stringify({ ok: true, name: "ZTC AI CORS Relay", platform: "Vercel Edge", version: "1.0.0" }), 200, { "Content-Type": "application/json" });
  }

  if (!["GET", "POST"].includes(request.method)) return reply("Method not allowed", 405);
  const env = typeof process !== "undefined" && process.env ? process.env : {};
  const secret = env.RELAY_TOKEN || "";
  if (!secret) return reply("Relay secret RELAY_TOKEN is not configured", 503);
  if (!safeEqual(request.headers.get("X-Relay-Token"), secret)) return reply("Unauthorized relay token", 401);

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 5 * 1024 * 1024) return reply("Request body exceeds 5 MB", 413);
  const targetRaw = request.headers.get("X-Target-URL");
  if (!targetRaw) return reply("Missing X-Target-URL", 400);

  let target;
  try { target = new URL(targetRaw); } catch { return reply("Invalid target URL", 400); }
  if (target.protocol !== "https:" || target.username || target.password || target.port) {
    return reply("Only standard HTTPS targets are allowed", 400);
  }
  if (!allowedHost(target.hostname.toLowerCase(), env.ALLOWED_HOSTS)) {
    return reply("Target host is not allowlisted. Add it to ALLOWED_HOSTS.", 403);
  }

  const init = { method: request.method, headers: forwardedHeaders(request.headers), redirect: "manual" };
  if (request.method === "POST") init.body = request.body;
  try {
    const upstream = await fetch(target.href, init);
    const outHeaders = {};
    for (const name of ["content-type", "retry-after", "x-request-id", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
      const value = upstream.headers.get(name);
      if (value) outHeaders[name] = value;
    }
    // Passing the upstream ReadableStream through preserves streaming/SSE responses.
    return reply(upstream.body, upstream.status, outHeaders);
  } catch (error) {
    const message = String(error && error.message || error).slice(0, 180);
    return reply("Upstream relay error: " + message, 502, { "Content-Type": "text/plain; charset=utf-8" });
  }
}
