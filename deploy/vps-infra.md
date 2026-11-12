# Mudanças propostas no vps-infra (não aplicadas)

1. Bloco novo em `shared-proxy/vgmelo.caddy`:

```caddy
# Giz: AutoML no navegador. Estático; o treino roda no navegador de quem usa.
ml.vgmelo.tech {
	import seguro
	encode zstd gzip
	reverse_proxy vgmelo-giz:8080
}
```

2. No bloco `vgmelo.tech`, antes do `@portal`: o registro no MLflow manda até ~5 MB (o modelo em skops, em base64).

```caddy
	@ml path /api/ml/*
	handle @ml {
		request_body {
			max_size 6MB
		}
		reverse_proxy vgmelo-portal:8000
	}
```

3. `.env` do portal: `MLFLOW_URL=http://mlflow:5000` (rede interna), `ML_ORIGIN=https://ml.vgmelo.tech`,
   `MLFLOW_EXPERIMENT=giz`, `QUOTA_ML=20`. O portal precisa estar numa rede em comum com o MLflow.

4. DNS: `ml` (A/AAAA) para a VPS.

5. Link na página de demos do vgmelo.tech.

6. Assistente local (opcional; sem isso o Giz sobe igual, só sem o modelo no navegador). Os pesos (~1 GB) não vão no
   `dist/`: ficam em `/opt/vgmelo/giz/llm`, montado em `/srv-llm/llm` (já está no `compose.yml`).

```bash
npm run vendor:llm                                   # na máquina de build: baixa e confere contra o lock
rsync -a .cache/llm/llm/ vps:/opt/vgmelo/giz/llm/     # sem --delete: o modelo antigo fica até o build novo entrar
node scripts/vendor-llm.mjs --check /opt/vgmelo/giz  # na VPS (ou via sshfs): confere a pasta publicada
```

   A pasta precisa existir antes do `docker compose up` (vazia serve). Trocar de modelo muda o caminho
   (`/llm/<modelo>/<revisão>-<lib>/`), então dá para subir o novo antes de publicar o build que aponta para ele e
   apagar a pasta antiga depois. O navegador confere a configuração, a lib e o tokenizer; os pesos, só o `--check`.

7. Assistente online: `.env` do portal com `ASSISTANT_API_KEY` (chave do provedor gratuito, só no servidor),
   `ASSISTANT_URL`, `ASSISTANT_MODEL`, `ASSISTANT_PROVIDER` (o nome que aparece no consentimento) e `QUOTA_ASSISTANT`.
   Sem a chave, `GET /api/ml/assistant` responde `enabled: false` e o painel só oferece o modo local.

Conferir se o `import seguro` não manda outro `Content-Security-Policy` ou `Cross-Origin-*`: os do Giz vêm do
Caddy do container (deploy/Caddyfile) e precisam chegar intactos.
