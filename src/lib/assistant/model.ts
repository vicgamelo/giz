// Onde o modelo local é publicado. A pasta muda quando os pesos ou a lib mudam: o Cache API do navegador guarda
// por URL e nunca revalida, então trocar de modelo precisa trocar de endereço.
type Lock = { id: string; revision: string; lib: { commit: string } };

export function modelDir(lock: Lock): string {
  return `/llm/${lock.id}/${lock.revision.slice(0, 10)}-${lock.lib.commit.slice(0, 10)}/`;
}
