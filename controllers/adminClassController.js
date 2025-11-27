const db = require("../config/db");

// Lấy danh sách năm học
exports.getYears = async (req, res) => {
    try {
        const result = await db.query`SELECT YearID, AcademicYearName FROM AcademicYear ORDER BY AcademicYearName DESC`;
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Lấy danh sách giáo viên (Role = 2)
exports.getTeachers = async (req, res) => {
    try {
        const result = await db.query`
            SELECT UserID, Fullname 
            FROM Users 
            WHERE Role = 2
        `;
        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Lấy lớp theo năm học
exports.getClassesByYear = async (req, res) => {
    try {
        const yearId = req.params.yearId;

        const result = await db.query`
            SELECT 
                C.ClassID, C.ClassName, 
                A.AcademicYearName,
                C.HomeroomTeacherID,
                U.Fullname AS TeacherName
            FROM Classes C
            JOIN AcademicYear A ON C.YearID = A.YearID
            LEFT JOIN Users U ON C.HomeroomTeacherID = U.UserID
            WHERE C.YearID = ${yearId}
            ORDER BY C.ClassName
        `;

        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Tạo lớp học
exports.createClass = async (req, res) => {
    try {
        const { ClassName, HomeroomTeacherID, YearID } = req.body;

        await db.query`
            INSERT INTO Classes (ClassName, HomeroomTeacherID, YearID)
            VALUES (${ClassName}, ${HomeroomTeacherID || null}, ${YearID})
        `;

        res.json({ message: "Tạo lớp học thành công" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Cập nhật lớp học
exports.updateClass = async (req, res) => {
    try {
        const { ClassID, ClassName, HomeroomTeacherID, YearID } = req.body;

        await db.query`
            UPDATE Classes 
            SET ClassName = ${ClassName},
                HomeroomTeacherID = ${HomeroomTeacherID || null},
                YearID = ${YearID}
            WHERE ClassID = ${ClassID}
        `;

        res.json({ message: "Cập nhật lớp học thành công" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Xóa lớp
exports.deleteClass = async (req, res) => {
    try {
        const id = req.params.id;

        await db.query`
            DELETE FROM Classes WHERE ClassID = ${id}
        `;

        res.json({ message: "Đã xóa lớp học" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};