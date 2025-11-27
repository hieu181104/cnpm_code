const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');

// API ĐĂNG NHẬP (KHÔNG DÙNG HASH)
router.post('/login', async (req, res) => {
    try {
        const { Username, Password } = req.body;

        if (!Username || !Password) {
            return res.status(400).json({ error: "Missing Username or Password" });
        }

        const pool = await poolPromise;

        const result = await pool.request()
            .input('Username', sql.NVarChar, Username)
            .input('Password', sql.NVarChar, Password)
            .query(`
                SELECT * FROM Users 
                WHERE Username = @Username AND Password = @Password
            `);

        const user = result.recordset[0];

        if (!user) {
            return res.status(401).json({ error: "Invalid username or password" });
        }

        // TẠO TOKEN
        const token = jwt.sign(
            {
                UserID: user.UserID,
                Username: user.Username,
                Role: user.Role,
                FullName: user.Fullname
            },
            process.env.JWT_SECRET,
            { expiresIn: "8h" }
        );

        res.json({
            message: "Login successful",
            token,
            user: {
                UserID: user.UserID,
                Username: user.Username,
                FullName: user.Fullname,
                Role: user.Role,
                Email: user.Email
            }
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Server error" });
    }
});

module.exports = router;