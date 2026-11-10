const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();

// Xử lý CORS mở cho Neocities kết nối
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

app.options('*', cors());
app.use(express.json());

// Lưu CSDL vào thư mục /tmp/ trên Vercel Serverless
const dbPath = process.env.VERCEL ? '/tmp/database.db' : './database.db';
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
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
  
  db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    user_id INTEGER, 
    activity_name TEXT, 
    status TEXT DEFAULT 'pending', 
    points_awarded INTEGER DEFAULT 0, 
    created_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    title TEXT, 
    points_required INTEGER, 
    status TEXT DEFAULT 'proposed', 
    suggested_by INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reward_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    reward_id INTEGER,
    reward_title TEXT,
    points_required INTEGER,
    status TEXT DEFAULT 'pending',
    created_at TEXT
  )`);
  
  // Tạo tài khoản Admin mặc định
  db.get(`SELECT COUNT(*) as count FROM users WHERE role = 'admin'`, (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO users (username, password, name, role, points, current_streak) VALUES ('admin', '123456', 'Quản Trị Viên', 'admin', 1000, 0)`);
    }
  });
});

// Tính toán chuỗi điểm danh
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

      const checkinDates = new Set(rows.map(r => String(r.created_at).split('T')[0]));
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

// ---------------- API ROUTES ----------------

app.get('/api', (req, res) => {
  res.json({ message: "Backend API Vercel đang chạy!" });
});

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

app.get('/api/users/:user_id', (req, res) => {
  const userId = req.params.user_id;
  calculateUserStreak(userId, (computedStreak) => {
    db.get(`SELECT id, username, name, role, points, current_streak FROM users WHERE id = ?`, [userId], (err, row) => {
      if (row) row.current_streak = computedStreak;
      res.json(row || {});
    });
  });
});

app.get('/api/logs/:user_id', (req, res) => {
  db.all(`SELECT * FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC, id DESC`, [req.params.user_id], (err, rows) => {
    res.json(rows || []);
  });
});

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

module.exports = app;
