# N4 buổi 2 — Giao diện tình huống giao thông và mục tiêu tối ưu

Người thực hiện: Đức (N4). Nguồn yêu cầu: sheet `Buoi 02`, vai trò N4.
Trạng thái: **phần giao diện xong, chờ API của N2/N3 để ghép**. Hiện chạy được bằng dữ liệu giả.

## Đã làm

- Thêm 2 lựa chọn trên bảng điều khiển: **Traffic scenario** (Free flow / Main road jam /
  Multiple jams) và **Optimize for** (Shortest distance / Fastest time). Đổi một trong hai thì tuyến cũ,
  animation cũ và bảng kết quả bị xóa, giống thuật toán và tốc độ (không để kết quả cũ gây nhầm).
- Mỗi lần **Find route** gọi `/api/route` hai lần, `objective=distance` và `objective=time`,
  cùng tình huống. Tuyến của mục tiêu đang chọn là tuyến xe chạy; tuyến còn lại vẽ nét đứt.
- **Tô màu từng đoạn** theo tốc độ đoạn so với tốc độ xe giả định: xanh ≥ 75%, vàng 40–75%,
  đỏ < 40%. Đoạn liền nhau cùng màu được gộp để vẽ nhẹ. Có chú giải màu trên bản đồ.
- **Xe chạy theo `segment_durations_sec`** (code Buổi 1 đã đúng, giữ nguyên): đoạn tắc có thời lượng
  lớn hơn nên xe tự chậm lại. Dưới đồng hồ mô phỏng hiện đoạn hiện tại, tốc độ và trạng thái.
- **Bảng so sánh** 2 dòng (km, ETA, thuật toán, số đoạn tắc/chậm) và một câu kết luận, ví dụ
  "The fastest route is 0.48 km longer but arrives 5 min 8 s earlier".
- **Ghi rõ đầu vào** của kết quả: tình huống, mục tiêu, snapshot, nguồn (API / MOCK DATA /
  API no traffic data). Lịch sử phiên lưu thêm tình huống và mục tiêu.
- Tương thích ngược: nếu API chưa trả các trường mới, giao diện tự suy tốc độ đoạn từ
  km và giây, mọi đoạn hiện màu xanh và ghi "no traffic data — fixed speed". API Buổi 1 bỏ qua
  `scenario_id`/`objective` nên gửi thêm không gây lỗi.

- Sửa thêm 2 lỗi giao diện: (1) khi xe đến nơi, dòng đoạn hiện "segment n/n · arrived"
  (trước đây có thể dừng ở đoạn giữa vì các đoạn cuối rất ngắn bị vượt trong một khung hình);
  (2) bỏ `min-height: 812px` của `.app-shell` trên desktop, nên nút **Find route** không bị
  khuất khi cửa sổ thấp (laptop có phóng to màn hình). Lỗi (2) có từ trước Buổi 2.
- Nút **−/+** trên thanh tiêu đề của bảng *Route planner* và *Computed route*: thu gọn bảng chỉ còn
  tiêu đề để xem toàn tuyến và xe chạy, bấm lại để mở. Thu gọn không dừng mô phỏng. Hai bảng vẫn kéo được bằng tiêu đề như cũ.

File: [static/JS/traffic.js](../static/JS/traffic.js) (mới: danh sách tình huống, màu,
chuẩn hóa response, dữ liệu giả), [static/JS/app.js](../static/JS/app.js),
[templates/index.html](../templates/index.html), [static/CSS/app.css](../static/CSS/app.css),
[tests/js/traffic.test.mjs](../tests/js/traffic.test.mjs).

## Bản ghép buổi 2 (nhánh `buoi2-integration`, 07/11)

Gộp backend của Giang (6 kịch bản, closure seed, Overpass có fallback) và Chóc (`objective`)
với giao diện N4, trên nền bản sửa mới nhất của nhánh test (commit "wh"). Giao diện **theo contract
backend trong [INTERFACE.md](INTERFACE.md)**; đề xuất contract cũ bên dưới không còn dùng.

- Ô **Traffic event**: No event / Peak-hour (12 km/h) / Road closure. Ghép với TC đang chọn thành
  `traffic_scenario_id` (`traffic_jam_tc01`, `road_closure_tc02`...). Ô **Optimize for** gửi `objective`.
- Mỗi lần Find route gọi `/api/route` với `objective=distance` và `time`; có sự kiện thì gọi thêm
  bản không sự kiện (baseline). Bảng 2 dòng + câu so sánh mục tiêu + dòng so sánh có/không sự kiện.
- Màu đoạn lấy từ `segment_speeds_kmh` (12/40 km/h = đỏ). Tuyến còn lại vẽ nét đứt **cùng màu**,
  nên đoạn tắc mà tuyến nhanh nhất né vẫn thấy trên bản đồ.
- Bảng kết quả kéo được trở lại (mặc định góc dưới phải); tính kéo đúng với `--ui-scale`.
- `?mock=1` dùng cùng 3 sự kiện (đường thẳng, tốc độ giả).

Kiểm tra trên bản đồ Hà Nội thật: `RUN_DATASET_TESTS=1` 3/3 pass; trình duyệt 3 TC × 3 sự kiện.
Giờ cao điểm: tuyến nhanh nhất dài hơn nhưng nhanh hơn ở cả 3 TC (TC01 +0.07 km / −22.9 s,
TC02 +0.04 km / −25.3 s, TC03 +0.01 km / −35.0 s). Đóng đường: đi vòng, +36 s đến +1 min 16 s.

Còn mở: cạnh song song vẫn bị gộp trong `routing.py` (B02-04, N3); quyết định nguồn bản đồ
(Overpass hay `hanoi_map.json`).

## Quy ước đặt tên đã theo

Theo mục "Quy ước" của [INTERFACE.md](INTERFACE.md) và các trường có sẵn trong API:

- Tên trường `snake_case`; trường có đơn vị mang đuôi đơn vị (`_km`, `_sec`, `_kmh`),
  nên tốc độ đoạn là `segment_speeds_kmh`, đi cặp với `segment_distances_km`, `segment_durations_sec`.
- ID là `string`; mảng đoạn thứ i ứng với `coordinates[i]` → `coordinates[i+1]`.
- `scenario_id` và `objective` (`distance`/`time`) lấy đúng tên trong sheet `Buoi 02` (việc của N2).
- Chữ trên giao diện và chú thích code bằng tiếng Anh như phần có sẵn; tài liệu `docs/` bằng tiếng Việt.

**Lưu ý phân biệt:** `scenario_id` là **tình huống giao thông** (thông thoáng, tắc…);
`case_id` (TC01–TC03) là **kịch bản điểm cấp cứu → bệnh viện** như Buổi 1. Hai ID độc lập:
một `case_id` chạy được với mọi `scenario_id`. Đề nghị N2 ghi câu này vào INTERFACE.md khi cập nhật contract.

## Đề xuất contract — CẦN N1/N2 CHỐT

Request `POST /api/route` thêm:

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `scenario_id` | string | `free_flow`, `main_road_jam`, `multi_jam` — **N1 xác nhận ID**; khác `case_id` |
| `objective` | `"distance"` \| `"time"` | Tối ưu khoảng cách hay thời gian |

Response thêm (mảng đoạn dài `len(coordinates)-1`, cùng chỉ số với `segment_durations_sec`):

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `scenario_id`, `objective` | như request | Để giao diện hiển thị đúng đầu vào của kết quả |
| `snapshot_id` | string | Snapshot tốc độ N1 đã dùng |
| `segment_ids` | list[string] | ID cạnh có hướng. Định dạng do N2/N3 chốt (dữ liệu N1 Buổi 1 đang ghi cạnh bằng cặp node `[from, to]`) |
| `segment_speeds_kmh` | list[float] | Tốc độ từng đoạn sau khi áp tình huống |
| `segment_status` | list[`"free"`\|`"slow"`\|`"jam"`] | Không bắt buộc; thiếu thì giao diện tự suy từ tốc độ |

Câu hỏi mở cho N2: (1) đoạn đóng có bị loại khỏi graph không (giao diện giả định có, nên
không vẽ đoạn đóng); (2) API trả từng mục tiêu riêng (giao diện đang gọi 2 lần) hay trả cả hai
trong một response; (3) ngưỡng xanh/vàng/đỏ có cần thống nhất với N3 không.

Nếu contract chốt khác đề xuất: sửa `SCENARIOS` / `OBJECTIVES` và `normalize()` trong `traffic.js`,
không cần sửa `app.js`.

## Cách chạy và kiểm tra

- Dữ liệu giả, không cần bản đồ: chạy server rồi mở `http://localhost:8000/?mock=1`.
  Dữ liệu giả là đường thẳng/đường vòng, không phải đường phố thật; giao diện có nhãn MOCK DATA.
- API thật: mở `http://localhost:8000/` như cũ.
- Test giao diện: `node --test tests/js/traffic.test.mjs` (11 test). Test Python không đổi:
  `python -m unittest discover -s tests -v`.

## Checklist B02-06 (N4) — cách tự kiểm

Đo thời gian mô phỏng trên đoạn chậm/nhanh; tổng khớp ETA; màu và chú giải rõ.

1. Chọn TC01, *Main road jam*, *Shortest distance*, Playback 1×, Find route.
2. Quan sát dòng "segment i/n · v km/h": ở đoạn đỏ, tốc độ thấp và xe đi chậm thấy rõ.
3. Để xe chạy hết: đồng hồ mô phỏng dừng đúng bằng ETA trong bảng.
4. Chụp màn hình bản đồ + bảng kết quả, dán link vào cột "Link bằng chứng"; N3 đối chiếu thời gian.

Đã thử ở chế độ giả (TC01, Main road jam): tuyến ngắn nhất 1.99 km / 8 min 50 s, 4 đoạn tắc;
tuyến nhanh nhất 2.47 km / 3 min 42 s. Pause giữ nguyên đồng hồ; đổi tình huống xóa kết quả cũ;
tình huống thông thoáng báo hai mục tiêu cùng tuyến. Chưa thử với API thật (chưa có).
