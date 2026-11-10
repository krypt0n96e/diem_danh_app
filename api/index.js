const express = require('express');
const cors = require('cors');
const { createClient } = require('@libsql/client');

const app = express();

app.use(cors());
app.use(express.json());

// Khởi tạo kết nối Turso Database
// Sử dụng các biến môi trường do Vercel kết nối cung cấp
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || '',
  authToken: process.env.TURSO_AUTH_TOKEN || ''
});

// Hàm khởi tạo các Bảng CSDL (Async)
async function initDb() {
  try {
    // Bảng Users
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        name TEXT,
        role TEXT CHECK(role IN ('admin', 'user')) DEFAULT 'user',
        points INTEGER DEFAULT 0,
        current_streak INTEGER DEFAULT 0,
        last_activity_date TEXT
      )
    `);

    // Bảng Nhật ký hoạt động
    await db.execute(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        activity_name TEXT,
        status TEXT DEFAULT 'pending',
        points_awarded INTEGER DEFAULT 0,
        created_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // Bảng Target phần thưởng
    await db.execute(`
      CREATE TABLE IF NOT EXISTS rewards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        points_required INTEGER,
        status TEXT DEFAULT 'proposed',
        suggested_by INTEGER,
        FOREIGN KEY(suggested_by) REFERENCES users(id)
      )
    `);

    // Bảng Yêu cầu đổi phần thưởng
    await db.execute(`
      CREATE TABLE IF NOT EXISTS reward_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        reward_id INTEGER,
        reward_title TEXT,
        points_required INTEGER,
        status TEXT DEFAULT 'pending',
        created_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(reward_id) REFERENCES rewards(id)
      )
    `);

    // Kiểm tra và tạo tài khoản Admin mặc định
    const adminCheck = await db.execute({
      sql: `SELECT COUNT(*) as count FROM users WHERE role = 'admin'`,
      args: []
    });

    if (adminCheck.rows[0].count === 0) {
      await db.execute({
        sql: `INSERT INTO users (username, password, name, role, points, current_streak) VALUES ('admin', '123456', 'Quản Trị Viên', 'admin', 1000, 0)`,
        args: []
      });
    }
  } catch (err) {
    console.error("Lỗi khởi tạo Turso DB:", err);
  }
}

// Chạy khởi tạo bảng CSDL
initDb();

// -------------------------------------------------------------------
// HÀM TOÀN CỤC: TÍNH CHUỖI ĐIỂM DANH LIÊN TỤC CHUẨN XÁC (Async)
// -------------------------------------------------------------------
async function calculateUserStreak(userId) {
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

  try {
    const res = await db.execute({
      sql: `SELECT DISTINCT created_at FROM activity_logs 
            WHERE user_id = ? AND status = 'approved' AND (activity_name LIKE '%Check-in%' OR activity_name LIKE '%chuỗi%' OR activity_name LIKE '%đánh lại%')`,
      args: [userId]
    });

    if (!res.rows || res.rows.length === 0) {
      await db.execute({
        sql: `UPDATE users SET current_streak = 0 WHERE id = ?`,
        args: [userId]
      });
      return 0;
    }

    const checkinDates = new Set();
    res.rows.forEach(r => {
      if (r.created_at) {
        checkinDates.add(String(r.created_at).split('T')[0]);
      }
    });

    let streak = 0;
    let checkDate = new Date(todayObj);

    if (!checkinDates.has(todayStr)) {
      if (!checkinDates.has(yesterdayStr)) {
        await db.execute({
          sql: `UPDATE users SET current_streak = 0 WHERE id = ?`,
          args: [userId]
        });
        return 0;
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

    await db.execute({
      sql: `UPDATE users SET current_streak = ? WHERE id = ?`,
      args: [streak, userId]
    });

    return streak;
  } catch (err) {
    console.error("Lỗi tính streak:", err);
    return 0;
  }
}

// -------------------------------------------------------------------
// CÁC ROUTE API REST
// -------------------------------------------------------------------

// Root test
app.get('/api', (req, res) => {
  res.json({ message: "Backend Vercel + Turso DB đang chạy ngon lành!" });
});

// API Đăng nhập
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await db.execute({
      sql: `SELECT id, username, name, role, points, current_streak FROM users WHERE username = ? AND password = ?`,
      args: [username, password]
    });

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu!" });
    }

    const user = { ...result.rows[0] };
    const computedStreak = await calculateUserStreak(user.id);
    user.current_streak = computedStreak;

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Admin: Lấy danh sách User
app.get('/api/admin/users', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT id, username, name, role, points, current_streak FROM users`,
      args: []
    });

    const users = [];
    for (const row of result.rows) {
      const u = { ...row };
      u.current_streak = await calculateUserStreak(u.id);
      users.push(u);
    }

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Admin: Tạo User mới
app.post('/api/admin/users', async (req, res) => {
  try {
    const { username, password, name, role } = req.body;
    const result = await db.execute({
      sql: `INSERT INTO users (username, password, name, role, points, current_streak) VALUES (?, ?, ?, ?, 0, 0)`,
      args: [username, password, name, role || 'user']
    });

    res.json({ id: Number(result.lastInsertRowid), message: "Tạo tài khoản thành công!" });
  } catch (err) {
    res.status(400).json({ error: "Tên đăng nhập đã tồn tại hoặc dữ liệu không hợp lệ!" });
  }
});

// API Admin: Cộng/trừ điểm trực tiếp
app.post('/api/admin/adjust-points', async (req, res) => {
  try {
    const { user_id, points, reason, description } = req.body;
    const numericPoints = parseInt(points) || 0;
    const today = new Date().toISOString().split('T')[0];

    const defaultDesc = reason === 'tru' ? 'Admin trừ điểm trực tiếp' : 'Admin cộng điểm trực tiếp';
    const activityName = description && description.trim() !== '' ? description.trim() : defaultDesc;

    if (reason === 'tru') {
      await db.execute({
        sql: `UPDATE users SET points = points - ? WHERE id = ?`,
        args: [numericPoints, user_id]
      });
      await db.execute({
        sql: `INSERT INTO activity_logs (user_id, activity_name, status, points_awarded, created_at) VALUES (?, ?, 'approved', ?, ?)`,
        args: [user_id, activityName, -numericPoints, today]
      });
      res.json({ message: "Đã trừ điểm và ghi nhật ký thành công!" });
    } else {
      await db.execute({
        sql: `UPDATE users SET points = points + ? WHERE id = ?`,
        args: [numericPoints, user_id]
      });
      await db.execute({
        sql: `INSERT INTO activity_logs (user_id, activity_name, status, points_awarded, created_at) VALUES (?, ?, 'approved', ?, ?)`,
        args: [user_id, activityName, numericPoints, today]
      });
      res.json({ message: "Đã cộng điểm và ghi nhật ký thành công!" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Admin: Xóa tài khoản User
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    if (parseInt(userId) === 1) {
      return res.status(400).json({ error: "Không thể xóa tài khoản Quản trị viên gốc!" });
    }

    await db.execute({ sql: `DELETE FROM users WHERE id = ?`, args: [userId] });
    await db.execute({ sql: `DELETE FROM activity_logs WHERE user_id = ?`, args: [userId] });
    await db.execute({ sql: `DELETE FROM rewards WHERE suggested_by = ?`, args: [userId] });
    await db.execute({ sql: `DELETE FROM reward_requests WHERE user_id = ?`, args: [userId] });

    res.json({ message: "Đã xóa tài khoản thành công!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Hoạt động & Nhật ký
app.post('/api/activities', async (req, res) => {
  try {
    const { user_id, activity_name, created_at } = req.body;
    const dateStr = created_at || new Date().toISOString().split('T')[0];
    const result = await db.execute({
      sql: `INSERT INTO activity_logs (user_id, activity_name, status, created_at) VALUES (?, ?, 'pending', ?)`,
      args: [user_id, activity_name, dateStr]
    });
    res.json({ id: Number(result.lastInsertRowid), message: "Đã gửi hoạt động" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/pending-activities', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT activity_logs.*, users.name as user_name FROM activity_logs JOIN users ON activity_logs.user_id = users.id WHERE activity_logs.status = 'pending'`,
      args: []
    });
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/activities/approve', async (req, res) => {
  try {
    const { log_id, status, points } = req.body;
    const logRes = await db.execute({
      sql: `SELECT user_id, created_at FROM activity_logs WHERE id = ?`,
      args: [log_id]
    });

    if (logRes.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy" });
    const log = logRes.rows[0];

    await db.execute({
      sql: `UPDATE activity_logs SET status = ?, points_awarded = ? WHERE id = ?`,
      args: [status, points, log_id]
    });

    if (status === 'approved') {
      await db.execute({
        sql: `UPDATE users SET points = points + ? WHERE id = ?`,
        args: [points, log.user_id]
      });
    }

    res.json({ message: "Xử lý thành công" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs/:user_id', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT * FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
      args: [req.params.user_id]
    });
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Check-in hàng ngày
app.post('/api/streak/check-in', async (req, res) => {
  try {
    const { user_id } = req.body;
    const today = new Date().toISOString().split('T')[0];

    const existing = await db.execute({
      sql: `SELECT id FROM activity_logs WHERE user_id = ? AND created_at = ? AND (activity_name LIKE '%Check-in%' OR activity_name LIKE '%chuỗi%')`,
      args: [user_id, today]
    });

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Hôm nay bạn đã check-in rồi!" });
    }

    await db.execute({
      sql: `INSERT INTO activity_logs (user_id, activity_name, status, points_awarded, created_at) VALUES (?, 'Điểm danh Check-in chuỗi', 'approved', 0, ?)`,
      args: [user_id, today]
    });

    const newStreak = await calculateUserStreak(user_id);
    let bonusPoints = 0;
    if (newStreak === 10) bonusPoints = 50;
    if (newStreak === 50) bonusPoints = 300;
    if (newStreak === 100) bonusPoints = 1000;

    if (bonusPoints > 0) {
      await db.execute({
        sql: `UPDATE users SET points = points + ? WHERE id = ?`,
        args: [bonusPoints, user_id]
      });
    }

    res.json({ current_streak: newStreak, bonus_points: bonusPoints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Bù chuỗi
app.post('/api/streak/repair', async (req, res) => {
  try {
    const { user_id } = req.body;
    const cost = 30;
    const yesterdayObj = new Date();
    yesterdayObj.setDate(yesterdayObj.getDate() - 1);
    const yesterdayStr = yesterdayObj.toISOString().split('T')[0];

    const userRes = await db.execute({
      sql: `SELECT points FROM users WHERE id = ?`,
      args: [user_id]
    });

    if (userRes.rows.length === 0 || userRes.rows[0].points < cost) {
      return res.status(400).json({ error: "Không đủ điểm để bù chuỗi (Cần 30 điểm)!" });
    }

    const existingLog = await db.execute({
      sql: `SELECT id FROM activity_logs WHERE user_id = ? AND created_at = ? AND (activity_name LIKE '%Check-in%' OR activity_name LIKE '%chuỗi%')`,
      args: [user_id, yesterdayStr]
    });

    if (existingLog.rows.length > 0) {
      return res.status(400).json({ error: "Ngày hôm qua bạn đã có điểm danh, không cần bù chuỗi!" });
    }

    await db.execute({
      sql: `UPDATE users SET points = points - ? WHERE id = ?`,
      args: [cost, user_id]
    });

    await db.execute({
      sql: `INSERT INTO activity_logs (user_id, activity_name, status, points_awarded, created_at) VALUES (?, 'Bù chuỗi điểm danh (-30đ)', 'approved', ?, ?)`,
      args: [user_id, -cost, yesterdayStr]
    });

    const newStreak = await calculateUserStreak(user_id);
    res.json({ message: `Đã bù chuỗi thành công cho ngày ${yesterdayStr}! Chuỗi hiện tại: ${newStreak} ngày.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Admin: Đánh dấu/xóa điểm danh
app.post('/api/admin/toggle-checkin', async (req, res) => {
  try {
    const { user_id, dateStr, action } = req.body;

    if (action === 'add') {
      const logRes = await db.execute({
        sql: `SELECT id FROM activity_logs WHERE user_id = ? AND created_at = ? AND (activity_name LIKE '%Check-in%' OR activity_name LIKE '%chuỗi%')`,
        args: [user_id, dateStr]
      });

      if (logRes.rows.length > 0) {
        return res.status(400).json({ error: "Ngày này đã có điểm danh rồi!" });
      }

      await db.execute({
        sql: `INSERT INTO activity_logs (user_id, activity_name, status, points_awarded, created_at) VALUES (?, 'Admin đánh lại điểm danh', 'approved', 0, ?)`,
        args: [user_id, dateStr]
      });

      await calculateUserStreak(user_id);
      res.json({ message: `Đã thêm điểm danh ngày ${dateStr} cho thành viên!` });

    } else if (action === 'remove') {
      await db.execute({
        sql: `DELETE FROM activity_logs WHERE user_id = ? AND created_at = ?`,
        args: [user_id, dateStr]
      });

      await calculateUserStreak(user_id);
      res.json({ message: `Đã xóa điểm danh/nhật ký ngày ${dateStr} của thành viên!` });
    } else {
      res.status(400).json({ error: "Hành động không hợp lệ!" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Phần thưởng
app.get('/api/rewards', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT rewards.*, users.name as suggest_name FROM rewards LEFT JOIN users ON rewards.suggested_by = users.id`,
      args: []
    });
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rewards/propose', async (req, res) => {
  try {
    const { title, points_required, suggested_by } = req.body;
    const result = await db.execute({
      sql: `INSERT INTO rewards (title, points_required, suggested_by, status) VALUES (?, ?, ?, 'proposed')`,
      args: [title, points_required || 0, suggested_by]
    });
    res.json({ id: Number(result.lastInsertRowid), message: "Đã đề xuất phần thưởng" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rewards/approve', async (req, res) => {
  try {
    const { reward_id } = req.body;
    await db.execute({
      sql: `UPDATE rewards SET status = 'approved' WHERE id = ?`,
      args: [reward_id]
    });
    res.json({ message: "Đã phê duyệt phần thưởng thành công!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rewards/update-points', async (req, res) => {
  try {
    const { reward_id, points_required } = req.body;
    const pts = parseInt(points_required);
    if (isNaN(pts) || pts < 0) return res.status(400).json({ error: "Số điểm không hợp lệ!" });

    await db.execute({
      sql: `UPDATE rewards SET points_required = ? WHERE id = ?`,
      args: [pts, reward_id]
    });
    res.json({ message: "Đã cập nhật số điểm phần thưởng thành công!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/rewards/:id', async (req, res) => {
  try {
    await db.execute({
      sql: `DELETE FROM rewards WHERE id = ?`,
      args: [req.params.id]
    });
    res.json({ message: "Đã xóa phần thưởng thành công!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Yêu cầu đổi phần thưởng
app.post('/api/rewards/request', async (req, res) => {
  try {
    const { user_id, reward_id } = req.body;
    const today = new Date().toISOString().split('T')[0];

    const rewardRes = await db.execute({
      sql: `SELECT * FROM rewards WHERE id = ?`,
      args: [reward_id]
    });

    if (rewardRes.rows.length === 0) return res.status(404).json({ error: "Phần thưởng không tồn tại!" });
    const reward = rewardRes.rows[0];
    if (reward.status !== 'approved') return res.status(400).json({ error: "Phần thưởng chưa được phê duyệt!" });

    const userRes = await db.execute({
      sql: `SELECT points FROM users WHERE id = ?`,
      args: [user_id]
    });

    if (userRes.rows.length === 0) return res.status(404).json({ error: "User không tồn tại!" });
    const user = userRes.rows[0];

    if (user.points < reward.points_required) {
      return res.status(400).json({ error: `Số điểm không đủ! Bạn cần ${reward.points_required} điểm (Hiện có: ${user.points}đ).` });
    }

    await db.execute({
      sql: `UPDATE users SET points = points - ? WHERE id = ?`,
      args: [reward.points_required, user_id]
    });

    const requestRes = await db.execute({
      sql: `INSERT INTO reward_requests (user_id, reward_id, reward_title, points_required, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`,
      args: [user_id, reward_id, reward.title, reward.points_required, today]
    });

    res.json({ id: Number(requestRes.lastInsertRowid), message: "Đã gửi yêu cầu đổi phần thưởng thành công!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/reward-requests', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT reward_requests.*, users.name as user_name, users.username FROM reward_requests JOIN users ON reward_requests.user_id = users.id WHERE reward_requests.status = 'pending' ORDER BY reward_requests.id DESC`,
      args: []
    });
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/reward-requests/process', async (req, res) => {
  try {
    const { request_id, action } = req.body;
    const today = new Date().toISOString().split('T')[0];

    const reqRes = await db.execute({
      sql: `SELECT * FROM reward_requests WHERE id = ?`,
      args: [request_id]
    });

    if (reqRes.rows.length === 0) return res.status(404).json({ error: "Yêu cầu đổi quà không tồn tại!" });
    const reqItem = reqRes.rows[0];
    if (reqItem.status !== 'pending') return res.status(400).json({ error: "Yêu cầu này đã được xử lý trước đó!" });

    if (action === 'approve') {
      await db.execute({
        sql: `UPDATE reward_requests SET status = 'approved' WHERE id = ?`,
        args: [request_id]
      });

      const logTitle = `Đổi quà thành công: ${reqItem.reward_title}`;
      await db.execute({
        sql: `INSERT INTO activity_logs (user_id, activity_name, status, points_awarded, created_at) VALUES (?, ?, 'approved', ?, ?)`,
        args: [reqItem.user_id, logTitle, -reqItem.points_required, today]
      });

      res.json({ message: "Đã phê duyệt đổi quà và lưu vào nhật ký!" });
    } else {
      await db.execute({
        sql: `UPDATE reward_requests SET status = 'rejected' WHERE id = ?`,
        args: [request_id]
      });

      await db.execute({
        sql: `UPDATE users SET points = points + ? WHERE id = ?`,
        args: [reqItem.points_required, reqItem.user_id]
      });

      res.json({ message: "Đã từ chối yêu cầu và hoàn lại điểm cho thành viên!" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API LẤY TÚI QUÀ ĐÃ ĐỔI THÀNH CÔNG (INVENTORY)
app.get('/api/inventory/:user_id', async (req, res) => {
  try {
    const userId = req.params.user_id;
    const result = await db.execute({
      sql: `SELECT reward_title, COUNT(*) as quantity, MAX(created_at) as last_redeemed 
            FROM reward_requests 
            WHERE user_id = ? AND status = 'approved' 
            GROUP BY reward_title 
            ORDER BY last_redeemed DESC`,
      args: [userId]
    });
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Lấy thông tin User theo ID
app.get('/api/users/:user_id', async (req, res) => {
  try {
    const userId = req.params.user_id;
    const computedStreak = await calculateUserStreak(userId);
    const result = await db.execute({
      sql: `SELECT id, username, name, role, points, current_streak FROM users WHERE id = ?`,
      args: [userId]
    });

    if (result.rows.length > 0) {
      const row = { ...result.rows[0] };
      row.current_streak = computedStreak;
      res.json(row);
    } else {
      res.json({});
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export dành cho Vercel Serverless
module.exports = app;
