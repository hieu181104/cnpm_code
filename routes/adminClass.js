const express = require("express");
const router = express.Router();
const adminClass = require("../controllers/adminClassController");

router.get("/years", adminClass.getYears);
router.get("/teachers", adminClass.getTeachers);
router.get("/classes/:yearId", adminClass.getClassesByYear);

router.post("/class", adminClass.createClass);
router.put("/class", adminClass.updateClass);
router.delete("/class/:id", adminClass.deleteClass);

module.exports = router;