from fastapi import APIRouter

router = APIRouter(prefix="/api")


@router.get("/test")
def health_check():
    return {
        "status": "ok"
    }