from typing import Literal
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from src.scenarios import TEST_CASES
from src.routing import DEFAULT_SPEED_KMH

router = APIRouter(prefix="/api")


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    start: Point
    goal: Point
    algorithm: Literal["astar", "dijkstra"] = "astar"
    speed_kmh: float = Field(default=DEFAULT_SPEED_KMH, gt=0, allow_inf_nan=False)


class SnappedPoint(Point):
    id: str
    distance_meters: float


class RouteResponse(BaseModel):
    coordinates: list[tuple[float, float]]
    distance_km: float
    start: SnappedPoint
    goal: SnappedPoint
    algorithm: Literal["astar", "dijkstra"]
    speed_kmh: float
    segment_distances_km: list[float]
    segment_durations_sec: list[float]
    estimated_time_sec: float


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


@router.post("/route", response_model=RouteResponse)
def route(body: RouteRequest, request: Request):
    road_network = network(request)
    try:
        result = road_network.route(body.start, body.goal, body.algorithm, body.speed_kmh)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    if result is None:
        raise HTTPException(404, "No directed road route connects these points")
    return result


@router.get("/test-cases")
def get_test_cases():
    return TEST_CASES
