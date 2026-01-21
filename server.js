import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import bcrypt from "bcryptjs";

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
app.listen(PORT, () => console.log("🚀 Server running on", PORT));
