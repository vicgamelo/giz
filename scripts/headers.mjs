// Cabeçalhos de produção do Giz. O mesmo conjunto está no deploy/ml.Caddyfile (o teste confere).
// - wasm-unsafe-eval: o Pyodide compila WebAssembly; nada de 'unsafe-eval' nem script inline.
// - COOP/COEP: isolamento entre origens, para o botão Parar usar SharedArrayBuffer.
// - connect-src: o próprio domínio (Pyodide e exemplos) e o portal, só para o MLflow.
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
