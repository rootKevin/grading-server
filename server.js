import path from "path";
const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
require("dotenv").config();

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

/* ───────────── 3. 공통수학1 RPM 쪽 선택 페이지 ───────────── */
app.get("/rpm/common1/pages", (req, res) => {
  res.sendFile(path.join(__dirname, "gongsu1-rpm-pages.html"));
});

/* ───────────── 4. 특정 page의 문제 가져오기 (채점용 데이터 API) ───────────── */
app.get("/questions", async (req, res) => {
  const page = req.query.page;
  if (!page) return res.status(400).json({ error: "page is required" });

  try {
    const [rows] = await db.query(
      "SELECT * FROM grading_data_RPM_GongSu1 WHERE page = ? ORDER BY question_no ASC",
      [page]
    );

    const result = {};
    rows.forEach((r) => {
      const id = "q" + r.question_no;
      result[id] = {
        chapter: r.chapter,
        page: r.page,
        question_no: r.question_no,
        type: r.answer_type,
        ans: r.answer
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

/* ───────────── 5. 교재 전체 page 목록 불러오기 API ───────────── */
app.get("/pages", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT DISTINCT page FROM grading_data_RPM_GongSu1 ORDER BY page ASC"
    );
    res.json(rows.map(r => r.page));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

app.listen(3000, () => console.log("🚀 Server running on 3000"));
