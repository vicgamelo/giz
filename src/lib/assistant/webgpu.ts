// O assistente local precisa de WebGPU com shader-f16 (os pesos são de 16 bits). Sem isso, explica o porquê.

export type GpuCheck = { ok: true } | { ok: false; reason: "no_webgpu" | "no_adapter" | "no_f16" | "error"; message: string };

type GpuLike = { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> };

export const GPU_MESSAGES = {
  no_webgpu:
    "Este navegador não tem WebGPU, que o assistente local usa para rodar o modelo na placa de vídeo. " +
    "Funciona no Chrome e no Edge recentes (e no Safari 26 ou mais novo).",
  no_adapter:
    "O navegador tem WebGPU, mas não achou uma placa de vídeo que ele possa usar (acontece em máquinas virtuais, " +
    "com aceleração de hardware desligada ou driver antigo).",
  no_f16:
    "A placa de vídeo deste aparelho não tem suporte a números de 16 bits no WebGPU (shader-f16), que o modelo local usa.",
  error: "Não consegui consultar o WebGPU deste navegador.",
} as const;

export async function detectGpu(gpu: GpuLike | undefined = (globalThis.navigator as { gpu?: GpuLike } | undefined)?.gpu): Promise<GpuCheck> {
  const fail = (reason: keyof typeof GPU_MESSAGES): GpuCheck => ({ ok: false, reason, message: GPU_MESSAGES[reason] });
  if (!gpu) return fail("no_webgpu");
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return fail("no_adapter");
    if (!adapter.features.has("shader-f16")) return fail("no_f16");
    return { ok: true };
  } catch {
    return fail("error");
  }
}
