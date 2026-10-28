# Contract tích hợp buổi 1 — N1/N2/N3/N4

Contract này mô tả API đang chạy; OpenAPI tự sinh tại `/docs` và `/openapi.json`.
Các module thuật toán nghiên cứu độc lập chưa được tích hợp vào API này.

## Quy ước

- ID bệnh viện, điểm kịch bản và node: `string`. ID kịch bản không phải ID node đồ thị.
- Tọa độ mảng: `[lat, lng]`; tọa độ request: `{"lat": ..., "lng": ...}`.
- Vĩ độ trong [-90, 90], kinh độ trong [-180, 180].
- Khoảng cách tuyến/cạnh: km; thời lượng/ETA: giây; tốc độ xe: km/h.
- `distance_meters` của điểm snap là khoảng cách snap tính bằng mét (trường cũ).
- Một xe, một hành trình từ điểm cấp cứu tới bệnh viện chọn trước; tốc độ cố định,
  chưa có dữ liệu giao thông động, ML hoặc tái định tuyến.

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
Các vật cản/penalty/turn restriction mẫu chưa áp dụng. Hướng đường thật lấy từ graph.
Nếu tải kịch bản lỗi, UI báo lỗi và vẫn cho chọn điểm tùy chỉnh; không thay bằng dữ liệu cứng.

## POST /api/route

```json
{
  "start": {"lat": 21.0126, "lng": 105.8678},
  "goal": {"lat": 21.0058, "lng": 105.8501},
  "algorithm": "astar",
  "speed_kmh": 40
}
```

`start`, `goal` bắt buộc. `algorithm` là `astar` (mặc định) hoặc `dijkstra`.
`speed_kmh` mặc định 40, phải hữu hạn và > 0; đây là giả định mô phỏng.
Hai thuật toán tiếp tục tối ưu khoảng cách. Tốc độ không thay đổi đường đi.

Response 200 (ví dụ trên fixture nhỏ, không phải kịch bản Hà Nội ở trên):

```json
{
  "coordinates": [[21, 105], [21, 105.001]],
  "distance_km": 0.2,
  "start": {"id": "a", "lat": 21, "lng": 105, "distance_meters": 0},
  "goal": {"id": "b", "lat": 21, "lng": 105.001, "distance_meters": 0},
  "algorithm": "astar",
  "speed_kmh": 40,
  "segment_distances_km": [0.2],
  "segment_durations_sec": [18],
  "estimated_time_sec": 18
}
```

Đoạn thứ i nối `coordinates[i]` tới `coordinates[i+1]`. Hai mảng đoạn có độ dài
`len(coordinates)-1`; khoảng cách lấy từ cạnh đồ thị, không đo lại từ polyline.
`segment_durations_sec[i] = segment_distances_km[i] / speed_kmh * 3600`.
Tổng thời lượng đoạn bằng ETA; so với `distance_km / speed_kmh * 3600` trong sai số số thực.
Không làm tròn ở backend. ETA không bao gồm đoạn nối từ tọa độ yêu cầu tới node snap.

Cùng node: một tọa độ, hai mảng rỗng, khoảng cách/ETA bằng 0.
Không có đường: HTTP 404, `{"detail": "No directed road route connects these points"}`;
không tạo tuyến giả. Không dùng schema nghiên cứu `success/path/error` cho live API.

## Lỗi và trạng thái

- 422: thiếu trường, sai tọa độ/thuật toán, tốc độ không hợp lệ hoặc ETA tràn số.
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
