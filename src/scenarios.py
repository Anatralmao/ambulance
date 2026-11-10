SOURCE_TEST_CASES = {
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

TRAFFIC_SCENARIOS = {
    "traffic_jam_tc01": {
        "id": "traffic_jam_tc01",
        "kind": "peak_congestion",
        "label": "TC01 - Traffic jam, 12 km/h",
        "description": "Simulated peak-hour congestion",
        "route_case_id": "TC01",
        "event_edges": (
            ("node_4592527911", "node_12783034931"),
            ("node_12783034931", "node_6661805155"),
            ("node_6661805155", "node_8259084423"),
            ("node_8259084423", "node_6408478722"),
            ("node_6408478722", "node_6661963558"),
        ),
        "speed_kmh": 12.0,
    },
    "traffic_jam_tc02": {
        "id": "traffic_jam_tc02",
        "kind": "peak_congestion",
        "label": "TC02 - Traffic jam, 12 km/h",
        "description": "Simulated peak-hour congestion",
        "route_case_id": "TC02",
        "event_edges": (
            ("node_6662487546", "node_14213870915"),
            ("node_14213870915", "node_14213870917"),
            ("node_14213870917", "node_5704382356"),
            ("node_5704382356", "node_14213870918"),
            ("node_14213870918", "node_14213870916"),
        ),
        "speed_kmh": 12.0,
    },
    "traffic_jam_tc03": {
        "id": "traffic_jam_tc03",
        "kind": "peak_congestion",
        "label": "TC03 - Traffic jam, 12 km/h",
        "description": "Simulated peak-hour congestion",
        "route_case_id": "TC03",
        "event_edges": (
            ("node_8333410690", "node_6579567129"),
            ("node_6579567129", "node_6579567128"),
            ("node_6579567128", "node_6579567127"),
            ("node_6579567127", "node_6579567125"),
            ("node_6579567125", "node_6668090146"),
        ),
        "speed_kmh": 12.0,
    },
}

ROAD_CLOSURE_CANDIDATES = {
    "TC01": (
        ("node_8121000996", "node_5716648788"),
        ("node_4592527911", "node_12783034931"),
        ("node_6688284314", "node_5703840200"),
        ("node_6661805155", "node_8259084423"),
        ("node_6408478722", "node_6661963558"),
    ),
    "TC02": (
        ("node_12597779320", "node_438042805"),
        ("node_6600251029", "node_6600251031"),
        ("node_6662487546", "node_14213870915"),
        ("node_14213870915", "node_14213870917"),
        ("node_14213870917", "node_5704382356"),
    ),
    "TC03": (
        ("node_6689475848", "node_103013298"),
        ("node_8333410690", "node_6579567129"),
        ("node_6579567129", "node_6579567128"),
        ("node_6579567128", "node_6579567127"),
        ("node_6689479752", "node_6689509687"),
    ),
}

for case_number in range(1, 4):
    case_id = f"TC{case_number:02d}"
    scenario_id = f"road_closure_tc{case_number:02d}"
    TRAFFIC_SCENARIOS[scenario_id] = {
        "id": scenario_id,
        "label": f"{case_id} - Random road closure",
        "description": "Two roads selected with a fixed random seed and closed in both directions",
        "route_case_id": case_id,
        "kind": "road_closure",
        "candidate_edges": ROAD_CLOSURE_CANDIDATES[case_id],
        "closed_road_count": 2,
        "random_seed": 7200 + case_number,
    }


# N1's supplied coordinates are preserved. IDs are scenario IDs, not graph nodes.
# Obstacles and expected metrics are reference material, not routing inputs.
TEST_CASES = {
    "cases": [
        {
            "case_id": case["case_id"],
            "description": f"Emergency to {case['hospital']['name']}",
            "source_description": case["description"],
            "hospital": {
                **case["hospital"],
                "id": str(case["hospital"]["id"]),
                "verified": False,
                "verification_status": "N1 reported verified; supporting source pending",
            },
            "emergency_target": {
                **case["emergency_target"],
                "id": str(case["emergency_target"]["id"]),
            },
            "reference_metrics": {
                "distance_km": case["expected_metrics"]["min_distance_m"] / 1000,
                "estimated_time_sec": case["expected_metrics"]["estimated_time_s"],
                "validated": False,
            },
        }
        for case in SOURCE_TEST_CASES["cases"]
    ],
    "traffic_obstacles_applied": False,
    "traffic_note": "N1's sample obstacles are reference data; the UI traffic scenarios are applied separately.",
}
