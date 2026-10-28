# Ghi chú lịch sử N3 — trước tích hợp N2

Trạng thái tích hợp mới nhất: [N2 buổi 1](n2buoi1.md). Contract đang chạy: [INTERFACE.md](INTERFACE.md).

# Bàn giao N3 — Buổi 1

Nguồn yêu cầu: sheet `Buoi 01`, vai trò N3 trong bảng phân công
`this is so nerdy _D.xlsx`. Phạm vi: giữ A*/Dijkstra theo khoảng cách,
tính thời lượng từng đoạn và tổng ETA ở tốc độ cố định, kiểm thử hồi quy.

## Contract triển khai để N2/N4 tích hợp

[RoadNetwork.route](../src/routing.py) nhận
`route(start, goal, algorithm, speed_kmh=40.0)`.
40 km/h là giả định mặc định của triển khai N3, cần nhóm xác nhận khi tích hợp;
không phải tốc độ đo thực tế. Tốc độ truyền vào phải hữu hạn và lớn hơn 0.
Giá trị không hợp lệ hoặc làm ETA tràn số gây `ValueError`.

Các trường cũ `coordinates`, `distance_km`, `start`, `goal`, `algorithm`
được giữ nguyên. Các trường bổ sung:

| Trường | Kiểu/đơn vị | Ý nghĩa |
|---|---|---|
| `speed_kmh` | float, km/h | Tốc độ cố định dùng tính ETA |
| `segment_distances_km` | list[float], km | Độ dài cạnh đồ thị trên tuyến |
| `segment_durations_sec` | list[float], giây | Thời lượng tương ứng từng cạnh |
| `estimated_time_sec` | số, giây | Tổng thời lượng từng đoạn |

Đoạn thứ `i` nối `coordinates[i]` tới `coordinates[i + 1]`; tọa độ có thứ tự
`[lat, lng]`. Hai mảng đoạn có độ dài `len(coordinates) - 1`.
Mỗi thời lượng bằng `segment_distances_km[i] / speed_kmh * 3600`.
Không làm tròn từng đoạn. Tổng thời lượng bằng ETA; ETA khớp
`distance_km / speed_kmh * 3600` trong sai số số thực.

Khoảng cách giữ nguyên chi phí tuyến từ cạnh đồ thị, không tính lại bằng
khoảng cách thẳng giữa tọa độ. Cạnh song song vẫn chọn cạnh ngắn nhất;
đổi tốc độ không đổi trọng số tìm đường. Không tính thời gian từ vị trí
người dùng tới node được snap, thời gian chờ hay giao thông thực tế.

Ví dụ tuyến fixture có hai đoạn 0.1 km, tốc độ 40 km/h:

```json
{
  "coordinates": [[21.0, 105.0], [21.0, 105.001], [21.0, 105.002]],
  "distance_km": 0.2,
  "algorithm": "astar",
  "speed_kmh": 40.0,
  "segment_distances_km": [0.1, 0.1],
  "segment_durations_sec": [9.0, 9.0],
  "estimated_time_sec": 18.0
}
```

Ví dụ lược bỏ `start` và `goal` (hai điểm snap vẫn có trong kết quả thật).
Cùng node trả một tọa độ, hai mảng đoạn rỗng, khoảng cách và ETA bằng 0.
Không có đường có hướng trả `None`; hàm xử lý API hiện tại chuyển thành HTTP 404.

API hiện tại tự trả các trường mới ở tốc độ mặc định. N2 cần thêm trường
request tốc độ, validation và truyền `speed_kmh` vào routing nếu muốn cho
người dùng cấu hình. N4 dùng thời lượng từng đoạn để mô phỏng; hệ số phát
chỉ thay tốc độ đồng hồ mô phỏng, không sửa tốc độ xe hay ETA.

## Bằng chứng kiểm thử

Chạy ngày 28/10/2026 trên fixture nhỏ bằng:

```sh
python -B -m unittest discover -s tests -v
```

Kết quả: **13 tests, OK**, gồm 6 test cũ (mở rộng kiểm tra thời gian) và
7 test mới trong [test_routing.py](../tests/test_routing.py).
Kiểm tra cả A* và Dijkstra: cạnh song song, chiều đường, cùng node,
hai thành phần rời nhau, cạnh 0 km, snap, cache, ETA từ độ dài cạnh,
đổi tốc độ giữ nguyên tuyến, tốc độ không hợp lệ và tràn ETA.
Hai test gọi trực tiếp hàm xử lý API kiểm tra trả ETA và HTTPException 404;
đây không phải kiểm thử HTTP qua mạng hoặc E2E giao diện.

- B01-03: đạt trên fixture, giữ baseline khoảng cách và công thức ETA.
- B01-06: đạt trên fixture, cùng node 0 giây và không phát tuyến giả.
- B01-07: phần regression đạt; demo UI–API chung chờ tích hợp N2/N4.
- Review chéo N1/N2 và kiểm tra ba kịch bản thật chưa được thực hiện.

Chưa có kịch bản tọa độ/bệnh viện xác minh của N1 trong API hiện tại,
nên không khẳng định đã kiểm tra đường của ba kịch bản đó.
