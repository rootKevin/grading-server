import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";

const app = express();

app.use(cors());
app.use(express.json());

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
  const page = req.query.page;
  if (!page) return res.status(400).json({ error: "page is required" });

  try {
    const [rows] = await db.query(
      "SELECT * FROM grading_data WHERE workbook? AND page = ? ORDER BY question_number ASC",
      [workbook, page]
    );

    const result = {};
    rows.forEach((r) => {
      const id = r.id;
      result[id] = {
        chapter: r.chapter,
        page: r.page,
        question_no: r.question_number,
        type: r.answer_type,
        gradingOption1 : r.grading_option1,
        gradingOption2 : r.grading_option2,
        gradingOption3 : r. grading_option3,
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

app.listen(3000, () => console.log("🚀 Server running on 3000"));
