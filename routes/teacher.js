const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');

// Middleware kiểm tra token + role giáo viên
const authTeacher = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Không có token" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.Role != 2) return res.status(403).json({ error: "Chỉ giáo viên mới được truy cập" });
        req.user = decoded; 
        next();
    } catch (err) {
        res.status(401).json({ error: "Token hết hạn hoặc không hợp lệ" });
    }
};

// 1. Thông tin giáo viên
router.get('/profile', authTeacher, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('TeacherID', sql.Int, req.user.UserID)
            .query(`
                SELECT u.Fullname, c.ClassName AS HomeroomClass
                FROM Users u
                LEFT JOIN Classes c ON u.UserID = c.HomeroomTeacherID
                WHERE u.UserID = @TeacherID AND u.Role = 2
            `);
        res.json(result.recordset[0] || { Fullname: "Giáo viên", HomeroomClass: null });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Thống kê nhanh
router.get('/stats', authTeacher, async (req, res) => {
    try {
        const pool = await poolPromise;
        const teacherID = req.user.UserID;

        const result = await pool.request()
            .input('TeacherID', sql.Int, teacherID)
            .query(`
                SELECT
                    (SELECT COUNT(DISTINCT ClassID) FROM Timetable WHERE TeacherID = @TeacherID) AS totalClasses,
                    (SELECT COUNT(DISTINCT s.StudentID) 
                     FROM Students s 
                     JOIN Timetable t ON s.ClassID = t.ClassID 
                     WHERE t.TeacherID = @TeacherID) AS totalStudents,
                    (SELECT COUNT(*) FROM Requests r
                     JOIN Students s ON r.StudentID = s.StudentID
                     JOIN Classes c ON s.ClassID = c.ClassID
                     WHERE c.HomeroomTeacherID = @TeacherID AND r.Status = N'Đang chờ duyệt') AS pendingLeaves,
                    (SELECT COUNT(*) FROM Timetable 
                     WHERE TeacherID = @TeacherID 
                       AND LessonDate = CAST(GETDATE() AS date)) AS todayLessons
            `);

        res.json(result.recordset[0] || { totalClasses:0, totalStudents:0, pendingLeaves:0, todayLessons:0 });
    } catch (err) {
        console.error(err);
        res.status(500).json({ totalClasses:0, totalStudents:0, pendingLeaves:0, todayLessons:0 });
    }
});

// 3. Lịch dạy hôm nay
router.get('/today-schedule', authTeacher, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('TeacherID', sql.Int, req.user.UserID)
            .query(`
                SELECT t.LessonSlot, t.LessonDate, c.ClassName
                FROM Timetable t
                JOIN Classes c ON t.ClassID = c.ClassID
                WHERE t.TeacherID = @TeacherID
                  AND t.LessonDate = CAST(GETDATE() AS date)
                ORDER BY t.LessonSlot
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json([]);
    }
});

//Lấy điểm hiện tại của lớp + môn + học kỳ
router.get('/scores', authTeacher, async (req, res) => {
    const { classID, subjectID, semesterID, yearID } = req.query;

    if (!classID || !subjectID || !semesterID || !yearID) {
        return res.status(400).json({ error: "Thiếu tham số" });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('ClassID', sql.Int, classID)
            .input('SubjectID', sql.Int, subjectID)
            .input('SemesterID', sql.Int, semesterID)
            .input('YearID', sql.Int, yearID)
            .query(`
                SELECT 
                    st.StudentID,
                    st.Fullname,
                    sc.Scorehs1,
                    sc.Scorehs2,
                    sc.Scorehs3,
                    sc.ScoreTBM,
                    sc.Conduct,
                    sc.TeacherComment
                FROM Students st
                JOIN Classes c ON st.ClassID = c.ClassID
                LEFT JOIN Scores sc ON st.StudentID = sc.StudentID 
                    AND sc.SubjectID = @SubjectID 
                    AND sc.SemesterID = @SemesterID
                    AND sc.YearID = @YearID
                WHERE c.ClassID = @ClassID 
                  AND c.YearID = @YearID
                ORDER BY st.Fullname
            `);

        // Nếu không có học sinh nào → trả về mảng rỗng (frontend sẽ báo "Không có học sinh")
        res.json(result.recordset);
    } catch (err) {
        console.error("Lỗi API scores:", err);
        res.status(500).json([]);
    }
});

//  Lưu điểm (UPSERT)
router.post('/save-score', authTeacher, async (req, res) => {
    const { 
        StudentID, SubjectID, SemesterID, YearID,
        Scorehs1, Scorehs2, Scorehs3, Conduct, TeacherComment 
    } = req.body;

    // Bắt buộc phải có các trường này
    if (!StudentID || !SubjectID || !SemesterID || !YearID) {
        return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
    }

    try {
        const pool = await poolPromise;

        await pool.request()
            .input('StudentID', sql.Int, StudentID)
            .input('SubjectID', sql.Int, SubjectID)
            .input('SemesterID', sql.Int, SemesterID)
            .input('YearID', sql.Int, YearID)
            .input('Scorehs1', sql.Float, Scorehs1 || null)
            .input('Scorehs2', sql.Float, Scorehs2 || null)
            .input('Scorehs3', sql.Float, Scorehs3 || null)
            .input('Conduct', sql.NVarChar(50), Conduct || null)
            .input('TeacherComment', sql.NVarChar(sql.MAX), TeacherComment || null)
            .input('TeacherID', sql.Int, req.user.UserID)
            .query(`
                MERGE INTO Scores AS target
                USING (VALUES (@StudentID, @SubjectID, @SemesterID, @YearID))
                    AS source (StudentID, SubjectID, SemesterID, YearID)
                ON target.StudentID = source.StudentID
                   AND target.SubjectID = source.SubjectID
                   AND target.SemesterID = source.SemesterID
                   AND target.YearID = source.YearID          -- ĐÃ THÊM DÒNG NÀY (QUAN TRỌNG NHẤT!)
                WHEN MATCHED THEN
                    UPDATE SET 
                        Scorehs1 = @Scorehs1,
                        Scorehs2 = @Scorehs2,
                        Scorehs3 = @Scorehs3,
                        Conduct = @Conduct,
                        TeacherComment = @TeacherComment,
                        TeacherID = @TeacherID
                WHEN NOT MATCHED THEN
                    INSERT (StudentID, SubjectID, SemesterID, YearID,
                            Scorehs1, Scorehs2, Scorehs3,
                            Conduct, TeacherComment, TeacherID)
                    VALUES (@StudentID, @SubjectID, @SemesterID, @YearID,
                            @Scorehs1, @Scorehs2, @Scorehs3,
                            @Conduct, @TeacherComment, @TeacherID);
            `);

        res.json({ success: true });
    } catch (err) {
        console.error("Lỗi lưu điểm:", err);
        res.status(500).json({ error: err.message });
    }
});

// Lấy danh sách năm học
router.get('/academic-years', authTeacher, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .query(`SELECT YearID, AcademicYearName FROM AcademicYear ORDER BY StartDate DESC`);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json([]);
    }
});

// Lấy lớp + môn theo năm học
router.get('/teaching-classes', authTeacher, async (req, res) => {
    const { yearID } = req.query;
    
    try {
        const pool = await poolPromise;
        let query = `
            SELECT DISTINCT c.ClassID, c.ClassName, s.SubjectID, s.SubjectName
            FROM Timetable t
            JOIN Classes c ON t.ClassID = c.ClassID
            JOIN Subjects s ON t.SubjectID = s.SubjectID
            WHERE t.TeacherID = @TeacherID
        `;
        const request = pool.request().input('TeacherID', sql.Int, req.user.UserID);

        // Nếu có yearID → lọc theo năm học
        if (yearID) {
            query += ` AND c.YearID = @YearID`;
            request.input('YearID', sql.Int, yearID);
        }

        query += ` ORDER BY c.ClassName`;

        const result = await request.query(query);

        // Gom nhóm theo lớp
        const grouped = {};
        result.recordset.forEach(row => {
            if (!grouped[row.ClassID]) {
                grouped[row.ClassID] = {
                    ClassID: row.ClassID,
                    ClassName: row.ClassName,
                    Subjects: []
                };
            }
            grouped[row.ClassID].Subjects.push({
                SubjectID: row.SubjectID,
                SubjectName: row.SubjectName
            });
        });

        res.json(Object.values(grouped));
    } catch (err) {
        console.error("Lỗi teaching-classes:", err);
        res.status(500).json([]);
    }
});

module.exports = router;