# N2 buổi 1 — kiểm tra tích hợp ngày 29/10/2026

## Các điểm đã thống nhất và sửa

- [API](../src/api/routes.py) nhận `speed_kmh` hữu hạn > 0, mặc định 40;
  truyền xuống routing N3 và trả response có schema OpenAPI.
- [main.py](../main.py) trả lỗi validation 422 có vị trí trường và thông báo;
  không gặp lỗi serialize khi client gửi NaN/Infinity.
- Dữ liệu N1 chuyển từ module test sang [src/scenarios.py](../src/scenarios.py).
  Giữ tọa độ, lưu nguyên dữ liệu gốc, chuẩn hóa ID thành string.
  Chỉ số mẫu đổi từ mét sang km, từ `estimated_time_s` sang `estimated_time_sec`,
  đặt trong `reference_metrics` với `validated=false`, không dùng làm kết quả routing.
- Không gọi TC02/TC03 là demo tránh vật cản đang hoạt động: các cạnh mẫu chưa được áp dụng.
  API công bố `traffic_obstacles_applied=false`. Hướng cạnh của graph vẫn được giữ.
- [Giao diện](../static/JS/app.js) dùng ETA/thời lượng từng đoạn từ N3,
  bổ sung tốc độ xe, pause/resume, đồng hồ và hệ số phát; giữ hình nhân vật N4.
  Không tính lại độ dài polyline để quyết định thời gian chạy 3–6,5 giây như trước.
- Kết quả và lịch sử dùng thuật toán từ response. Đổi lựa chọn, kéo điểm, reset
  không để response cũ ghi đè; đổi sang Custom cũng xóa tuyến cũ.
  Bỏ bản kịch bản hardcode dự phòng để API là nguồn dữ liệu duy nhất.
- Sửa lớp hiển thị để bảng kết quả/nút Pause không bị panel chọn tuyến che trên màn hình hẹp.
- Contract request/response, đơn vị và lỗi: [INTERFACE.md](INTERFACE.md).

## Kiểm chứng

```powershell
python -m pip install -r requirements-dev.txt
python -B -m unittest discover -s tests -v
$env:RUN_DATASET_TESTS='1'
python -B -m unittest discover -s tests -v
node --check static/JS/app.js
```

Bộ mặc định gồm 19 test fixture/API và một test dataset tùy chọn.
Đã bật `RUN_DATASET_TESTS=1`: **20/20 test đạt**. Kiểm tra cú pháp JavaScript
và `git diff --check` đều đạt.
Test API đi qua HTTP TestClient, kiểm tra tốc độ mặc định/tùy chỉnh, miền tọa độ,
thuật toán, NaN/Infinity, ETA tràn số, cùng node, 404, trạng thái tải/lỗi 503,
kịch bản và phục vụ asset. Test dataset chạy ba kịch bản qua API bằng cả A*/Dijkstra.

Kết quả graph Hà Nội ở 40 km/h (hai thuật toán cho cùng chi phí):

| Kịch bản | Khoảng cách km | ETA giây | Snap đầu m | Snap đích m |
|---|---:|---:|---:|---:|
| TC01 | 2.438880 | 219.49920 | 97.60 | 10.97 |
| TC02 | 2.158727 | 194.28543 | 15.83 | 24.01 |
| TC03 | 2.527619 | 227.48571 | 385.49 | 5.88 |

Đã thử trên trình duyệt với server thật:

- TC01: pause giữ đồng hồ 3.3 s trong lúc chờ, resume tăng lên 6.5 s, reset 0.0 s.
- Replay TC01 ở 60× kết thúc tại 219.5 s mô phỏng, khớp ETA hiển thị.
- TC02 dùng Dijkstra ở 80 km/h: 2.16 km, ETA 97.1 s.
- Trì hoãn response route rồi đổi sang Custom: kết quả vẫn ẩn, đồng hồ 0,
  replay bị vô hiệu hóa, nút tìm đường hoạt động.
- Mock response cùng node: tới đích ngay ở 0.0 s; mock HTTP 404: hiện lỗi,
  không hiện tuyến hay cho replay. Hai tình huống này cũng có test backend thật trên fixture.

## Giới hạn còn lại

N1 đánh dấu bệnh viện verified nhưng chưa kèm nguồn xác minh; bản tích hợp giữ tọa độ
và công bố trạng thái chưa xác minh thay vì coi đó là bằng chứng. Chưa xác nhận cổng
tiếp nhận cấp cứu/khả năng xe tiếp cận. TC03 snap đầu khoảng 385 m cần N1 xem lại.
Không cộng thời gian phần snap vào ETA. Vật cản mẫu và giao thông thực tế chưa áp dụng
trong phạm vi buổi 1. Chưa có review chéo hoặc xác nhận nghiệm thu từ các thành viên.
