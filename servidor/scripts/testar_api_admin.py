"""Exercita os endpoints do painel administrativo por HTTP de verdade.

Sobe a API com o TestClient do FastAPI e percorre o caminho que o painel
vai percorrer: login, CRUD de pessoas, catálogo de EPIs, política do ponto
e relatórios.

    python -m scripts.testar_api_admin
"""
from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db.models import LogAuditoria, Pessoa
from app.db.session import SessionLocal, engine
from app.main import app

ok, falhas = 0, []


def checar(nome: str, cond: bool, extra: str = "") -> None:
    global ok
    if cond:
        ok += 1
        print(f"  ok    {nome} {extra}")
    else:
        falhas.append(nome)
        print(f"  FALHA {nome} {extra}")


async def limpar() -> None:
    async with SessionLocal() as db:
        await db.execute(delete(LogAuditoria))
        await db.execute(delete(Pessoa).where(Pessoa.matricula.like("ADM-%")))
        await db.commit()
    await engine.dispose()


def main() -> None:
    asyncio.run(limpar())

    with TestClient(app) as c:
        print("\n1. autenticação")
        r = c.post("/api/v1/auth/login",
                   json={"email": "admin@epiguard.com.br", "senha": "admin123"})
        checar("login com credenciais corretas", r.status_code == 200,
               f"({r.status_code})")
        token = r.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        r = c.post("/api/v1/auth/login",
                   json={"email": "admin@epiguard.com.br", "senha": "errada"})
        checar("senha errada é recusada", r.status_code == 401, f"({r.status_code})")

        r = c.get("/api/v1/pessoas")
        checar("endpoint protegido sem token devolve 403", r.status_code == 403,
               f"({r.status_code})")

        print("\n2. CRUD de pessoas")
        r = c.post("/api/v1/pessoas", headers=h, json={
            "matricula": "ADM-001", "nome": "Joana Silva", "funcao": "Soldadora"})
        checar("criar pessoa", r.status_code == 201, f"({r.status_code})")
        pid = r.json()["id"]
        checar("nasce sem biometria e sem consentimento",
               r.json()["biometrias"] == 0
               and r.json()["consentimento_vigente"] is False)

        r = c.post("/api/v1/pessoas", headers=h, json={
            "matricula": "ADM-001", "nome": "Outra"})
        checar("matrícula duplicada é recusada", r.status_code == 409,
               f"({r.status_code})")

        r = c.get("/api/v1/pessoas", headers=h, params={"busca": "Joana"})
        checar("busca por nome encontra", r.json()["total"] >= 1)

        r = c.patch(f"/api/v1/pessoas/{pid}", headers=h,
                    json={"funcao": "Supervisora"})
        checar("editar função", r.json()["funcao"] == "Supervisora")

        print("\n3. consentimento e biometria")
        r = c.post(f"/api/v1/pessoas/{pid}/biometrias", headers=h, json={
            "modelo": "facenet512-v1", "embedding": [0.1] * 512})
        checar("cadastro sem consentimento é bloqueado", r.status_code == 412,
               f"({r.status_code})")

        r = c.post(f"/api/v1/pessoas/{pid}/consentimento", headers=h,
                   json={"versao_termo": "1.0"})
        checar("registrar consentimento", r.status_code == 201,
               f"({r.status_code})")

        r = c.post(f"/api/v1/pessoas/{pid}/biometrias", headers=h, json={
            "modelo": "facenet512-v1", "embedding": [0.1] * 512})
        checar("cadastro com consentimento é aceito", r.status_code == 201,
               f"({r.status_code})")

        r = c.post(f"/api/v1/pessoas/{pid}/biometrias", headers=h, json={
            "modelo": "outro-modelo", "embedding": [0.1] * 512})
        checar("modelo divergente é recusado", r.status_code == 400,
               f"({r.status_code})")

        r = c.get(f"/api/v1/pessoas/{pid}", headers=h)
        d = r.json()
        checar("detalhe mostra a biometria cadastrada",
               d["biometrias"] == 1 and d["consentimento_vigente"] is True)

        r = c.delete(f"/api/v1/pessoas/{pid}/consentimento", headers=h)
        checar("revogação elimina os vetores",
               r.json()["biometrias_eliminadas"] == 1, f"({r.json()})")

        print("\n4. catálogo de EPIs")
        r = c.get("/api/v1/tipos-epi", headers=h)
        checar("listar tipos", r.status_code == 200 and len(r.json()) >= 5,
               f"({len(r.json())} tipos)")
        codigos = {t["codigo"] for t in r.json()}

        r = c.post("/api/v1/tipos-epi", headers=h, json={
            "codigo": "capacete", "rotulo": "X", "classe_modelo": "y"})
        checar("código duplicado é recusado", r.status_code == 409,
               f"({r.status_code})")

        print("\n5. política do ponto de acesso")
        ponto_id = c.get("/api/v1/pontos").json()[0]["id"]

        r = c.put(f"/api/v1/pontos/{ponto_id}/epis", headers=h,
                  json={"codigos": ["capacete", "colete"]})
        checar("definir EPIs exigidos", r.status_code == 200
               and sorted(r.json()["epis_exigidos"]) == ["capacete", "colete"],
               f"({r.json().get('epis_exigidos')})")

        r = c.put(f"/api/v1/pontos/{ponto_id}/epis", headers=h,
                  json={"codigos": ["capacete", "inexistente"]})
        checar("código inexistente falha alto, não em silêncio",
               r.status_code == 422, f"({r.status_code})")

        r = c.get("/api/v1/pontos")
        checar("a política inválida não foi aplicada",
               sorted(r.json()[0]["epis_exigidos"]) == ["capacete", "colete"])

        # devolve ao estado original do seed
        c.put(f"/api/v1/pontos/{ponto_id}/epis", headers=h,
              json={"codigos": ["capacete", "oculos", "colete"]})

        print("\n6. dispositivos e relatórios")
        r = c.get("/api/v1/dispositivos", headers=h)
        checar("listar dispositivos", r.status_code == 200 and len(r.json()) >= 3,
               f"({len(r.json())} dispositivos)")

        for rota in ("conformidade", "epis-faltantes", "biometria"):
            r = c.get(f"/api/v1/relatorios/{rota}", headers=h, params={"dias": 30})
            checar(f"relatório {rota}", r.status_code == 200, f"({r.status_code})")

        print("\n7. trilha de auditoria")
        r = c.get("/api/v1/verificacoes", headers=h, params={"limite": 5})
        checar("listar verificações paginado", r.status_code == 200
               and "total" in r.json())

    async def contar_auditoria() -> int:
        from sqlalchemy import func, select
        async with SessionLocal() as db:
            n = (await db.execute(
                select(func.count(LogAuditoria.id))
            )).scalar_one()
        await engine.dispose()
        return n

    n = asyncio.run(contar_auditoria())
    checar("ações administrativas foram auditadas", n >= 4, f"({n} registros)")

    print(f"\n{'=' * 56}")
    print(f"{ok} verificações passaram, {len(falhas)} falharam")
    if falhas:
        for f in falhas:
            print(f"  - {f}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
