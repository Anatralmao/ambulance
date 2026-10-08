from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import uvicorn
import asyncio
import logging
from contextlib import asynccontextmanager
from src.routing import RoadNetwork

BASE_DIR = Path(__file__).resolve().parent


@asynccontextmanager
async def lifespan(app):
    app.state.network = None
    app.state.network_error = False

    async def prepare():
        try:
            app.state.network = await asyncio.to_thread(
                RoadNetwork, BASE_DIR / "static/data/hanoi_map.json", BASE_DIR / ".cache/routing")
        except Exception:
            app.state.network_error = True
            logging.exception("Could not prepare road network")

    task = asyncio.create_task(prepare())
    yield
    await task


app = FastAPI(lifespan=lifespan)
# The graph is backend data; expose only UI assets.
app.mount("/static/JS", StaticFiles(directory=BASE_DIR / "static/JS"), name="scripts")
app.mount("/static/CSS", StaticFiles(directory=BASE_DIR / "static/CSS"), name="styles")

from src.api.routes import router

app.include_router(router)

@app.get("/")
def home():
    return FileResponse(BASE_DIR / "templates" / "index.html")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=False
    )
