# Giz

AutoML visual que roda no navegador: importe uma planilha, veja o perfil dos dados, monte a receita de tratamento,
compare modelos e exporte o código Python. Uma alternativa open source ao SageMaker Canvas, sem servidor de treino:
o Python (pandas, scikit-learn, LightGBM e XGBoost) roda em WebAssembly, num Web Worker, e **o arquivo não sai do
navegador**.

No ar em https://ml.vgmelo.tech (depois do deploy).

## O fluxo

1. **Importar**: CSV (separador, decimal com vírgula e encoding detectados) ou Excel com várias abas. Tem três
   exemplos: crédito em reais, o mesmo crédito "sujo" de propósito e casas da Califórnia em `.xlsx`.
2. **Perfil**: tipos, nulos, repetidas, distribuições, correlações e alertas ("parece ID", "datas em texto",
   "números em texto", outliers…). Cada alerta tem um botão **Corrigir** que vira um passo da receita.
3. **Receita**: passos que aprendem no treino e se repetem iguais em dados novos (preencher nulos, codificar,
   filtrar, datas, números em texto, outliers, apagar colunas, repetidas). Dá para desligar, reordenar, desfazer
   (⌘Z) e ver a prévia ao vivo.
4. **AutoML**: o tipo de problema é detectado; 20% das linhas ficam guardadas para a avaliação final e o resto passa
   por validação cruzada dentro de um orçamento de tempo, com ranking ao vivo. Antes do treino, uma árvore por coluna
   procura **vazamento do alvo**. O botão Parar interrompe o Python no meio de um fold.
5. **Avaliação**: métricas contra uma referência ingênua, matriz de confusão com corte ajustável e ROC (ou previsto ×
   real e histograma de erros), importância por permutação e explicação de uma previsão com "e se".
6. **Prever em lote**: a receita e o modelo final rodam numa planilha nova; sai um CSV com as colunas originais e as
   previsões.
7. **Exportar**: script Python ou notebook que refaz a receita com os valores aprendidos e treina o mesmo modelo, e
   a receita em JSON. Opcionalmente, **registrar no MLflow** pelo portal do vgmelo.tech (com login e cota).

## Como funciona

- `python/giz/`: o motor, em Python puro sobre pandas e scikit-learn. É o mesmo código no navegador (Pyodide) e no
  CPython, e os testes rodam nos dois.
- `src/worker.ts`: carrega o Pyodide e o motor num Web Worker. Pandas e o leitor de Excel (python-calamine) sobem
  primeiro; scikit-learn, LightGBM e XGBoost carregam em segundo plano enquanto a pessoa olha o perfil.
- `src/`: a interface, em Svelte 5, com gráficos em SVG feitos à mão.
- O Pyodide é servido pelo próprio domínio (`public/pyodide/v<versão>/`, só os pacotes usados, com SHA-256 conferido
  contra o lock). Nada de CDN.
- CSP estrita: `script-src 'self' 'wasm-unsafe-eval'`, sem `unsafe-eval` e sem nada inline. COOP/COEP ligados para o
  botão Parar (SharedArrayBuffer). Os cabeçalhos estão em `scripts/headers.mjs` e em `deploy/Caddyfile`, e um teste
  confere que são iguais.

### MLflow

O navegador nunca fala com o MLflow. Ele manda ao portal (`POST /api/ml/runs`, com o cookie de sessão do
vgmelo.tech) um resumo do experimento: parâmetros, métricas, a receita, o código exportado, o ranking e a
avaliação. Linhas de dados não vão. O modelo vai só se a pessoa marcar, salvo com
[skops](https://skops.readthedocs.io) (sem pickle). O k vizinhos não vai porque guarda as linhas de treino. O portal
confere login, cota e formato, põe as tags de autoria e repassa ao MLflow pela rede interna.

## Números (medidos)

- Download: ~32 MB no total (com cache imutável); ~14 MB até o perfil aparecer, o resto chega em segundo plano.
- Inicialização (máquina local, Chrome): Python pronto em ~2,3 s, modelos em ~4,8 s.
- Crédito (1.000 linhas, 21 colunas): 10 modelos em ~5,5 s.
- Casas da Califórnia (20.640 linhas, 8 colunas), orçamento de 60 s: 7 modelos validados, 2 pulados por tempo,
  ~45 s no total.
- Limite prático: ~100 mil linhas × 20 colunas cabem bem num orçamento de 60 s. Até 500 mil funciona: a validação
  cruzada usa uma amostra de 50 mil e o modelo final treina com tudo (~1 GB de memória).

## Desenvolvimento

```bash
npm install
npm run dev          # baixa o Pyodide para public/ (uma vez) e sobe o Vite em :5180
npm run build        # dist/ + check-dist (sem inline, sem CDN, Pyodide inteiro e com SHA certo)
npm run preview      # serve dist/ com a CSP/COOP/COEP de produção em :4180
npm test             # vitest (gráficos, receita, formatação, ranking, cabeçalhos)
npm run test:py      # testes do motor dentro do Pyodide, no Node (as mesmas versões do navegador)
cd python && uv run pytest -q   # os mesmos testes no CPython (LightGBM/XGBoost precisam de libomp no macOS)
```

`VITE_PORTAL_URL` troca o portal usado no registro do MLflow (padrão: https://vgmelo.tech).

Os exemplos em `public/samples/` saem de `scripts/make_samples.py`.

## Licenças e dados

- Código: MIT.
- Pyodide (MPL-2.0) e os pacotes que ele empacota, cada um com sua licença.
- Crédito: [Statlog (German Credit Data)](https://archive.ics.uci.edu/dataset/144), Hans Hofmann, UCI Machine
  Learning Repository, CC BY 4.0. Traduzido e convertido para reais pelo Giz; a versão "com problemas" foi sujada
  de propósito.
- Casas da Califórnia: California Housing (Pace e Barry, 1997, via StatLib), censo dos EUA de 1990.
