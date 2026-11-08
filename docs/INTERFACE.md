# Contract tích hợp buổi 1 — N1/N2/N3/N4

Contract này mô tả API đang chạy; OpenAPI tự sinh tại `/docs` và `/openapi.json`.
Các module thuật toán nghiên cứu độc lập chưa được tích hợp vào API này.

## Quy ước

- ID bệnh viện, điểm kịch bản và node: `string`. ID kịch bản không phải ID node đồ thị.
- Tọa độ mảng: `[lat, lng]`; tọa độ request: `{"lat": ..., "lng": ...}`.
- Vĩ độ trong [-90, 90], kinh độ trong [-180, 180].
- Khoảng cách tuyến/cạnh: km; thời lượng/ETA: giây; tốc độ xe: km/h.
- `distance_meters` của điểm snap là khoảng cách snap tính bằng mét (trường cũ).
- Một xe, một hành trình từ điểm cấp cứu tới bệnh viện chọn trước; không có dữ liệu
  giao thông trực tiếp hoặc dự đoán ML.

## GET /api/test-cases

Nguồn runtime: [src/scenarios.py](../src/scenarios.py), tiếp nhận dữ liệu N1.
Response là object `{"cases": [...], "traffic_obstacles_applied": false, "traffic_note": "..."}`.
Có ba trường hợp TC01–TC03. Ví dụ một phần tử:

```json
{
  "case_id": "TC01",
  "description": "Emergency to Bach Mai Hospital",
  "source_description": "Normal route",
  "hospital": {
    "id": "8502010001",
    "name": "Bach Mai Hospital",
    "coords": [21.0058, 105.8501],
    "verified": false,
    "verification_status": "N1 reported verified; supporting source pending"
  },
  "emergency_target": {"id": "8502010002", "coords": [21.0126, 105.8678]},
  "reference_metrics": {"distance_km": 1.85, "estimated_time_sec": 420.0, "validated": false}
}
```

N4 lấy `emergency_target.coords` làm start, `hospital.coords` làm goal.
`reference_metrics` chỉ là số liệu mẫu N1 đã chuyển về đơn vị chung, không phải
kết quả tìm đường, không dùng tính ETA hoặc tiêu chí pass/fail.
Tọa độ và dữ liệu gốc N1 được giữ trong `SOURCE_TEST_CASES`; chưa có nguồn xác minh
bệnh viện đính kèm nên API không khẳng định `verified=true`.
Graph đường được lấy từ Overpass API cho vùng bao quanh ba ca, lưu cache 24 giờ ở
`.cache/osm`. Nếu API không khả dụng, backend ghi log và dùng cache cũ hoặc graph OSM
đóng gói trong repo. Các mẫu obstacle/penalty/turn restriction N1 có ID không nằm
trong graph là dữ liệu tham khảo; các điều kiện được chọn trên UI (kẹt xe/đóng đường)
mới được áp vào các cạnh OSM tương ứng của TC.
Nếu tải kịch bản lỗi, UI báo lỗi và vẫn cho chọn điểm tùy chỉnh; không thay bằng dữ liệu cứng.

## POST /api/route

```json
{
  "start": {"lat": 21.0126, "lng": 105.8678},
  "goal": {"lat": 21.0058, "lng": 105.8501},
  "algorithm": "astar",
  "speed_kmh": 40,
  "traffic_scenario_id": "traffic_jam_tc01",
  "objective": "time"
}
```

`start`, `goal` bắt buộc. `algorithm` là `astar` (mặc định) hoặc `dijkstra`.
`speed_kmh` mặc định 40, phải hữu hạn và > 0; đây là tốc độ giả định nền.
`objective` có thể là `distance` hoặc `time`. Khi không gửi trường này, hành vi
tương thích cũ được giữ: không có scenario thì tối ưu khoảng cách, có scenario thì
tối ưu thời gian. `distance` tối thiểu hóa tổng chiều dài; `time` tối thiểu hóa tổng
thời lượng cạnh theo tốc độ của scenario, dùng `speed_kmh` trên cạnh không có tốc độ
riêng. Đường đóng bị loại khỏi graph với cả hai objective.

## GET /api/traffic-scenarios

Trả sáu kịch bản: tắc đường và đóng đường cho từng route bệnh viện:

| ID | Trạng thái |
|---|---|
| `traffic_jam_tc01` | TC01, 12 km/h trên 5 cạnh |
| `traffic_jam_tc02` | TC02, 12 km/h trên 5 cạnh |
| `traffic_jam_tc03` | TC03, 12 km/h trên 5 cạnh |
| `road_closure_tc01` | TC01, đóng ngẫu nhiên 2 trong 5 cạnh ứng viên |
| `road_closure_tc02` | TC02, đóng ngẫu nhiên 2 trong 5 cạnh ứng viên |
| `road_closure_tc03` | TC03, đóng ngẫu nhiên 2 trong 5 cạnh ứng viên |

Các tốc độ 12 km/h là giả định kiểm thử, không phải quan sát giao thông thật.
API trả `traffic_event_edges` và `traffic_event_speed_kmh` riêng vì bộ định tuyến
có thể chọn đường vòng và không đi qua cạnh bị tắc. `segment_speeds_kmh` vẫn mô tả
chính xác các cạnh trên route kết quả. Cạnh khác chưa có tốc độ trực tiếp nên dùng
tốc độ nền và có nguồn `no_live_data_assumed`. UI giữ test case bệnh viện và corridor
đồng bộ: chọn TC01–TC03 rồi chọn kẹt xe/đóng đường sẽ áp sự kiện cùng mã.
`road_closure` dùng seed cố định
riêng cho mỗi TC để chọn hai đường trong các ứng viên hiện diện trên graph; nếu graph
không có đủ hai ứng viên, API trả lỗi rõ ràng. Đóng cả chiều ngược nếu graph có cạnh
ngược. Closure bỏ qua `speed_kmh` của request và cố định mọi đường còn mở ở
40 km/h. Kẹt xe áp dụng trên các cạnh hành lang hiện diện trong graph.
`traffic_event_count`
là số đường vật lý được chọn; `traffic_event_edges` liệt kê các hướng thực sự bị chặn;
`traffic_event_seed` dùng để tái lập lựa chọn. Custom tắt overlay.

Response 200 (ví dụ trên fixture nhỏ, không phải kịch bản Hà Nội ở trên):

```json
{
  "coordinates": [[21, 105], [21, 105.001]],
  "segment_edges": [["a", "b"]],
  "segment_edge_ids": ["osm_way_123_segment_0"],
  "segment_edge_metadata": [{"way_id": 123, "segment_index": 0, "name": "Phố Huế",
                             "highway": "primary", "maxspeed": null, "oneway": false}],
  "distance_km": 0.2,
  "start": {"id": "a", "lat": 21, "lng": 105, "distance_meters": 0},
  "goal": {"id": "b", "lat": 21, "lng": 105.001, "distance_meters": 0},
  "algorithm": "astar",
  "objective": "distance",
  "speed_kmh": 40,
  "segment_distances_km": [0.2],
  "segment_speeds_kmh": [40],
  "segment_speed_sources": ["no_live_data_assumed"],
  "segment_durations_sec": [18],
  "estimated_time_sec": 18,
  "traffic_scenario_id": null,
  "traffic_event_type": null,
  "traffic_event_speed_kmh": null,
  "traffic_event_count": 0,
  "traffic_event_seed": null,
  "traffic_event_edges": [],
  "traffic_note": "No live segment speeds; 40 km/h is assumed on every road."
}
```

Đoạn thứ i nối `coordinates[i]` tới `coordinates[i+1]`. Các mảng `segment_*` có
độ dài `len(coordinates)-1`; khoảng cách lấy từ cạnh đồ thị, không đo lại từ polyline.
`segment_edges[i]` giữ cặp node có hướng `[from_node_id, to_node_id]` của đoạn tương ứng.
`segment_edge_ids[i]` là ID con đường thật đã chọn (`osm_way_<way>_segment_<i>` với bản đồ
Overpass; `road_<n>` nếu dữ liệu không có `id`), nên phân biệt được hai đường song song nối
cùng cặp node. `segment_edge_metadata[i]` là thông tin OSM của đường đó (`name`, `highway`,
`maxspeed`, `oneway`...; có thể rỗng). Cạnh song song: mục tiêu `distance` chọn đường ngắn
nhất, `time` chọn đường nhanh nhất giữa cùng cặp node.
Đường có `speed_kmh` riêng trong dữ liệu bản đồ dùng tốc độ đó cho cả hai mục tiêu; đường
không có dùng tốc độ giả định của request (`speed_kmh`), kể cả khi tìm đường theo thời gian.
`segment_durations_sec[i] = segment_distances_km[i] / segment_speeds_kmh[i] * 3600`.
`segment_speed_sources` là `simulated` hoặc `no_live_data_assumed`. Khi đóng đường,
các cạnh bị chặn không xuất hiện trong route; mọi cạnh còn lại tiếp tục dùng tốc độ
nền, mặc định 40 km/h.
Tổng thời lượng đoạn bằng ETA.
Không làm tròn ở backend. ETA không bao gồm đoạn nối từ tọa độ yêu cầu tới node snap.

Cùng node: một tọa độ, các mảng `segment_*` rỗng, khoảng cách/ETA bằng 0.
Không có đường: HTTP 404, `{"detail": "No directed road route connects these points"}`;
không tạo tuyến giả. Không dùng schema nghiên cứu `success/path/error` cho live API.

## Lỗi và trạng thái

- 422: thiếu trường, sai tọa độ/thuật toán/kịch bản, tốc độ không hợp lệ hoặc ETA tràn số.
  Lỗi validation có `detail: [{"loc": [...], "msg": "...", "type": "..."}]`;
  lỗi tính toán có `detail` dạng chuỗi. UI hỗ trợ cả hai.
- 503: graph đang tải hoặc tải lỗi; khi đang tải có header `Retry-After: 2`.
- `GET /api/network/status`: `{"status": "loading" | "ready" | "error"}`.
- `GET /api/nearest?lat=21&lng=105`: trả điểm snap cùng schema `start/goal`.
  Kiểm tra miền tọa độ, 503 khi graph chưa sẵn sàng.

## Mô phỏng N4

Tìm đường thành công tự bắt đầu chạy. Replay chạy lại từ đầu; Pause/Resume giữ
nguyên thời gian đã chạy; Reset đưa xe về đầu, đồng hồ 0. Cùng node đến đích ngay.
UI nội suy vị trí theo `segment_durations_sec`, hiển thị ETA/tốc độ và dùng
`algorithm` từ response. Playback 1×/10×/60× chỉ đổi tốc độ đồng hồ, không đổi ETA.
Đổi kịch bản, thuật toán, tốc độ xe hoặc kéo điểm sẽ hủy tuyến cũ và bỏ response cũ.
Chọn Custom cũng xóa trạng thái mô phỏng trước. Tra địa chỉ cũ không ghi đè kết quả mới.
