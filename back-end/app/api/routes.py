from fastapi import APIRouter, Path, Query
from typing import List, Dict
from datetime import datetime, timedelta
import docker
import os

router = APIRouter()

# Replace with your actual Docker client configuration
docker_client = docker.from_env()

# A simple in-memory store for client_id to docker container mapping
client_docker_map = {}

@router.get("/servers")
async def get_servers() -> List[Dict[str, str]]:
    # Replace this with your logic to fetch the list of running servers
    servers = [
        {"id": "server1", "name": "Server 1"},
        {"id": "server2", "name": "Server 2"}
    ]
    return servers

@router.get("/uptime")
async def get_uptime() -> str:
    # Replace this with your logic to calculate the server uptime
    uptime = timedelta(days=2, hours=5, minutes=30)
    return str(uptime)

@router.get("/status")
async def get_status() -> Dict[str, int]:
    return {"status": 200}

@router.get("/query/{client_id}/{query}")
async def execute_query(client_id: str = Path(...), query: str = Path(...)) -> str:
    container = client_docker_map.get(client_id)
    if container:
        # Replace with your logic to execute the query on the container
        response = f"Executed query '{query}' on container '{container.name}' for client_id '{client_id}'"
    else:
        response = f"No container found for client_id '{client_id}'"
    return response

@router.get("/mappings")
async def get_mappings() -> Dict[str, str]:
    mappings = {client_id: container.name for client_id, container in client_docker_map.items()}
    return mappings

@router.get("/status/{client_id}")
async def get_client_status(client_id: str = Path(...)) -> Dict[str, str]:
    container = client_docker_map.get(client_id)
    status = {}
    if container:
        status["created"] = "Yes"
        status["running"] = "Yes" if container.status == "running" else "No"
    else:
        status["created"] = "No"
        status["running"] = "No"
    return status
