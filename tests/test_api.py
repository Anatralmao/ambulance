import unittest

from fastapi.testclient import TestClient

from main import app


class ApiTests(unittest.TestCase):
    def test_test_cases_endpoint_returns_data(self):
        client = TestClient(app)
        response = client.get("/api/test-cases")
        self.assertEqual(response.status_code, 200)
        self.assertIn("cases", response.json())


if __name__ == "__main__":
    unittest.main()
