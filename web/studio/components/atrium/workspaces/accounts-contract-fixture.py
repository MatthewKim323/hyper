"""Exercise real read routes in an isolated temporary database, without external services.

Fixture records are test-only. They are never imported into Hyper's running workspace.
The production JWT verifier, parser, query service, source download and list routes run.
"""
import json
import os
from pathlib import Path
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[5] / "backend"))

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from app import auth, data_api, orchestrator_api, concern_api
from app.connectors import api as connection_api
from app.data_service import DataService
from app.database import connections, agent_cases, agent_tasks, concerns
from app.store import Store


class MemoryObjects:
    def __init__(self):
        self.data = {}

    def put(self, key, body, content_type):
        self.data[key] = body

    def read(self, key):
        return self.data[key]


def exercise():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    os.environ["CLERK_ISSUER"] = "https://contract-test.invalid"
    os.environ["CLERK_AUTHORIZED_PARTIES"] = "http://contract-test.invalid"
    os.environ["CLERK_JWT_PUBLIC_KEY"] = private_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    os.environ.pop("CLERK_AUDIENCE", None)
    os.environ.pop("DEMO_USER_IDS", None)

    def headers(user):
        now = int(time.time())
        token = jwt.encode({"sub": user, "sid": "contract-session-" + user,
                            "iss": os.environ["CLERK_ISSUER"], "azp": "http://contract-test.invalid",
                            "iat": now, "nbf": now, "exp": now + 120}, private_key, algorithm="RS256")
        return {"Authorization": "Bearer " + token}

    with tempfile.TemporaryDirectory(prefix="hyper-folio-contract-") as directory:
        store = Store(str(Path(directory) / "test.sqlite"))
        objects = MemoryObjects()
        alice = DataService(store, store.workspace("contract-alice")["id"], objects)
        bob = DataService(store, store.workspace("contract-bob")["id"], objects)
        old = alice.ingest("invoices.json", b'{"invoice_id":"A-1","amount_cents":"1"}',
                           source_key="ap-export", dataset="ap_invoices", id_field="invoice_id")
        records = [
            {"invoice_id": "A-1", "amount_cents": "12345678901234567890123456.123456", "vendor_name": "Contract fixture A", "synthetic": True,
             "line_items": [{"description": "Fixture line", "quantity": 2, "unit_price_cents": "12.5", "amount_cents": "25"}]},
            {"invoice_id": "A-2", "amount_cents": "500", "vendor_name": "Contract fixture B"},
            {"invoice_id": "A-3", "amount_cents": "-50", "vendor_name": "Contract fixture C"},
        ]
        original = json.dumps(records).encode()
        current = alice.ingest("invoices.json", original, source_key="ap-export", dataset="ap_invoices", id_field="invoice_id")
        other = bob.ingest("private.json", b'{"invoice_id":"B-1","amount_cents":"900"}',
                           dataset="ap_invoices", currency="EUR", id_field="invoice_id")
        with store.engine.begin() as db:
            for label, service in [("alice", alice), ("bob", bob)]:
                db.execute(connections.insert().values(id="connection-" + label, organization_id=service.oid,
                    provider="ramp", label=label + " test source", status="connected", credentials="fixture-secret",
                    external_id="fixture-external-id", config={}, cursor={"secret": "fixture-cursor"},
                    created_at=1, last_synced_at=2, claim_token="fixture-claim"))
            db.execute(agent_cases.insert().values(id="case-alice", organization_id=alice.oid, case_key="supplier",
                title="Source-linked fixture case", version=1, updated_at=1,
                state={"source_ids": [current["id"]], "concern_ids": ["concern-alice"], "findings": [],
                       "unknowns": ["Fixture receipt missing"], "next_actions": ["Read fixture receipt"]}))
            db.execute(agent_tasks.insert().values(id="task-alice", organization_id=alice.oid, case_id="case-alice",
                request_key="fixture-task", objective="Read fixture receipt", status="running", created_at=1))
            db.execute(concerns.insert().values(id="concern-alice", organization_id=alice.oid, request_key="fixture-concern",
                status="awaiting_response", created_at=1, updated_at=1,
                request={"title": "Fixture decision", "description": "Inspect fixture", "severity": "low", "source_ids": [current["id"]]}))

        app = FastAPI()
        for router in [data_api.router, connection_api.router, orchestrator_api.router, concern_api.router]:
            app.include_router(router)

        # Only the database dependency is replaced. The actual Clerk JWT verifier is used,
        # with a short-lived local test key instead of an external JWKS request.
        def scoped_service(identity=Depends(auth.current_user)):
            try:
                return DataService(store, store.workspace(identity.user_id)["id"], objects)
            except PermissionError:
                raise HTTPException(403, "Workspace access removed") from None

        app.dependency_overrides[data_api.service] = scoped_service
        client = TestClient(app)
        a, b = headers("contract-alice"), headers("contract-bob")

        def get(path, identity=a):
            response = client.get(path, headers=identity)
            assert response.status_code == 200, (path, response.status_code, response.text)
            return response.json()

        def rows(offset=0, identity=a):
            response = client.post("/financials/query", headers=identity,
                json={"dataset": "ap_invoices", "operation": "rows", "limit": 2, "offset": offset})
            assert response.status_code == 200, response.text
            return response.json()

        source = get(f"/sources/{current['id']}?offset=0&limit=2")
        source_next = get(f"/sources/{current['id']}?offset=2&limit=2")
        downloaded = client.get(source["download_url"], headers=a)
        assert downloaded.content == original
        result = {
            "current_source_id": current["id"], "previous_source_id": old["id"], "other_source_id": other["id"],
            "catalog": get("/datasets"), "first_page": rows(), "second_page": rows(2), "other_page": rows(identity=b),
            "source": source, "source_next": source_next,
            "download": {"status": downloaded.status_code, "headers": dict(downloaded.headers), "same_bytes": downloaded.content == original},
            "connections": get("/connections"), "other_connections": get("/connections", b),
            "cases": get("/agents/cases"), "tasks": get("/agents/tasks"), "concerns": get("/concerns"),
            "other_cases": get("/agents/cases", b), "other_tasks": get("/agents/tasks", b), "other_concerns": get("/concerns", b),
            "anonymous_status": client.get("/datasets").status_code,
            "invalid_status": client.get("/connections", headers={"Authorization": "Bearer invalid"}).status_code,
            "foreign_source_status": client.get(f"/sources/{current['id']}", headers=b).status_code,
            "foreign_download_status": client.get(f"/sources/{current['id']}/download", headers=b).status_code,
        }
        client.close()
        store.engine.dispose()
        return result


if __name__ == "__main__":
    print(json.dumps(exercise()))
