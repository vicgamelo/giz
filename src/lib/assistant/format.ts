// A resposta do modelo é sempre mostrada como texto (nunca como HTML). Daqui sai só o mínimo de forma: parágrafos,
// itens de lista e negrito com **…**. Links não viram links.

export type Segment = { text: string; bold: boolean };
export type Block = { kind: "p" | "li"; segments: Segment[] };

function segments(line: string): Segment[] {
  const out: Segment[] = [];
  const parts = line.split(/\*\*(.+?)\*\*/g);
  parts.forEach((text, i) => {
    if (text) out.push({ text, bold: i % 2 === 1 });
  });
  return out;
}

export function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const item = line.match(/^(?:[-*•]|\d{1,2}[.)])\s+(.*)$/);
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (item) out.push({ kind: "li", segments: segments(item[1]) });
    else if (heading) out.push({ kind: "p", segments: [{ text: heading[1].replaceAll("**", ""), bold: true }] });
    else out.push({ kind: "p", segments: segments(line) });
  }
  return out;
}

export function megabytes(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB` : `${Math.round(bytes / 1e6)} MB`;
}
