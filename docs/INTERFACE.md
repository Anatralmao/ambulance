## 1. Mục đích

File này chỉ quy ước **kiểu dữ liệu và cấu trúc dữ liệu chung** giữa các thành viên trong nhóm.

Mục tiêu:
- Các module dùng cùng tên trường.
- Các thành viên thống nhất kiểu dữ liệu.
- Hạn chế lỗi khi ghép code.
- Không quy định cách cài đặt thuật toán, giao diện hay API chi tiết.

---

## 2. Quy ước chung

| Loại dữ liệu | Quy ước |
|---|---|
| ID | `string` |
| Tên | `string` |
| Mô tả | `string` |
| Số nguyên | `int` |
| Số thực | `float` |
| Đúng/Sai | `bool` |
| Danh sách | `list` |
| Đối tượng dữ liệu | `dict` |
| Không có giá trị | `null` / `None` |

### Đơn vị

- Khoảng cách: `km` → `float`
- Thời gian: `seconds` → `int` hoặc `float`
- Tọa độ: `float`
- Phần trăm tiến độ: `0–100` → `int` hoặc `float`

---

## 3. Node

Một điểm trên bản đồ.

```json
{
  "id": "node_001",
  "lat": 21.0285,
  "lng": 105.8542
}
```

| Trường | Kiểu dữ liệu | Ý nghĩa |
|---|---|---|
| `id` | `string` | ID của node |
| `lat` | `float` | Vĩ độ |
| `lng` | `float` | Kinh độ |

---

## 4. Road

Một đoạn đường nối hai node.

```json
{
  "id": "road_001",
  "from": "node_001",
  "to": "node_002",
  "distance_km": 1.2,
  "bidirectional": true
}
```

| Trường | Kiểu dữ liệu | Ý nghĩa |
|---|---|---|
| `id` | `string` | ID của đường |
| `from` | `string` | ID node bắt đầu |
| `to` | `string` | ID node kết thúc |
| `distance_km` | `float` | Độ dài đường |
| `bidirectional` | `bool` | Đường hai chiều hay không |

---

## 5. Hospital

Một bệnh viện trên bản đồ.

```json
{
  "id": "hospital_001",
  "name": "Central Hospital",
  "node_id": "node_025",
  "lat": 21.0301,
  "lng": 105.8501
}
```

| Trường | Kiểu dữ liệu | Ý nghĩa |
|---|---|---|
| `id` | `string` | ID bệnh viện |
| `name` | `string` | Tên bệnh viện |
| `node_id` | `string` | Node tương ứng |
| `lat` | `float` | Vĩ độ |
| `lng` | `float` | Kinh độ |

---

## 6. Test Case

Một tình huống chạy thử.

```json
{
  "id": "case_001",
  "name": "Downtown Emergency",
  "map_id": "map_01",
  "start_node": "node_001",
  "destination_hospital": "hospital_001"
}
```

| Trường | Kiểu dữ liệu | Ý nghĩa |
|---|---|---|
| `id` | `string` | ID test case |
| `name` | `string` | Tên test case |
| `map_id` | `string` | ID bản đồ |
| `start_node` | `string` | ID node xuất phát |
| `destination_hospital` | `string` | ID bệnh viện đích |

Nếu cần thêm mô tả:

```json
{
  "description": "Emergency from downtown to hospital"
}
```

`description` có kiểu `string`.

---

## 7. Map

Dữ liệu của một bản đồ.

```json
{
  "id": "map_01",
  "name": "Hanoi Map",
  "nodes": [],
  "roads": [],
  "hospitals": []
}
```

| Trường | Kiểu dữ liệu |
|---|---|
| `id` | `string` |
| `name` | `string` |
| `nodes` | `list[Node]` |
| `roads` | `list[Road]` |
| `hospitals` | `list[Hospital]` |

---

## 8. Route Result

Kết quả tìm đường.

### Khi tìm được đường

```json
{
  "success": true,
  "path": [
    "node_001",
    "node_004",
    "node_009",
    "node_025"
  ],
  "distance_km": 8.42,
  "estimated_time_sec": 302,
  "error": null
}
```

| Trường | Kiểu dữ liệu |
|---|---|
| `success` | `bool` |
| `path` | `list[string]` |
| `distance_km` | `float` |
| `estimated_time_sec` | `int` hoặc `float` |
| `error` | `string` hoặc `null` |

### Khi không tìm được đường

```json
{
  "success": false,
  "path": [],
  "distance_km": null,
  "estimated_time_sec": null,
  "error": "No route available"
}
```

---

## 9. Trạng thái mô phỏng

Nếu module mô phỏng cần truyền trạng thái cho module khác, dùng cấu trúc:

```json
{
  "status": "moving",
  "progress": 62,
  "current_node": "node_009"
}
```

| Trường | Kiểu dữ liệu |
|---|---|
| `status` | `string` |
| `progress` | `int` hoặc `float` |
| `current_node` | `string` |

Các giá trị `status` thống nhất:

```text
"idle"
"moving"
"paused"
"arrived"
"error"
```

---

## 10. Danh sách ID

Khi truyền nhiều ID:

```json
{
  "path": [
    "node_001",
    "node_004",
    "node_009"
  ]
}
```

Kiểu dữ liệu:

```text
list[string]
```

Không dùng số nguyên cho ID.

Ví dụ:

```text
ĐÚNG:   "node_001"
SAI:    1
```

---

## 11. Quy tắc khi thêm dữ liệu

Nếu thành viên muốn thêm một trường mới:

1. Giữ nguyên tên các trường đã thống nhất.
2. Chỉ thêm trường khi thực sự cần.
3. Ghi rõ kiểu dữ liệu của trường mới.
4. Nếu thay đổi kiểu dữ liệu của trường cũ, báo cho các thành viên khác.

**File này chỉ là quy ước dữ liệu chung.**
Các phần như thuật toán, API endpoint, giao diện, animation hoặc cách tổ chức code sẽ do từng module tự triển khai.
