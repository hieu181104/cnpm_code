const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');

// Middleware kiểm tra token + role phụ huynh
const authParent = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Không có token" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.Role != 3) return res.status(403).json({ error: "Chỉ phụ huynh mới được truy cập" });
        req.user = decoded; // UserID, FullName, ...
        next();
    } catch (err) {
        res.status(401).json({ error: "Token hết hạn hoặc không hợp lệ" });
    }
};

// Lấy thông tin học sinh của phụ huynh
router.get('/student', authParent, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('ParentID', sql.Int, req.user.UserID)
            .query(`
                SELECT TOP 1 
                    s.StudentID,
                    s.Fullname AS FullName,
                    c.ClassName
                FROM Students s
                LEFT JOIN Classes c ON s.ClassID = c.ClassID
                WHERE s.ParentID = @ParentID
            `);

        if (result.recordset.length === 0) {
            return res.json({ FullName: "Chưa liên kết học sinh", ClassName: "" });
        }

        res.json(result.recordset[0]);
    } catch (err) {
        console.error("Lỗi lấy thông tin học sinh:", err);
        res.status(500).json({ error: err.message });
    }
});

// Lấy danh sách Năm học
router.get('/years', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .query(`SELECT YearID, AcademicYearName FROM AcademicYear ORDER BY YearID DESC`);
        res.json(result.recordset);
    } catch (err) {
        console.error("Lỗi lấy năm học:", err);
        res.status(500).json({ error: err.message });
    }
});

// Lấy danh sách Học kỳ theo Năm học
router.get('/semesters/:yearId', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('YearID', sql.Int, req.params.yearId)
            .query(`SELECT SemesterID, SemesterName FROM Semesters WHERE YearID = @YearID ORDER BY SemesterID`);
        res.json(result.recordset);
    } catch (err) {
        console.error("Lỗi lấy học kỳ:", err);
        res.status(500).json({ error: err.message });
    }
});

// Lấy điểm + nhận xét + hạnh kiểm + điểm TB chung
router.get('/scores/:yearId/:semesterId', authParent, async (req, res) => {
    try {
        const pool = await poolPromise;

        // 1. Lấy điểm từng môn + nhận xét
        const scoresResult = await pool.request()
            .input('ParentID', sql.Int, req.user.UserID)
            .input('YearID', sql.Int, req.params.yearId)
            .input('SemesterID', sql.Int, req.params.semesterId)
            .query(`
                SELECT 
                    sub.SubjectName,
                    sc.Scorehs1 AS TX,
                    sc.Scorehs2 AS GK,
                    sc.Scorehs3 AS ThiHK,
                    sc.ScoreTBM AS TBmon,
                    sc.TeacherComment
                FROM Scores sc
                JOIN Subjects sub ON sc.SubjectID = sub.SubjectID
                JOIN Students s ON sc.StudentID = s.StudentID
                WHERE s.ParentID = @ParentID 
                  AND sc.YearID = @YearID 
                  AND sc.SemesterID = @SemesterID
                ORDER BY sub.SubjectName
            `);

        // 2. Lấy hạnh kiểm và điểm trung bình chung (FinalScore) của học sinh trong học kỳ đó
        const summaryResult = await pool.request()
            .input('ParentID', sql.Int, req.user.UserID)
            .input('YearID', sql.Int, req.params.yearId)
            .input('SemesterID', sql.Int, req.params.semesterId)
            .query(`
                SELECT TOP 1 
                    sc.Conduct,
                    sc.FinalScore
                FROM Scores sc
                JOIN Students s ON sc.StudentID = s.StudentID
                WHERE s.ParentID = @ParentID 
                  AND sc.YearID = @YearID 
                  AND sc.SemesterID = @SemesterID
                ORDER BY sc.ScoreID DESC
            `);

        res.json({
            subjects: scoresResult.recordset,
            summary: summaryResult.recordset[0] || { Conduct: "Chưa có", FinalScore: null }
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: err.message });
    }
});

// Lấy danh sách giáo viên có thể chat (GVCN + GV dạy con)
router.get('/teachers', authParent, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('ParentID', sql.Int, req.user.UserID)
            .query(`
                -- Lấy GVCN trước (bắt buộc phải có)
                SELECT DISTINCT u.UserID, u.Fullname, N'Giáo viên chủ nhiệm' AS RoleName
                FROM Users u
                JOIN Classes c ON u.UserID = c.HomeroomTeacherID
                JOIN Students s ON c.ClassID = s.ClassID
                WHERE s.ParentID = @ParentID AND u.Role = 2

                UNION ALL

                -- Lấy giáo viên bộ môn
                SELECT DISTINCT u.UserID, u.Fullname, sub.SubjectName AS RoleName
                FROM Users u
                JOIN Subjects sub ON u.UserID = sub.TeacherID
                JOIN Scores sc ON sub.SubjectID = sc.SubjectID
                JOIN Students s ON sc.StudentID = s.StudentID
                WHERE s.ParentID = @ParentID AND u.Role = 2

                ORDER BY RoleName, Fullname
            `);
        
        console.log("API /teachers trả về:", result.recordset); // Debug server
        res.json(result.recordset);
    } catch (err) {
        console.error("Lỗi API /teachers:", err);
        res.status(500).json({ error: err.message });
    }
});

// Lấy tin nhắn với 1 giáo viên
router.get('/messages/:receiverID', authParent, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('ParentID', sql.Int, req.user.UserID)
            .input('ReceiverID', sql.Int, req.params.receiverID)
            .query(`
                SELECT MassageID, SenderID, ReceiverID, SentTime, Contents
                FROM Messages
                WHERE (SenderID = @ParentID AND ReceiverID = @ReceiverID)
                   OR (SenderID = @ReceiverID AND ReceiverID = @ParentID)
                ORDER BY SentTime
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Gửi tin nhắn
router.post('/messages', authParent, async (req, res) => {
    try {
        const { ReceiverID, Contents } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('SenderID', sql.Int, req.user.UserID)
            .input('ReceiverID', sql.Int, ReceiverID)
            .input('Contents', sql.NVarChar(sql.MAX), Contents)
            .query(`
                INSERT INTO Messages (SenderID, ReceiverID, SentTime, Contents, IsRead)
                VALUES (@SenderID, @ReceiverID, GETDATE(), @Contents, 0)
            `);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Lấy thời khóa biểu theo tuần (dựa vào ngày thứ 2)
router.get('/timetable', authParent, async (req, res) => {
    try {
        const monday = req.query.monday; // format YYYY-MM-DD
        if (!monday) return res.status(400).json({ error: "Thiếu ngày thứ 2" });

        const pool = await poolPromise;
        const result = await pool.request()
            .input('ParentID', sql.Int, req.user.UserID)
            .input('Monday', sql.Date, monday)
            .query(`
                SELECT 
                    DATEPART(WEEKDAY, t.LessonDate) AS DayOfWeek, -- 1=CN, 2=T2, ..., 7=T7
                    t.LessonSlot,
                    sub.SubjectName,
                    u.Fullname AS TeacherName
                FROM Timetable t
                JOIN Subjects sub ON t.SubjectID = sub.SubjectID
                LEFT JOIN Users u ON t.TeacherID = u.UserID
                JOIN Classes c ON t.ClassID = c.ClassID
                JOIN Students s ON c.ClassID = s.ClassID
                WHERE s.ParentID = @ParentID
                  AND t.LessonDate >= @Monday
                  AND t.LessonDate < DATEADD(day, 7, @Monday)
                ORDER BY t.LessonDate, t.LessonSlot
            `);

        res.json({ lessons: result.recordset });
    } catch (err) {
        console.error("Lỗi TKB:", err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/requests', authParent, async (req, res) => {
    try {
        const { Reason, FromDate, ToDate } = req.body;

        if (!Reason || !FromDate || !ToDate) {
            return res.status(400).json({ error: "Thiếu thông tin ngày nghỉ hoặc lý do" });
        }

        const pool = await poolPromise;

        // 1. Lấy StudentID + ClassID + HomeroomTeacherID (GVCN)
        const studentInfo = await pool.request()
            .input('ParentID', sql.Int, req.user.UserID)
            .query(`
                SELECT TOP 1 
                    s.StudentID, 
                    s.ClassID,
                    c.HomeroomTeacherID AS TeacherID
                FROM Students s
                JOIN Classes c ON s.ClassID = c.ClassID
                WHERE s.ParentID = @ParentID
            `);

        if (studentInfo.recordset.length === 0) {
            return res.status(400).json({ error: "Không tìm thấy học sinh" });
        }

        const { StudentID, TeacherID } = studentInfo.recordset[0];

        // 2. Insert đơn với đầy đủ thông tin
        await pool.request()
            .input('StudentID', sql.Int, StudentID)
            .input('ParentID', sql.Int, req.user.UserID)
            .input('TeacherID', sql.Int, TeacherID)  // Gửi đến GVCN
            .input('Reason', sql.NVarChar(sql.MAX), Reason)
            .input('FromDate', sql.Date, FromDate)
            .input('ToDate', sql.Date, ToDate)
            .input('Status', sql.NVarChar(50), 'Đang chờ duyệt')
            .query(`
                INSERT INTO Requests 
                (StudentID, ParentID, TeacherID, CreatTime, Reason, FromDate, ToDate, Status)
                VALUES 
                (@StudentID, @ParentID, @TeacherID, GETDATE(), @Reason, @FromDate, @ToDate, @Status)
            `);

        res.json({ success: true, message: "Gửi đơn thành công!" });
    } catch (err) {
        console.error("Lỗi gửi đơn:", err);
        res.status(500).json({ error: err.message });
    }
});

// LẤY DANH SÁCH ĐƠN ĐÃ GỬI
router.get('/requests', authParent, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('ParentID', sql.Int, req.user.UserID)
            .query(`
                SELECT 
                    r.RequestID,
                    r.CreatTime,
                    r.FromDate,
                    r.ToDate,
                    r.Reason,
                    r.Status,
                    r.TeacherNote,
                    u.Fullname AS TeacherName
                FROM Requests r
                LEFT JOIN Users u ON r.TeacherID = u.UserID
                WHERE r.ParentID = @ParentID
                ORDER BY r.CreatTime DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error("Lỗi lấy danh sách đơn:", err);
        res.status(500).json({ error: err.message });
    }
});
// API lấy tên GVCN để hiển thị "Kính gửi"
router.get('/homeroom-teacher', authParent, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('ParentID', sql.Int, req.user.UserID)
            .query(`
                SELECT TOP 1 
                    u.Fullname
                FROM Users u
                JOIN Classes c ON u.UserID = c.HomeroomTeacherID
                JOIN Students s ON c.ClassID = s.ClassID
                WHERE s.ParentID = @ParentID AND u.Role = 2
            `);

        if (result.recordset.length > 0) {
            res.json(result.recordset[0]);
        } else {
            res.json({ Fullname: "Giáo viên chủ nhiệm" }); // Default nếu chưa có
        }
    } catch (err) {
        console.error("Lỗi API homeroom-teacher:", err);
        res.json({ Fullname: "Giáo viên chủ nhiệm" }); // Lỗi thì vẫn trả default
    }
});

// Xem hồ sơ cá nhân
router.get('/profile', authParent, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('UserID', sql.Int, req.user.UserID)
            .query(`
                SELECT UserID, Username, Fullname, Email, Phone, Address, Gender
                FROM Users 
                WHERE UserID = @UserID AND Role = 3
            `);
        res.json(result.recordset[0] || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cập nhật hồ sơ
router.put('/profile', authParent, async (req, res) => {
    try {
        const { Fullname, Email, Phone, Address, Gender } = req.body;
        const pool = await poolPromise;

        await pool.request()
            .input('UserID', sql.Int, req.user.UserID)
            .input('Fullname', sql.NVarChar(100), Fullname)
            .input('Email', sql.NVarChar(100), Email || null)
            .input('Phone', sql.NVarChar(20), Phone || null)
            .input('Address', sql.NVarChar(255), Address || null)
            .input('Gender', sql.NVarChar(10), Gender || null)
            .query(`
                UPDATE Users SET 
                    Fullname = @Fullname,
                    Email = @Email,
                    Phone = @Phone,
                    Address = @Address,
                    Gender = @Gender
                WHERE UserID = @UserID AND Role = 3
            `);

        res.json({ success: true });
    } catch (err) {
        console.error("Lỗi cập nhật hồ sơ:", err);
        res.status(500).json({ error: err.message });
    }
});

// Lấy danh sách con cái của phụ huynh
router.get('/children', authParent, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('ParentID', sql.Int, req.user.UserID)
            .query(`
                SELECT 
                    s.Fullname,
                    s.DateOfBirth,
                    s.Gender,
                    c.ClassName
                FROM Students s
                LEFT JOIN Classes c ON s.ClassID = c.ClassID
                WHERE s.ParentID = @ParentID
                ORDER BY s.Fullname
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error("Lỗi lấy danh sách con:", err);
        res.status(500).json({ error: err.message });
    }
});

// LẤY TẤT CẢ THÔNG BÁO GỬI QUA WEB
router.get('/notifications', async (req, res) => {  // <--- XÓA authParent Ở ĐÂY
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .query(`
                SELECT 
                    NotificationID,
                    Title,
                    Contents AS Content,
                    CreatTime AS CreateTime,
                    SendWeb
                FROM Notification
                WHERE SendWeb = 1
                ORDER BY CreatTime DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error("Lỗi thông báo:", err);
        res.status(500).json([]);
    }
});

// LẤY LỊCH SỬ ĐIỂM DANH CỦA CON
router.get('/attendance', authParent, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('ParentID', sql.Int, req.user.UserID)
            .query(`
                SELECT 
                    a.Date,
                    CASE 
                        WHEN a.Status = 1 THEN N'Có mặt'
                        WHEN a.Status = 0 THEN N'Vắng không phép'
                        WHEN a.Status = 2 THEN N'Đi muộn'
                        WHEN a.Status = 3 THEN N'Vắng có phép'
                        ELSE N'Chưa điểm danh'
                    END AS Status
                FROM Attendance a
                INNER JOIN Students s ON a.StudentID = s.StudentID
                WHERE s.ParentID = @ParentID
                ORDER BY a.Date DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error("Lỗi lấy điểm danh:", err);
        res.status(500).json([]);
    }
});

module.exports = router;