TÀI LIỆU MÔ TẢ FRONTEND VÀ BACKEND APITài liệu này tổng hợp toàn bộ cấu trúc hệ thống, danh sách các API RESTful của Backend (Node.js/Express) và giao diện người dùng Frontend (React / Web Native).🛠️ 1. QUY TRÌNH HỆ THỐNG & ĐỊA CHỈ API (BASE URL)Backend Base URL (Local): http://localhost:3000/apiBackend Base URL (Cloud / Vercel): https://<ten-app-backend>.vercel.app/apiCơ chế xác thực: Phiên làm việc duy trì qua Cookie hoặc Local state (Trả về thông tin User bao gồm id, role, points, current_streak).💾 2. CẤU TRÚC CƠ SỞ DỮ LIỆU (SQLITE)Bảng users (Tài khoản)TrườngKiểu dữ liệuMô tảidINTEGER (PK)Khóa chính tự tăngusernameTEXT (UNIQUE)Tên đăng nhậppasswordTEXTMật khẩu tài khoảnnameTEXTHọ và tên hiển thịroleTEXTQuyền truy cập (adminpointsINTEGERĐiểm tích lũy hiện tại (Mặc định: 0)current_streakINTEGERChuỗi ngày điểm danh liên tụclast_activity_dateTEXTNgày hoạt động gần nhất (YYYY-MM-DD)Bảng activity_logs (Nhật ký hoạt động & Điểm danh)TrườngKiểu dữ liệuMô tảidINTEGER (PK)Khóa chínhuser_idINTEGER (FK)Mã ID người dùngactivity_nameTEXTTên hoạt động (VD: "Đọc sách", "Check-in chuỗi")statusTEXTTrạng thái (pendingpoints_awardedINTEGERĐiểm cộng/trừ từ hoạt độngcreated_atTEXTNgày tạo bản ghi (YYYY-MM-DD)Bảng rewards (Danh mục Phần thưởng)TrườngKiểu dữ liệuMô tảidINTEGER (PK)Khóa chínhtitleTEXTTên quà / phần thưởngpoints_requiredINTEGERSố điểm cần để đổistatusTEXTTrạng thái duyệt target (proposedsuggested_byINTEGER (FK)ID người dùng đề xuấtBảng reward_requests (Yêu cầu đổi phần thưởng)TrườngKiểu dữ liệuMô tảidINTEGER (PK)Khóa chínhuser_idINTEGER (FK)ID người dùng gửi yêu cầu đổireward_idINTEGER (FK)ID phần thưởng chọn đổireward_titleTEXTTên phần thưởngpoints_requiredINTEGERĐiểm đã khấu trừstatusTEXTTrạng thái xử lý (pendingcreated_atTEXTNgày đổi quà (YYYY-MM-DD)📡 3. DANH SÁCH CHI TIẾT CÁC API BACKEND🔓 3.1. Xác thực & Thông tin User1. Đăng nhậpEndpoint: POST /api/loginBody Request:{
  "username": "user1",
  "password": "123"
}

Response Success (200):{
  "id": 2,
  "username": "user1",
  "name": "Nguyen Van A",
  "role": "user",
  "points": 150,
  "current_streak": 5
}

2. Lấy thông tin User theo IDEndpoint: GET /api/users/:user_idResponse Success (200): Trả về đối tượng user đã được tự động cập nhật số chuỗi (current_streak).🔥 3.2. Điểm danh & Chuỗi (Streak)1. Check-in điểm danh hàng ngàyEndpoint: POST /api/streak/check-inBody Request: { "user_id": 2 }Response Success (200):{
  "current_streak": 6,
  "bonus_points": 0
}

Response Error (400): {"error": "Hôm nay bạn đã check-in rồi!"}2. Bù chuỗi ngày hôm qua (Tốn 30 điểm)Endpoint: POST /api/streak/repairBody Request: { "user_id": 2 }Response Success (200): {"message": "Đã bù chuỗi thành công cho ngày YYYY-MM-DD!"}📝 3.3. Hoạt động & Nhật ký1. Gửi hoạt động mới chờ duyệtEndpoint: POST /api/activitiesBody Request:{
  "user_id": 2,
  "activity_name": "Đọc sách 30 phút",
  "created_at": "2026-11-10"
}

2. Xem lịch sử / nhật ký hoạt động người dùngEndpoint: GET /api/logs/:user_idResponse: Danh sách các hoạt động xếp theo ngày giảm dần.🎁 3.4. Phần thưởng & Đổi Quà1. Lấy danh sách phần thưởngEndpoint: GET /api/rewards2. Đề xuất phần thưởng mớiEndpoint: POST /api/rewards/proposeBody Request:{
  "title": "Vé xem phim",
  "points_required": 100,
  "suggested_by": 2
}

3. Yêu cầu đổi phần thưởngEndpoint: POST /api/rewards/requestBody Request: { "user_id": 2, "reward_id": 1 }4. Xem túi quà đã đổi thành công (Inventory)Endpoint: GET /api/inventory/:user_idResponse Success (200):[
  {
    "reward_title": "Vé xem phim",
    "quantity": 2,
    "last_redeemed": "2026-11-09"
  }
]

👑 3.5. Chức năng Quản Trị Viên (Admin APIs)HTTP MethodEndpointDescriptionBody / Query ParametersGET/api/admin/usersLấy danh sách toàn bộ thành viênNonePOST/api/admin/usersTạo tài khoản thành viên mới{ username, password, name, role }POST/api/admin/adjust-pointsCộng / Trừ điểm trực tiếp{ user_id, points, reason, description }DELETE/api/admin/users/:idXóa tài khoản thành viênNoneGET/api/admin/pending-activitiesDanh sách hoạt động chờ duyệtNonePOST/api/activities/approvePhê duyệt/Từ chối hoạt động{ log_id, status, points }GET/api/admin/reward-requestsLấy danh sách yêu cầu đổi quàNonePOST/api/admin/reward-requests/processDuyệt hoặc từ chối đổi quà`{ request_id, action: 'approve'POST/api/rewards/approveDuyệt target phần thưởng{ reward_id }POST/api/rewards/update-pointsThay đổi số điểm đổi quà{ reward_id, points_required }POST/api/admin/toggle-checkinSửa/Đánh dấu điểm danh trên Lịch`{ user_id, dateStr, action: 'add'🎨 4. CẤU TRÚC GIAO DIỆN FRONTENDỨng dụng Frontend bao gồm các màn hình chính được phân quyền dựa vào role:🖥️ Màn hình Đăng nhập (Login Screen)Biểu mẫu nhập username và password.Xử lý lưu Session người dùng qua Cookie/LocalStorage.👤 Giao diện Thành viên (User View)Thẻ Thống Kê (Dashboard Card): Hiển thị tổng số điểm hiện tại ⭐ và chuỗi ngày điểm danh liên tục 🔥.Khu Vực Điểm Danh (Check-in Bar):Nút Check-in Ngay: Đánh dấu điểm danh ngày hiện tại (Tự khóa nếu đã check-in).Nút Bù Chuỗi (-30đ): Điểm danh bù cho ngày hôm qua.🎒 Túi Quà Đã Đổi (User Inventory): Hiển thị các vật phẩm/phần thưởng đã được Admin duyệt đổi thành công kèm số lượng.📅 Lịch Hoạt Động (Calendar View):Bộ lịch mini hiển thị các chấm đỏ tại những ngày có điểm danh hoặc hoạt động được duyệt.Khi bấm vào ngày bất kỳ sẽ hiển thị chi tiết lịch sử hoạt động ngày đó.➕ Gửi Hoạt Động & 🎁 Đổi Phần Thưởng: Form gửi đề xuất và danh sách quà tặng khả dụng.🛡️ Giao diện Quản trị viên (Admin Dashboard)Duyệt Điểm Hoạt Động: Phê duyệt hoạt động của user và chỉ định số điểm thưởng tương ứng.Duyệt Đổi Quà: Phê duyệt/Từ chối các đơn xin đổi phần thưởng của thành viên.Quản Lý Thành Viên (User List & Detail):Xem tổng quan điểm và chuỗi streak của từng thành viên.Cộng/Trừ điểm trực tiếp kèm lý do cụ thể.Sửa đổi điểm danh trực tiếp bằng cách tương tác trên Lịch của thành viên.Target Phần Thưởng: Điều chỉnh số điểm yêu cầu hoặc thêm/xóa quà tặng.
