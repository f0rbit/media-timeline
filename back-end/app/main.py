from fastapi import FastAPI
from api.routes import router

app = FastAPI()

# Register API routes with a "/api" prefix
app.include_router(router, prefix="/api")

# Optional: Add a root route for basic health checks or landing page
@app.get("/")
async def root():
    return {"message": "Hello from the Python backend service!"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
