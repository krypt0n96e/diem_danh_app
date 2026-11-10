# 📚 TÀI LIỆU HỆ THỐNG: ỨNG DỤNG ĐIỂM DANH & QUẢN LÝ ĐIỂM THƯỞNG

Tài liệu này mô tả chi tiết kiến trúc Backend (Express.js chạy Serverless trên Vercel kết nối Turso Database) và Frontend (giao diện HTML/JS lưu trữ trên Neocities).

---

## 🛠️ I. KIẾN TRÚC BACKEND (API ENDPOINTS)

Backend được xây dựng bằng **Node.js + Express** và sử dụng **Turso (@libsql/client)** làm cơ sở dữ liệu SQLite trên mây.

### 1. Xác thực & Người dùng (Auth & Users)
* **`POST /api/login`**
  * **Mô tả:** Xử lý đăng nhập hệ thống.
  * **Payload:** `{ username, password }`
  * **Logic:** Kiểm tra thông tin user, tự động tính toán lại chuỗi điểm danh (`current_streak`) và trả về thông tin user (bao gồm role `admin` hoặc `user`).
* **`GET /api/admin/users`**
  * **Mô tả:** Lấy danh sách toàn bộ thành viên (Dành cho Admin).
  * **Logic:** Duyệt qua từng user, tính toán lại chuỗi điểm danh thời gian thực và trả về mảng danh sách.
* **`POST /api/admin/users`**
  * **Mô tả:** Tạo tài khoản thành viên mới (Dành cho Admin).
  * **Payload:** `{ username, password, name, role }`
* **`DELETE /api/admin/users/:id`**
  * **Mô tả:** Xóa tài khoản thành viên (Chặn xóa tài khoản Admin gốc có `id = 1`).
* **`GET /api/users/:user_id`**
  * **Mô tả:** Lấy thông tin chi tiết của một user theo ID.

### 2. Điểm danh & Chuỗi liên tục (Streak & Check-in)
* **`POST /api/streak/check-in`**
  * **Mô tả:** Thực hiện điểm danh hàng ngày của thành viên.
  * **Payload:** `{ user_id }`
  * **Logic:** Kiểm tra xem ngày hôm nay đã check-in chưa. Nếu chưa, tạo bản ghi `activity_logs`, tính lại chuỗi và tự động cộng điểm thưởng mốc đặc biệt (10 ngày = +50đ, 50 ngày = +300đ, 100 ngày = +1000đ).
* **`POST /api/streak/repair`**
  * **Mô tả:** Bù chuỗi điểm danh ngày hôm qua khi bị đứt chuỗi.
  * **Payload:** `{ user_id }`
  * **Logic:** Kiểm tra số dư điểm của user (yêu cầu tối thiểu 30 điểm). Trừ 30 điểm, ghi nhận vào nhật ký ngày hôm qua và cập nhật lại chuỗi liên tục.
* **`POST /api/admin/toggle-checkin`**
  * **Mô tả:** Admin chủ động đánh dấu thêm hoặc xóa lịch sử điểm danh của user trên Lịch.
  * **Payload:** `{ user_id, dateStr, action: 'add' | 'remove' }`

### 3. Nhật ký hoạt động & Phê duyệt điểm (Activity Logs)
* **`POST /api/activities`**
  * **Mô tả:** Thành viên gửi yêu cầu ghi nhận hoạt động cá nhân (trạng thái `pending`).
  * **Payload:** `{ user_id, activity_name, created_at }`
* **`GET /api/admin/pending-activities`**
  * **Mô tả:** Lấy danh sách các hoạt động đang chờ Admin duyệt.
* **`POST /api/activities/approve`**
  * **Mô tả:** Admin duyệt hoặc từ chối hoạt động. Nếu duyệt (`approved`), tự động cộng điểm cho user.
  * **Payload:** `{ log_id, status: 'approved' | 'rejected', points }`
* **`GET /api/logs/:user_id`**
  * **Mô tả:** Lấy lịch sử nhật ký hoạt động của một user cụ thể.
* **`POST /api/admin/adjust-points`**
  * **Mô tả:** Admin cộng hoặc trừ điểm trực tiếp cho user kèm theo lý do/mô tả.
  * **Payload:** `{ user_id, points, reason: 'cong' | 'tru', description }`

### 4. Phần thưởng & Đổi quà (Rewards & Inventory)
* **`GET /api/rewards`**
  * **Mô tả:** Lấy danh sách tất cả phần thưởng có trong hệ thống.
* **`POST /api/rewards/propose`**
  * **Mô tả:** Thành viên đề xuất phần thưởng mới.
  * **Payload:** `{ title, points_required, suggested_by }`
* **`POST /api/rewards/approve`**
  * **Mô tả:** Admin phê duyệt phần thưởng để hiển thị cho phép đổi quà.
* **`POST /api/rewards/update-points`**
  * **Mô tả:** Admin chỉnh sửa số điểm yêu cầu cho một phần thưởng.
* **`DELETE /api/rewards/:id`**
  * **Mô tả:** Xóa phần thưởng khỏi hệ thống.
* **`POST /api/rewards/request`**
  * **Mô tả:** Thành viên thực hiện yêu cầu đổi quà bằng điểm tích lũy.
  * **Payload:** `{ user_id, reward_id }`
  * **Logic:** Kiểm tra số điểm hiện tại của user có đủ không. Nếu đủ, trừ điểm user và tạo yêu cầu đổi quà (`pending`).
* **`GET /api/admin/reward-requests`**
  * **Mô tả:** Lấy danh sách các yêu cầu đổi quà đang chờ Admin xử lý.
* **`POST /api/admin/reward-requests/process`**
  * **Mô tả:** Admin duyệt hoặc từ chối yêu cầu đổi quà.
  * **Payload:** `{ request_id, action: 'approve' | 'reject' }`
  * **Logic:** Nếu duyệt, ghi vào nhật ký tiêu điểm. Nếu từ chối, hoàn lại điểm cho thành viên.
* **`GET /api/inventory/:user_id`**
  * **Mô tả:** Lấy túi quà (Inventory) chứa các phần thưởng user đã đổi thành công (nhóm theo tên phần thưởng và đếm số lượng).

---

## 🖥️ II. TÍNH NĂNG & LOGIC FRONTEND

Giao diện Frontend được thiết kế tối ưu chạy trên **Neocities** (hoặc Web thuần), tương tác hoàn toàn bất đồng bộ với Backend qua Fetch API.

### 1. Phân quyền giao diện (Role-based Views)
* **Màn hình Đăng nhập (Login View):** Nhập tài khoản và mật khẩu. Lưu trạng thái đăng nhập (`localStorage`) để duy trì phiên làm việc.
* **Giao diện Thành viên (User Dashboard):**
  * **Widget Điểm & Chuỗi:** Hiển thị tổng số điểm hiện có và số ngày điểm danh liên tục (Streak).
  * **Nút Check-in Nhanh:** Thực hiện điểm danh trong ngày. Hiệu ứng thông báo nhận thưởng mốc 10, 50, 100 ngày.
  * **Tính năng Bù Chuỗi:** Cho phép dùng 30 điểm để mua lại chuỗi điểm danh của ngày hôm qua nếu quên.
  * **Lịch sử & Nhật ký:** Xem lại danh sách các hoạt động đã tham gia và trạng thái chờ duyệt/đã duyệt.
  * **Túi Quà (Inventory):** Kho lưu trữ các phần thưởng đã đổi thành công.
* **Giao diện Quản trị viên (Admin Dashboard):**
  * **Quản lý Thành viên:** Thêm tài khoản mới, xóa tài khoản, xem thống kê điểm số và chuỗi của toàn bộ thành viên.
  * **Phê duyệt Hoạt động:** Duyệt hoặc từ chối các hoạt động thành viên gửi lên để cấp điểm.
  * **Cộng/Trừ điểm nhanh:** Bảng điều khiển thao tác điểm trực tiếp cho từng user.
  * **Quản lý & Duyệt phần thưởng:** Tạo phần thưởng mới, chỉnh sửa điểm yêu cầu, duyệt quà do user đề xuất và xử lý yêu cầu đổi quà.
  * **Sửa đổi điểm danh trên Lịch:** Thêm hoặc xóa điểm danh của bất kỳ ngày nào cho thành viên.

---

## ⚙️ III. CẤU HÌNH TRIỂN KHAI (DEPLOYMENT)
* **Backend:** Triển khai trên **Vercel** (Serverless Function tại `api/index.js`), kết nối trực tiếp cơ sở dữ liệu đám mây **Turso (LibSQL)** thông qua các biến môi trường `TURSO_DATABASE_URL` và `TURSO_AUTH_TOKEN`.
* **Frontend:** Tải file giao diện lên **Neocities**, cấu hình hằng số `API_URL` trỏ trực tiếp đến domain Vercel Backend (`https://diemdanhapp.vercel.app/api`).
