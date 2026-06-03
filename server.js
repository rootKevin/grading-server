import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";
dotenv.config();

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
// =====================================================
// Academy App APIs - 수업일지 / 페널티 / 설문 관리
// =====================================================

// 반 목록 불러오기
app.get("/academy/classes", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        id,
        name,
        grade,
        schedule_name,
        is_active
      FROM academy_class_groups
      WHERE is_active = 1
      ORDER BY id
    `);

    res.json({
      ok: true,
      classes: rows,
    });
  } catch (err) {
    console.error("❌ /academy/classes error:", err);
    res.status(500).json({
      ok: false,
      message: "반 목록을 불러오지 못했습니다.",
      error: err.message,
    });
  }
});


// 특정 반의 학생 목록 불러오기
app.get("/academy/classes/:classId/students", async (req, res) => {
  try {
    const classId = Number(req.params.classId);

    if (!classId) {
      return res.status(400).json({
        ok: false,
        message: "classId가 올바르지 않습니다.",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
        s.id,
        s.name,
        s.school_name,
        s.grade,
        s.gender,
        s.is_active
      FROM academy_class_students cs
      JOIN academy_students s ON cs.student_id = s.id
      WHERE cs.class_group_id = ?
        AND cs.is_active = 1
        AND s.is_active = 1
      ORDER BY s.name
      `,
      [classId]
    );

    res.json({
      ok: true,
      classId,
      students: rows,
    });
  } catch (err) {
    console.error("❌ /academy/classes/:classId/students error:", err);
    res.status(500).json({
      ok: false,
      message: "학생 목록을 불러오지 못했습니다.",
      error: err.message,
    });
  }
});
app.get("/academy/db-test", async (req, res) => {
  try {
    const [dbRows] = await db.query("SELECT DATABASE() AS dbName");
    const [tableRows] = await db.query("SHOW TABLES LIKE 'academy_%'");

    res.json({
      ok: true,
      database: dbRows[0].dbName,
      tables: tableRows,
    });
  } catch (err) {
    console.error("❌ /academy/db-test error:", err);

    res.status(500).json({
      ok: false,
      message: "DB 테스트 실패",
      error: err.message,
    });
  }
});
// 수업일지 목록 불러오기
app.get("/academy/sessions", async (req, res) => {
  try {
    const { date, classId } = req.query;

    const conditions = [];
    const params = [];

    if (date) {
      conditions.push("cs.session_date = ?");
      params.push(date);
    }

    if (classId) {
      conditions.push("cs.class_group_id = ?");
      params.push(Number(classId));
    }

    const whereSql =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await pool.query(
      `
      SELECT
        cs.id,
        cs.class_group_id,
        cg.name AS class_name,
        cs.session_date,
        cs.session_type,
        cs.title,
        cs.notice,
        cs.memo,
        cs.created_at,

        (
          SELECT COUNT(*)
          FROM academy_session_common_homework h
          WHERE h.session_id = cs.id
        ) AS common_homework_count,

        (
          SELECT COUNT(*)
          FROM academy_session_student_records r
          WHERE r.session_id = cs.id
        ) AS student_record_count,

        (
          SELECT COUNT(*)
          FROM academy_penalty_entries p
          WHERE p.session_id = cs.id
            AND p.status = 'active'
        ) AS penalty_count,

        (
          SELECT COALESCE(SUM(p.points), 0)
          FROM academy_penalty_entries p
          WHERE p.session_id = cs.id
            AND p.status = 'active'
        ) AS penalty_total

      FROM academy_class_sessions cs
      JOIN academy_class_groups cg ON cs.class_group_id = cg.id
      ${whereSql}
      ORDER BY cs.session_date DESC, cs.class_group_id ASC, cs.id DESC
      LIMIT 100
      `,
      params
    );

    res.json({
      ok: true,
      sessions: rows,
    });
  } catch (err) {
    console.error("❌ /academy/sessions error:", err);

    res.status(500).json({
      ok: false,
      message: "수업일지 목록을 불러오지 못했습니다.",
      error: err.message,
    });
  }
});

// 수업일지 1개 전체 불러오기
app.get("/academy/sessions/:sessionId", async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);

    if (!sessionId) {
      return res.status(400).json({
        ok: false,
        message: "sessionId가 올바르지 않습니다.",
      });
    }

    // 1. 수업 기본정보
    const [sessionRows] = await db.query(
      `
      SELECT
        cs.id,
        cs.class_group_id,
        cg.name AS class_name,
        cs.session_date,
        cs.session_type,
        cs.title,
        cs.notice,
        cs.memo,
        cs.created_at
      FROM academy_class_sessions cs
      JOIN academy_class_groups cg ON cs.class_group_id = cg.id
      WHERE cs.id = ?
      `,
      [sessionId]
    );

    if (sessionRows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "해당 수업일지를 찾을 수 없습니다.",
      });
    }

    const session = sessionRows[0];

    // 2. 공통숙제
    const [commonHomeworkRows] = await db.query(
      `
      SELECT
        id,
        target_type,
        target_name,
        book_name,
        range_text,
        problem_count,
        memo,
        sort_order
      FROM academy_session_common_homework
      WHERE session_id = ?
      ORDER BY sort_order, id
      `,
      [sessionId]
    );

    // 3. 학생별 기록
    const [studentRecordRows] = await db.query(
      `
      SELECT
        r.id AS record_id,
        s.id AS student_id,
        s.name AS student_name,
        s.school_name,
        s.grade,
        s.gender,

        r.attendance_status,
        r.survey_missing,
        r.late_minutes,
        r.late_penalty_points,
        r.homework_incomplete,
        r.homework_not_brought,
        r.checkin_missing,
        r.note_missing,
        r.individual_homework,
        r.teacher_memo
      FROM academy_session_student_records r
      JOIN academy_students s ON r.student_id = s.id
      WHERE r.session_id = ?
      ORDER BY s.name
      `,
      [sessionId]
    );

    // 4. 페널티 목록
    const [penaltyRows] = await db.query(
      `
      SELECT
        p.id,
        p.student_id,
        s.name AS student_name,
        p.penalty_code,
        p.reason,
        p.points,
        p.source,
        p.memo,
        p.status,
        p.created_at
      FROM academy_penalty_entries p
      JOIN academy_students s ON p.student_id = s.id
      WHERE p.session_id = ?
      ORDER BY s.name, p.id
      `,
      [sessionId]
    );

    res.json({
      ok: true,
      session,
      commonHomework: commonHomeworkRows,
      studentRecords: studentRecordRows,
      penalties: penaltyRows,
    });
  } catch (err) {
    console.error("❌ /academy/sessions/:sessionId error:", err);

    res.status(500).json({
      ok: false,
      message: "수업일지를 불러오지 못했습니다.",
      error: err.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server running on", PORT);
});