const express = require("express");
const mysql = require("mysql2/promise");
require("dotenv").config();

const app = express();
app.use(express.json());

// MySQL 연결
const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  port: process.env.MYSQLPORT,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  ssl: { rejectUnauthorized: false }
});

// 특정 page의 문제 가져오기
app.get("/questions", async (req, res) => {
  const page = req.query.page;
  if (!page) return res.status(400).json({ error: "page is required" });

  try {
    const [rows] = await db.query(
      "SELECT * FROM grading_data WHERE page = ? ORDER BY number ASC",
      [page]
    );

    // main.html의 구조에 맞게 변환
    const result = {};
    rows.forEach((r) => {
      const id = "q" + r.number;
      result[id] = {
        page: r.page,
        type: r.type,
        ans: r.answer
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

app.listen(3000, () => console.log("🚀 Server running on 3000"));
