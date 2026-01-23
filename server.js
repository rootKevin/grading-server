import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(process.cwd()));

// MySQL 연결 (Railway Primary DB)
const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  port: process.env.MYSQLPORT,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  ssl: { rejectUnauthorized: false }
});

/* ───────────── 1. 로그인 (최초 접속) ───────────── */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

/* ───────────── 2. 대시보드 (로그인 성공 후 첫 화면) ───────────── */
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

/* ───────────── 4. 특정 page의 문제 가져오기 (채점용 데이터 API) ───────────── */
app.get("/questions", async (req, res) => {
  const { workbook, page } = req.query;

  if (!workbook) {
    return res.status(400).json({ error: "workbook is required" });
  }
  if (!page) {
    return res.status(400).json({ error: "page is required" });
  }

  try {
    const [rows] = await db.query(
      `SELECT *
       FROM grading_data
       WHERE workbook = ? AND page = ?
       ORDER BY question_number ASC`,
      [workbook, page]
    );

    const result = {};
    rows.forEach((r) => {
      result[r.id] = {
        chapter: r.chapter,
        page: r.page,
        question_no: r.question_number,
        type: r.answer_type,
        gradingOption1: r.grading_option1,
        gradingOption2: r.grading_option2,
        gradingOption3: r.grading_option3,
        ans: r.answer
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

/* ───────────── 1) 교재별 page 목록 ─────────────
   GET /pages?workbook=공통수학1%20RPM
*/
app.get("/pages", async (req, res) => {
  const workbook = req.query.workbook;
  if (!workbook) return res.status(400).json({ error: "workbook is required" });

  try {
    const [rows] = await db.query(
      "SELECT DISTINCT page FROM grading_data WHERE workbook = ? ORDER BY page ASC",
      [workbook]
    );
    res.json(rows.map(r => r.page));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});
app.get("/page-range", async (req, res) => {
  const { workbook } = req.query;
  if (!workbook) {
    return res.status(400).json({ error: "workbook is required" });
  }

  try {
    const [[row]] = await db.query(
      `SELECT MIN(page) AS minPage, MAX(page) AS maxPage
       FROM grading_data
       WHERE workbook = ?`,
      [workbook]
    );

    res.json({
      minPage: row.minPage,
      maxPage: row.maxPage
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});
// ✅ 로그인한 사용자가 선택 가능한 교재 목록
// GET /my-workbooks?userId=123
app.get("/my-workbooks", async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: "userId is required" });

  try {
    const [rows] = await db.query(
      `SELECT w.id, w.code, w.title, w.min_page, w.max_page
       FROM user_workbooks uw
       JOIN workbooks w ON w.id = uw.workbook_id
       WHERE uw.user_id = ?
         AND w.is_active = 1
       ORDER BY w.title ASC`,
      [userId]
    );

    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "db_error" });
  }
});

app.get("/locks", async (req, res) => {
  const { userId, workbook, page } = req.query;
  if (!userId || !workbook || !page) {
    return res.status(400).json({ error: "userId/workbook/page required" });
  }

  try {
    const [rows] = await db.query(
      `SELECT question_no, wrong_count
       FROM question_locks
       WHERE user_id=? AND workbook=? AND page=? AND is_locked=1`,
      [userId, workbook, page]
    );
    res.json({ locked: rows }); // [{question_no:"60", wrong_count:2}, ...]
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "db_error" });
  }
});
// POST /attempt
// body: { userId, workbook, page, questionNo, type, isCorrect }
app.post("/attempt", async (req, res) => {
  const { userId, workbook, page, questionNo, type, isCorrect } = req.body;
  if (!userId || !workbook || !page || !questionNo) {
    return res.status(400).json({ error: "missing_fields" });
  }

  // ✅ 객관식만 잠금 로직 적용
  if (type !== "객관식") return res.json({ ok: true, skipped: true });

  try {
    // 이미 잠금이면 더 이상 채점 불가
    const [[cur]] = await db.query(
      `SELECT wrong_count, is_locked
       FROM question_locks
       WHERE user_id=? AND workbook=? AND page=? AND question_no=?`,
      [userId, workbook, page, questionNo]
    );

    if (cur?.is_locked) {
      return res.status(423).json({ error: "locked", wrong_count: cur.wrong_count });
    }

    if (isCorrect) {
      // 정답이면 기록만 남기고 잠금 변화 없음(원하면 여기서 wrong_count 리셋도 가능)
      await db.query(
        `INSERT INTO question_locks (user_id, workbook, page, question_no, wrong_count, is_locked)
         VALUES (?, ?, ?, ?, 0, 0)
         ON DUPLICATE KEY UPDATE updated_at=NOW()`,
        [userId, workbook, page, questionNo]
      );
      return res.json({ ok: true, locked: false });
    }

    // 오답이면 wrong_count +1 (업서트)
    await db.query(
      `INSERT INTO question_locks (user_id, workbook, page, question_no, wrong_count, is_locked)
       VALUES (?, ?, ?, ?, 1, 0)
       ON DUPLICATE KEY UPDATE wrong_count = wrong_count + 1, updated_at=NOW()`,
      [userId, workbook, page, questionNo]
    );

    const [[after]] = await db.query(
      `SELECT wrong_count FROM question_locks
       WHERE user_id=? AND workbook=? AND page=? AND question_no=?`,
      [userId, workbook, page, questionNo]
    );

    const wrongCount = after.wrong_count;

    if (wrongCount >= 2) {
      await db.query(
        `UPDATE question_locks
         SET is_locked=1, locked_at=NOW(), updated_at=NOW()
         WHERE user_id=? AND workbook=? AND page=? AND question_no=?`,
        [userId, workbook, page, questionNo]
      );
      return res.json({ ok: true, locked: true, wrong_count: wrongCount });
    }

    return res.json({ ok: true, locked: false, wrong_count: wrongCount });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "db_error" });
  }
});
app.post("/admin/unlock", async (req, res) => {
  const key = req.headers["x-admin-key"];
  if (key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: "forbidden" });
  }

  const { userId, workbook, page, questionNo } = req.body;
  if (!userId || !workbook || !page || !questionNo) {
    return res.status(400).json({ error: "missing_fields" });
  }

  try {
    await db.query(
      `UPDATE question_locks
       SET is_locked=0, wrong_count=0, unlocked_at=NOW(), updated_at=NOW()
       WHERE user_id=? AND workbook=? AND page=? AND question_no=?`,
      [userId, workbook, page, questionNo]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "db_error" });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body; // ✅ 평문 수신

  if (!username || !password) {
    return res.status(400).json({ error: "username/password required" });
  }

  try {
    const [rows] = await db.query(
      `SELECT id, username, name, role, password_hash, is_active
       FROM users
       WHERE username = ?
       LIMIT 1`,
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: "inactive_user" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    // ✅ 마지막 로그인 시각 업데이트
    await db.query(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [user.id]);

    // ✅ 프론트에 필요한 최소 정보만 반환
    return res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "db_error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server running on", PORT);
});