const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');

// Lấy danh sách tài khoản
router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT UserID, Username, Fullname, Email, Role 
            FROM Users
        `);

        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Thêm tài khoản
router.post('/add', async (req, res) => {
    try {
        const { Username, Password, Fullname, Email, Role } = req.body;

        const pool = await poolPromise;
        await pool.request()
            .input('Username', sql.NVarChar, Username)
            .input('Password', sql.NVarChar, Password)
            .input('Fullname', sql.NVarChar, Fullname)
            .input('Email', sql.NVarChar, Email)
            .input('Role', sql.Int, Role)
            .query(`
                INSERT INTO Users (Username, Password, Fullname, Email, Role)
                VALUES (@Username, @Password, @Fullname, @Email, @Role)
            `);

        res.json({ message: "User created successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cập nhật tài khoản
router.put('/update/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const { Username, Fullname, Email, Role } = req.body;

        const pool = await poolPromise;
        await pool.request()
            .input('UserID', sql.Int, id)
            .input('Username', sql.NVarChar, Username)
            .input('Fullname', sql.NVarChar, Fullname)
            .input('Email', sql.NVarChar, Email)
            .input('Role', sql.Int, Role)
            .query(`
                UPDATE Users SET
                Username = @Username,
                Fullname = @Fullname,
                Email = @Email,
                Role = @Role
                WHERE UserID = @UserID
            `);

        res.json({ message: "User updated successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Xóa tài khoản
router.delete('/delete/:id', async (req, res) => {
    try {
        const id = req.params.id;

        const pool = await poolPromise;
        await pool.request()
            .input('UserID', sql.Int, id)
            .query(`DELETE FROM Users WHERE UserID = @UserID`);

        res.json({ message: "User deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;