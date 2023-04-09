from database.connection import get_db_connection
import docker
from psycopg2.extras import DictCursor

docker_client = docker.from_env()

def get_user_data(user_id):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=DictCursor)
    query = 'SELECT * FROM "User" WHERE id = %s'
    print(f"Executing query: {query} with params: {user_id}")
    cursor.execute(query, (user_id,))
    user_data = cursor.fetchone()
    conn.close()
    return dict(user_data) if user_data else None

def get_client_data(user_id: str):
    conn = get_db_connection()
    query = '''
        SELECT u.*, c.*, c.id as client_id
        FROM "User" u
        LEFT JOIN "Client" c ON u.id = c.user_id
        WHERE u.id = %s
    '''
    with conn:
        cursor = conn.cursor(cursor_factory=DictCursor)
        cursor.execute(query, (user_id,))
        result = cursor.fetchall()
    return result

def get_servers_on_cluster(cluster: str):
    conn = get_db_connection()
    query = '''
        SELECT client_server.*, client.id AS client_id, client.name AS client_name, client.user_id AS client_user_id, client.created_at AS client_created_at, client.updated_at AS client_updated_at
        FROM "ClientServer" client_server
        LEFT JOIN "Client" client ON client_server.id = client.server_id
        WHERE client_server.cluster_name = %s
    '''
    with conn:
        cursor = conn.cursor(cursor_factory=DictCursor)
        cursor.execute(query, (cluster,))
        result = cursor.fetchall()

    # Group clients by server
    servers = {}
    for row in result:
        server_id = row["id"]
        if server_id not in servers:
            servers[server_id] = {
                "id": server_id,
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "cluster_name": row["cluster_name"],
                "clients": []
            }
        
        client = {key: row[key] for key in row.keys() if key.startswith("client_")}
        servers[server_id]["clients"].append(client)

    # Convert the result to a list of dictionaries
    return list(servers.values())


def create_docker_container(user_id, user_data):
    # Create and run the Docker container based on user_data
    pass

def maintain_container_health():
    # Periodically check the status of containers and restart if necessary
    pass

def process_user_data(user_data):
    if not user_data:
        return None
    
    user = {
        "id": user_data[0]["id"],
        "name": user_data[0]["name"],
        "email": user_data[0]["email"],
        "emailVerified": user_data[0]["emailVerified"],
        "image": user_data[0]["image"],
        "clients": []
    }
    
    for row in user_data:
        if row["client_id"]:
            client = {
                "id": row["client_id"],
                "name": row["name"],
                "user_id": row["user_id"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"]
            }
            user["clients"].append(client)
    
    return user
