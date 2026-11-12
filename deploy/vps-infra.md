# Mudanças propostas no vps-infra (não aplicadas)

1. Bloco novo em `shared-proxy/vgmelo.caddy`:

```caddy
# Lousa: AutoML no navegador. Estático; o treino roda no navegador de quem usa.
ml.vgmelo.tech {
	import seguro
	encode zstd gzip
	reverse_proxy vgmelo-lousa:8080
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
   `MLFLOW_EXPERIMENT=lousa`, `QUOTA_ML=20`. O portal precisa estar numa rede em comum com o MLflow.

4. DNS: `ml` (A/AAAA) para a VPS.

5. Link na página de demos do vgmelo.tech.

Conferir se o `import seguro` não manda outro `Content-Security-Policy` ou `Cross-Origin-*`: os da Lousa vêm do
Caddy do container (deploy/Caddyfile) e precisam chegar intactos.
