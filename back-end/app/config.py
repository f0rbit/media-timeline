import os

# Load environment variables from the .env file
from dotenv import load_dotenv
load_dotenv()

# Set up the database connection string
DATABASE_URL = os.environ.get("DATABASE_URL")
CLUSTER_NAME = os.environ.get("CLUSTER_NAME")