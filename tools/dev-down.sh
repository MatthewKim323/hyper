#!/bin/sh
# Stop what tools/dev-up.sh started. Data in the docker volumes is kept.
pkill -f "uvicorn app.main:app" ; pkill -f "evaluator/server.mjs"
pkill -f "app.ingestion_worker" ; pkill -f "app.artifact_worker" ; pkill -f "app.simulator_worker" ; pkill -f "app.connectors.worker" ; pkill -f "app.counterparty_worker" ; pkill -f "app.auto_agent"
cd "$(dirname "$0")/../backend" && docker compose -f compose.yaml stop
