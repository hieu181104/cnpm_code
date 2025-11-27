const sql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    options: {
        trustServerCertificate: true,
        encrypt: process.env.DB_ENCRYPT === 'true'
    }
};

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log("✔️ Connected to MSSQL");
        return pool;
    })
    .catch(err => console.log("❌ Database Connection Failed: ", err));

module.exports = {
    sql, poolPromise
};