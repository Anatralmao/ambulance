from fastapi import APIRouter

router = APIRouter(prefix="/api")


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