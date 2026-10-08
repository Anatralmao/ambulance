from typing import Literal
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api")


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    start: Point
    goal: Point
    algorithm: Literal["astar", "dijkstra"] = "astar"


def network(request):
    if request.app.state.network_error:
        raise HTTPException(503, "Road network could not be loaded")
    if request.app.state.network is None:
        raise HTTPException(503, "Road network is still loading", headers={"Retry-After": "2"})
    return request.app.state.network


@router.get("/network/status")
def network_status(request: Request):
    return {"status": "error" if request.app.state.network_error else
            "ready" if request.app.state.network is not None else "loading"}


@router.get("/nearest")
def nearest(request: Request, lat: float = Query(ge=-90, le=90),
            lng: float = Query(ge=-180, le=180)):
    return network(request).nearest(lat, lng)[1]


@router.post("/route")
def route(body: RouteRequest, request: Request):
    result = network(request).route(body.start, body.goal, body.algorithm)
    if result is None:
        raise HTTPException(404, "No directed road route connects these points")
    return result


@router.get("/test-cases")
def get_test_cases():
    return [
        {
            "id": "case_001",
            "name": "Emergency Case 1"
        },
        {
            "id": "case_002",
            "name": "Emergency Case 2"
        }
    ]
