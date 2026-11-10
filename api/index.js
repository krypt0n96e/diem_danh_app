const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();

// Cấu hình CORS mở rộng cho phép kết nối từ Neocities hoặc Frontend khác
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'ngrok-skip-browser-warning']
}));

app.options('*', cors());
app.use(express.json());

// Đường dẫn CSDL SQLite chuẩn tối ưu cho Vercel Serverless (/tmp/)
const dbPath = process.env.VERCEL ? '/tmp/database.db' : './database.db';
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Bảng Users
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    username TEXT UNIQUE, 
    password TEXT, 
    name TEXT, 
    role TEXT CHECK(role IN ('admin', 'user')) DEFAULT 'user', 
    points INTEGER DEFAULT 0, 
    current_streak INTEGER DEFAULT 0, 
    last_activity_date TEXT
  )`);
  
  // Bảng Nhật ký hoạt động
  db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    user_id INTEGER, 
    activity_name TEXT, 
    status TEXT DEFAULT 'pending', 
    points_awarded INTEGER DEFAULT 0, 
    created_at TEXT, 
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Bảng Target phần thưởng
  db.run(`CREATE TABLE IF NOT EXISTS rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    title TEXT, 
    points_required INTEGER, 
    status TEXT DEFAULT 'proposed', 
    suggested_by INTEGER, 
    FOREIGN KEY(suggested_by) REFERENCES users(id)
  )`);

  // Bảng Yêu cầu đổi phần thưởng
  db.run(`CREATE TABLE IF NOT EXISTS reward_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    reward_id INTEGER,
    reward_title TEXT,
    points_required INTEGER,
    status TEXT DEFAULT 'pending',
    created_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(reward_id) REFERENCES rewards(id)
  )`);
  
  // Tạo sẵn Admin nếu chưa có
  db.get(`SELECT COUNT(*) as count FROM users WHERE role = 'admin'`, (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO users (username, password, name, role, points, current_streak) VALUES ('admin', '123456', 'Quản Trị Viên', 'admin', 1000, 0)`);
    }
  });
});

// -------------------------------------------------------------------
// HÀM TOÀN CỤC: TÍNH CHUỖI ĐIỂM DANH LIÊN TỤC (STREAK)
// -------------------------------------------------------------------
function calculateUserStreak(userId, callback) {
  const getLocalDateStr = (dObj) => {
    const year = dObj.getFullYear();
    const month = String(dObj.getMonth() + 1).padStart(2, '0');
    const day = String(dObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const todayObj = new Date();
  const todayStr = getLocalDateStr(todayObj);

  const yesterdayObj = new Date(todayObj);
  yesterdayObj.setDate(yesterdayObj.getDate() - 1);
  const yesterdayStr = getLocalDateStr(yesterdayObj);

  db.all(
    `SELECT DISTINCT created_at FROM activity_logs 
     WHERE user_id = ? AND status = 'approved' AND (activity_name LIKE '%Check-in%' OR activity_name LIKE '%chuỗi%' OR activity_name LIKE '%đánh lại%')`,
    [userId],
    (err, rows) => {
      if (err || !rows || rows.length === 0) {
        db.run(`UPDATE users SET current_streak = 0 WHERE id = ?`, [userId], () => callback(0));
        return;
      }

      const checkinDates = new Set();
      rows.forEach(r => {
        if (r.created_at) {
          checkinDates.add(r.created_at.split('T')[0]);
        }
      });

      let streak = 0;
      let checkDate = new Date(todayObj);

      if (!checkinDates.has(todayStr)) {
        if (!checkinDates.has(yesterdayStr)) {
          db.run(`UPDATE users SET current_streak = 0 WHERE id = ?`, [userId], () => callback(0));
          return;
        }
        checkDate = yesterdayObj;
      }

      while (true) {
        const dStr = getLocalDateStr(checkDate);
        if (checkinDates.has(dStr)) {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }

      db.run(`UPDATE users SET current_streak = ? WHERE id = ?`, [streak, userId], () => {
        callback(streak);
      });
    }
  );
}

// -------------------------------------------------------------------
// CÁC ENDPOINT API RESTFUL
// -------------------------------------------------------------------

// 1. Kiểm tra trạng thái Server
app.get('/api', (req, res) => {
  res.json({ message: "Backend API đang hoạt động trên Vercel!" });
});

// 2. API Đăng nhập
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT id, username, name, role, points, current_streak FROM users WHERE username = ? AND password = ?`, 
    [username, password], (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu!" });
      
      calculateUserStreak(user.id, (computedStreak) => {
        user.current_streak = computedStreak;
        res.json(user);
      });
    }
  );
});

// 3. API Lấy thông tin User theo ID
app.get('/api/users/:user_id', (req, res) => {
  const userId = req.params.user_id;
  calculateUserStreak(userId, (computedStreak) => {
    db.get(`SELECT id, username, name, role, points, current_streak FROM users WHERE id = ?`, [userId], (err, row) => {
      if (row) row.current_streak = computedStreak;
      res.json(row || {});
    });
  });
});

// 4. API Admin: Lấy danh sách tất cả User
app.get('/api/admin/users', (req, res) => {
  db.all(`SELECT id, username, name, role, points, current_streak FROM users`, [], (err, rows) => {
    if (err || !rows) return res.json([]);
    if (rows.length === 0) return res.json([]);
    
    let completedCount = 0;
    rows.forEach(u => {
      calculateUserStreak(u.id, (computedStreak) => {
        u.current_streak = computedStreak;
        completedCount++;
        if (completedCount === rows.length) {
          res.json(rows);
        }
      });
    });
  });
});

// 5. API Admin: Tạo User mới
app.post('/api/admin/users', (req, res) => {
  const { username, password, name, role } = req.body;
  db.run(`INSERT INTO users (username, password, name, role, points, current_streak) VALUES (?, ?, ?, ?, 0, 0)`,
    [username, password, name, role || 'user'],
    function(err) {
      if (err) return res.status(400).json({ error: "Tên đăng nhập đã tồn tại!" });
      res.json({ id: this.lastID, message: "Tạo tài khoản thành công!" });
    }
  );
});

// 6. API Admin: Cộng/trừ điểm trực tiếp
app.post('/api/admin/adjust-points', (req, res) => {
  const { user_id, points, reason, description } = req.body;
  const numericPoints = parseInt(points) || 0;
  const today = new Date().toISOString().split('T')[0];
  
  const defaultDesc = reason === 'tru' ? 'Admin trừ điểm trực tiếp' : 'Admin cộng điểm trực tiếp';
  const activityName = description && description.trim() !== '' ? description.trim() : defaultDesc;
  
  if (reason === 'tru') {
    db.run(`UPDATE users SET points = points - ? WHERE id = ?`, [numericPoints, user_id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      db.run(`INSERT INTO activity_logs (user_id, activity_name, status, points_awarded, created_at) VALUES (?, ?, 'approved', ?, ?)`, 
        [user_id, activityName, -numericPoints, today]);
      res.json({ message: "Đã trừ điểm và ghi nhật ký thành công!" });
    });
  } else {
    db.run(`UPDATE users SET points = points + ? WHERE id = ?`, [numericPoints, user_id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      db.run(`INSERT INTO activity_logs (user_id, activity_name, status, points_awarded, created_at) VALUES (?, ?, 'approved', ?, ?)`, 
        [user_id, activityName, numericPoints, today]);
      res.json({ message: "Đã cộng điểm và ghi nhật ký thành công!" });
    });
  }
});

// 7. API Admin: Xóa tài khoản User
app.delete('/api/admin/users/:id', (req, res) => {
  const userId = req.params.id;
  if (parseInt(userId) === 1) {
    return res.status(400).json({ error: "Không thể xóa tài khoản Quản trị viên gốc!" });
  }
  
  db.run(`DELETE FROM users WHERE id = ?`, [userId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.run(`DELETE FROM activity_logs WHERE user_id = ?`, [userId]);
    db.run(`DELETE FROM rewards WHERE suggested_by = ?`, [userId]);
    db.run(`DELETE FROM reward_requests WHERE user_id = ?`, [userId]);
    res.json({ message: "Đã xóa tài khoản thành công!" });
  });
});

// 8. API Gửi Hoạt động mới
app.post('/api/activities', (req, res) => {
  const { user_id, activity_name, created_at } = req.body;
  const dateStr = created_at || new Date().toISOString().split('T')[0];
  db.run(`INSERT INTO activity_logs (user_id, activity_name, status, created_at) VALUES (?, ?, 'pending', ?)`, 
    [user_id, activity_name, dateStr], 
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: "Đã gửi hoạt động" });
    }
  );
});

// 9. API Admin: Lấy các hoạt động chờ duyệt
app.get('/api/admin/pending-activities', (req, res) => {
  db.all(`SELECT activity_logs.*, users.name as user_name FROM activity_logs JOIN users ON activity_logs.user_id = users.id WHERE activity_logs.status = 'pending'`, [], (err, rows) => {
    res.json(rows || []);
  });
});

// 10. API Admin: Phê duyệt / Từ chối hoạt động
app.post('/api/activities/approve', (req, res) => {
  const { log_id, status, points } = req.body; 
  db.get(`SELECT user_id, created_at FROM activity_logs WHERE id = ?`, [log_id], (err, log) => {
    if (!log) return res.status(404).json({ error: "Không tìm thấy" });
    
    db.run(`UPDATE activity_logs SET status = ?, points_awarded = ? WHERE id = ?`, [status, points, log_id]);
    
    if (status === 'approved') {
      db.run(`UPDATE users SET points = points + ? WHERE id = ?`, [points, log.user_id]);
    }
    res.json({ message: "Xử lý thành công" });
  });
});

// 11. API Lấy nhật ký hoạt động của User
app.get('/api/logs/:user_id', (req, res) => {
  db.all(`SELECT * FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC, id DESC`, [req.params.user_id], (err, rows) => {
    res.json(rows || []);
  });
});

// 12. API Check-in hàng ngày
app.post('/api/streak/check-in', (req, res) => {
  const { user_id } = req.body;
  const today = new Date().toISOString().split('T')[0];

  db.get(`SELECT id FROM activity_logs WHERE user_id = ? AND created_at = ? AND (activity_name LIKE '%Check-in%' OR activity_name LIKE '%chuỗi%')`, [user_id, today], (err, existing) => {
    if (existing) {
      return res.status(400).json({ error: "Hôm nay bạn đã check-in rồi!" });
    }

    db.run(
      `INSERT INTO activity_logs (user_id, activity_name, status, points_awarded, created_at) VALUES (?, 'Điểm danh Check-in chuỗi', 'approved', 0, ?)`,
      [user_id, today],
      () => {
        calculateUserStreak(user_id, (newStreak) => {
          let bonusPoints = 0;
          if (newStreak === 10) bonusPoints = 50;
          if (newStreak === 50) bonusPoints = 300;
          if (newStreak === 100) bonusPoints = 1000;

          if (bonusPoints > 0) {
            db.run(`UPDATE users SET points = points + ? WHERE id = ?`, [bonusPoints, user_id]);
          }

          res.json({ current_streak: newStreak, bonus_points: bonusPoints });
        });
      }
    );
  });
});

// 13. API Bù chuỗi ngày hôm qua
app.post('/api/streak/repair', (req, res) => {
  const { user_id } = req.body;
  const cost = 30;
  const yesterdayObj = new Date();
  yesterdayObj.setDate(yesterdayObj.getDate() - 1);
  const yesterdayStr = yesterdayObj.toISOString().split('T')[0];

  db.get(`SELECT points FROM users WHERE id = ?`, [user_id], (err, user) => {
    if (!user || user.points < cost) return res.status(400).json({ error: "Không đủ điểm để bù chuỗi (Cần 30 điểm)!" });

    db.get(`SELECT id FROM activity_logs WHERE user_id = ? AND created_at = ? AND (activity_name LIKE '%Check-in%' OR activity_name LIKE '%chuỗi%')`, [user_id, yesterdayStr], (err, existingLog) => {
      if (existingLog) {
        return res.status(400).json({ error: "Ngày hôm qua bạn đã có điểm danh, không cần bù chuỗi!" });
      }

      db.run(`UPDATE users SET points = points - ? WHERE id = ?`, [cost, user_id], () => {
        db.run(`INSERT INTO activity_logs (user_id, activity_name, status, points_awarded, created_at) VALUES (?, 'Bù chuỗi điểm danh (-30đ)', 'approved', ?, ?)`, 
          [user_id, -cost, yesterdayStr], 
          () => {
            calculateUserStreak(user_id, (newStreak) => {
              res.json({ message: `Đã bù chuỗi thành công cho ngày ${yesterdayStr}! Chuỗi hiện tại: ${newStreak} ngày.` });
            });
          }
        );
      });
    });
  });
});

// 14. API Admin: Sửa / Đánh dấu / Xóa điểm danh trên Lịch
app.post('/api/admin/toggle-checkin', (req, res) => {
  const { user_id, dateStr, action } = req.body;

  if (action === 'add') {
    db.get(`SELECT id FROM activity_logs WHERE user_id = ? AND created_at = ? AND (activity_name LIKE '%Check-in%' OR activity_name LIKE '%chuỗi%')`, [user_id, dateStr], (err, log) => {
      if (log) return res.status(400).json({ error: "Ngày này đã có điểm danh rồi!" });

      db.run(`INSERT INTO activity_logs (user_id, activity_name, status, points_awarded, created_at) VALUES (?, 'Admin đánh lại điểm danh', 'approved', 0, ?)`, 
        [user_id, dateStr], 
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          calculateUserStreak(user_id, () => {
            res.json({ message: `Đã thêm điểm danh ngày ${dateStr} cho thành viên!` });
          });
        }
      );
    });
  } else if (action === 'remove') {
    db.run(`DELETE FROM activity_logs WHERE user_id = ? AND created_at = ?`, [user_id, dateStr], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      calculateUserStreak(user_id, () => {
        res.json({ message: `Đã xóa điểm danh/nhật ký ngày ${dateStr} của thành viên!` });
      });
    });
  } else {
    res.status(400).json({ error: "Hành động không hợp lệ!" });
  }
});

// 15. API Lấy danh sách Phần thưởng
app.get('/api/rewards', (req, res) => {
  db.all(`SELECT rewards.*, users.name as suggest_name FROM rewards LEFT JOIN users ON rewards.suggested_by = users.id`, [], (err, rows) => {
    res.json(rows || []);
  });
});

// 16. API Đề xuất Phần thưởng
app.post('/api/rewards/propose', (req, res) => {
  const { title, points_required, suggested_by } = req.body;
  db.run(`INSERT INTO rewards (title, points_required, suggested_by, status) VALUES (?, ?, ?, 'proposed')`,
    [title, points_required || 0, suggested_by],
    function() { res.json({ id: this.lastID, message: "Đã đề xuất phần thưởng" }); }
  );
});

// 17. API Admin: Phê duyệt phần thưởng
app.post('/api/rewards/approve', (req, res) => {
  const { reward_id } = req.body;
  db.run(`UPDATE rewards SET status = 'approved' WHERE id = ?`, [reward_id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Đã phê duyệt phần thưởng thành công!" });
  });
});

// 18. API Admin: Cập nhật điểm đổi phần thưởng
app.post('/api/rewards/update-points', (req, res) => {
  const { reward_id, points_required } = req.body;
  const pts = parseInt(points_required);
  if (isNaN(pts) || pts < 0) return res.status(400).json({ error: "Số điểm không hợp lệ!" });

  db.run(`UPDATE rewards SET points_required = ? WHERE id = ?`, [pts, reward_id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Đã cập nhật số điểm phần thưởng thành công!" });
  });
});

// 19. API Admin: Xóa phần thưởng
app.delete('/api/rewards/:id', (req, res) => {
  db.run(`DELETE FROM rewards WHERE id = ?`, [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Đã xóa phần thưởng thành công!" });
  });
});

// 20. API User: Đặt yêu cầu đổi phần thưởng
app.post('/api/rewards/request', (req, res) => {
  const { user_id, reward_id } = req.body;
  const today = new Date().toISOString().split('T')[0];

  db.get(`SELECT * FROM rewards WHERE id = ?`, [reward_id], (err, reward) => {
    if (err || !reward) return res.status(404).json({ error: "Phần thưởng không tồn tại!" });
    if (reward.status !== 'approved') return res.status(400).json({ error: "Phần thưởng chưa được phê duyệt!" });

    db.get(`SELECT points FROM users WHERE id = ?`, [user_id], (err, user) => {
      if (err || !user) return res.status(404).json({ error: "User không tồn tại!" });

      if (user.points < reward.points_required) {
        return res.status(400).json({ error: `Số điểm không đủ! Bạn cần ${reward.points_required} điểm (Hiện có: ${user.points}đ).` });
      }

      db.run(`UPDATE users SET points = points - ? WHERE id = ?`, [reward.points_required, user_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        db.run(`INSERT INTO reward_requests (user_id, reward_id, reward_title, points_required, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`,
          [user_id, reward_id, reward.title, reward.points_required, today],
          function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, message: "Đã gửi yêu cầu đổi phần thưởng thành công!" });
          }
        );
      });
    });
  });
});

// 21. API Admin: Lấy danh sách yêu cầu đổi quà chờ duyệt
app.get('/api/admin/reward-requests', (req, res) => {
  db.all(`SELECT reward_requests.*, users.name as user_name, users.username FROM reward_requests JOIN users ON reward_requests.user_id = users.id WHERE reward_requests.status = 'pending' ORDER BY reward_requests.id DESC`, [], (err, rows) => {
    res.json(rows || []);
  });
});

// 22. API Admin: Xử lý Duyệt / Từ chối đổi quà
app.post('/api/admin/reward-requests/process', (req, res) => {
  const { request_id, action } = req.body;
  const today = new Date().toISOString().split('T')[0];

  db.get(`SELECT * FROM reward_requests WHERE id = ?`, [request_id], (err, reqItem) => {
    if (err || !reqItem) return res.status(404).json({ error: "Yêu cầu đổi quà không tồn tại!" });
    if (reqItem.status !== 'pending') return res.status(400).json({ error: "Yêu cầu này đã được xử lý trước đó!" });

    if (action === 'approve') {
      db.run(`UPDATE reward_requests SET status = 'approved' WHERE id = ?`, [request_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        const logTitle = `Đổi quà thành công: ${reqItem.reward_title}`;
        db.run(`INSERT INTO activity_logs (user_id, activity_name, status, points_awarded, created_at) VALUES (?, ?, 'approved', ?, ?)`,
          [reqItem.user_id, logTitle, -reqItem.points_required, today],
          () => {
            res.json({ message: "Đã phê duyệt đổi quà và lưu vào nhật ký!" });
          }
        );
      });
    } else {
      db.run(`UPDATE reward_requests SET status = 'rejected' WHERE id = ?`, [request_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        db.run(`UPDATE users SET points = points + ? WHERE id = ?`, [reqItem.points_required, reqItem.user_id], () => {
          res.json({ message: "Đã từ chối yêu cầu và hoàn lại điểm cho thành viên!" });
        });
      });
    }
  });
});

// 23. API Lấy Túi quà đã đổi thành công (Inventory)
app.get('/api/inventory/:user_id', (req, res) => {
  const userId = req.params.user_id;
  db.all(
    `SELECT reward_title, COUNT(*) as quantity, MAX(created_at) as last_redeemed 
     FROM reward_requests 
     WHERE user_id = ? AND status = 'approved' 
     GROUP BY reward_title 
     ORDER BY last_redeemed DESC`,
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

module.exports = app;
