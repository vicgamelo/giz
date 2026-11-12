// Os modelos Qwen3 abrem a resposta com um bloco <think>…</think> (vazio quando o raciocínio está desligado).
// A tela mostra só o que vem depois dele, inclusive enquanto a resposta ainda está chegando.
const OPEN = "<think>";
const CLOSE = "</think>";

export function visibleText(raw: string): string {
  const text = raw.trimStart();
  if (!text.startsWith(OPEN)) return OPEN.startsWith(text) ? "" : text;
  const end = text.indexOf(CLOSE);
  return end < 0 ? "" : text.slice(end + CLOSE.length).trimStart();
}
