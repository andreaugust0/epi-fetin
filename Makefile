.PHONY: help setup up down logs teste ver reset

help:
	@echo "make setup   - cria o .env com um JWT_SECRET aleatório"
	@echo "make up      - sobe tudo (broker, banco, storage, api, worker)"
	@echo "make logs    - acompanha os logs da api e do worker"
	@echo "make ver     - espia TODO o tráfego MQTT em tempo real"
	@echo "make teste   - roda os dois scripts de teste dentro do contêiner"
	@echo "make down    - derruba os contêineres (mantém os dados)"
	@echo "make reset   - derruba e APAGA os volumes (banco zerado)"

setup:
	@test -f .env || (sed "s|^JWT_SECRET=.*|JWT_SECRET=$$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')|" .env.example > .env && echo ".env criado com segredo aleatório")
	@test -f .env && echo ".env pronto"

up: setup
	docker compose up -d --build
	@echo ""
	@echo "API em    http://localhost:8000/docs"
	@echo "MinIO em  http://localhost:9090  (minioadmin / minioadmin)"

down:
	docker compose down

reset:
	docker compose down -v

logs:
	docker compose logs -f api worker

# Espiar o barramento inteiro. É a ferramenta de depuração mais útil do
# projeto: você vê comando e evento passando, em ordem, com o payload.
ver:
	docker compose exec broker mosquitto_sub -h localhost -t 'epi/#' -v

teste:
	docker compose exec api python -m scripts.testar_biometria
	docker compose exec api python -m scripts.testar_fluxo
