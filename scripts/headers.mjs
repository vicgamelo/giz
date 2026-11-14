// Cabeçalhos de produção do Giz. O mesmo conjunto está no deploy/Caddyfile (o teste confere).
// - wasm-unsafe-eval: o Pyodide compila WebAssembly; nada de 'unsafe-eval' nem script inline.
// - COOP/COEP: isolamento entre origens, para o botão Parar usar SharedArrayBuffer.
// - connect-src: o próprio domínio (Pyodide, exemplos e os pesos do assistente local) e o portal (MLflow e
//   assistente online).
export function headers(portal = "https://vgmelo.tech") {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    `connect-src 'self' ${portal}`,
    "img-src 'self' data: blob:",
    "style-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

// Arquivos com versão ou hash no caminho. Um que falta responde 404, nunca o index.html: senão o navegador (ou o
// cache do WebLLM) guardaria uma página HTML no lugar de um wheel ou de um pedaço do modelo.
export const STATIC_PREFIXES = ["/pyodide/", "/assets/", "/llm/"];

export function cacheControl(pathname) {
  // Pesos do assistente local: quem guarda é o Cache API do WebLLM; no cache HTTP seria 1 GB em dobro.
  if (pathname.startsWith("/llm/")) return "no-store";
  if (pathname.startsWith("/pyodide/") || pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  return "no-cache";
}
