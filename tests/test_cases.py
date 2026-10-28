TEST_CASES = {
    "cases": [
        {
            "case_id": "TC01",
            "description": "Normal route",
            "hospital": {
                "id": 8502010001,
                "name": "Bach Mai Hospital",
                "coords": [21.005800, 105.850100],
                "verified": True,
            },
            "emergency_target": {
                "id": 8502010002,
                "coords": [21.012600, 105.867800],
            },
            "expected_metrics": {
                "min_distance_m": 1850.0,
                "estimated_time_s": 420.0,
            },
        },
        {
            "case_id": "TC02",
            "description": "One-way detour",
            "hospital": {
                "id": 8502010008,
                "name": "Vietnam-Germany Hospital",
                "coords": [21.017500, 105.847200],
                "verified": True,
            },
            "emergency_target": {
                "id": 8502010009,
                "coords": [21.024100, 105.860400],
            },
            "expected_metrics": {
                "min_distance_m": 2720.0,
                "estimated_time_s": 640.0,
            },
        },
        {
            "case_id": "TC03",
            "description": "Obstacle bypass",
            "hospital": {
                "id": 8502010012,
                "name": "Saint Paul General Hospital",
                "coords": [21.030800, 105.844500],
                "verified": True,
            },
            "emergency_target": {
                "id": 8502010013,
                "coords": [21.038300, 105.859700],
            },
            "expected_metrics": {
                "min_distance_m": 3360.0,
                "estimated_time_s": 780.0,
            },
        },
    ],
    "traffic_obstacles": {
        "one_way_edges": [
            [100201, 100202],
            [100202, 100203],
            [100305, 100306],
            [100410, 100411],
            [100500, 100501],
        ],
        "blocked_edges": [
            [100214, 100215],
            [100330, 100331],
            [100420, 100421],
        ],
        "speed_penalties": [
            {"edge": [100203, 100204], "penalty_multiplier": 1.6},
            {"edge": [100318, 100319], "penalty_multiplier": 1.4},
            {"edge": [100501, 100502], "penalty_multiplier": 1.8},
        ],
        "turn_restrictions": [
            {"from_node": 100202, "via_node": 100203, "to_node": 100204, "restriction": "no_left_turn"},
            {"from_node": 100315, "via_node": 100316, "to_node": 100317, "restriction": "no_left_turn"},
            {"from_node": 100500, "via_node": 100501, "to_node": 100502, "restriction": "no_left_turn"},
        ],
    },
}
