import express from "express";
import User from "../Models/User.js";
import { isTeacher, isAdmin, auth } from "../Middleware/AuthMiddleware.js";
import asyncHandler from "express-async-handler";
import QRCode from "qrcode"; // Import the QRCode library for generating QR codes
import Attendance from "./../Models/Attendance.js";
import AttendanceSession from "./../Models/AttendanceSession.js";

import cron from "node-cron";

// import QRCode from "qrcode"; // Ensure QRCode is properly imported if not already

import dayjs from "dayjs";
import Course from "../Models/Course.js";
import * as faceapi from "face-api.js";
import canvas from "canvas";

// Destructure required components
const { Canvas, Image, ImageData } = canvas;

// Patch face-api.js to use canvas in a Node.js environment
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
const attendanceRouter = express.Router();

attendanceRouter.get(
  "/total-courses",
  auth,
  isTeacher,
  asyncHandler(async (req, res) => {
    const teacherId = req.user._id;
    const totalCourses = await Course.countDocuments({ teacher: teacherId });
    res.status(200).json({ totalCourses });
  })
);

// Fetch attendance details (present and absent students) for all courses taught by the teacher
attendanceRouter.get(
  "/attendance-summary",
  auth,
  isTeacher,
  asyncHandler(async (req, res) => {
    const teacherId = req.user._id;
    const courses = await Course.find({ teacher: teacherId });

    let totalPresent = 0;
    let totalAbsent = 0;

    for (const course of courses) {
      const presentCount = await Attendance.countDocuments({
        course: course._id,
        status: "present",
      });
      const absentCount = await Attendance.countDocuments({
        course: course._id,
        status: "absent",
      });
      totalPresent += presentCount;
      totalAbsent += absentCount;
    }

    res.status(200).json({
      totalPresent,
      totalAbsent,
    });
  })
);

attendanceRouter.get(
  "/attendance-summary/student",
  auth, // Ensure the user is authenticated
  asyncHandler(async (req, res) => {
    const studentId = req.user._id; // Get the student's ID from the authenticated user
    console.log(studentId);

    try {
      // Fetch all the courses the student is enrolled in
      const courses = await Course.find({ students: studentId });
      console.log(courses);
      if (!courses || courses.length === 0) {
        return res
          .status(404)
          .json({ message: "No courses found for this student" });
      }

      let totalClasses = 0; // Total number of classes the student is enrolled in
      let totalPresent = 0; // Number of classes the student attended
      let totalAbsent = 0; // Number of classes the student missed
      // let totalLate = 0; // Number of classes the student was late to

      // Loop through each course to get attendance data
      for (const course of courses) {
        // Get the attendance data for the student in this course
        const attendanceData = await Attendance.find({
          student: studentId,
          course: course._id,
        });

        // Update attendance statistics based on the student's attendance records
        totalClasses += attendanceData.length;
        attendanceData.forEach((entry) => {
          if (entry.status === "present") {
            totalPresent++;
          } else if (entry.status === "absent") {
            totalAbsent++;
          } else if (entry.status === "late") {
            totalLate++;
          }
        });
      }

      // Respond with the summary of attendance data for the student
      res.status(200).json({
        totalClasses,
        totalPresent,
        totalAbsent,
        // totalLate,
      });
    } catch (error) {
      console.error("Error fetching attendance summary for student:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching attendance summary.",
      });
    }
  })
);

attendanceRouter.post(
  "/create/:courseId",
  auth,
  isTeacher,
  asyncHandler(async (req, res) => {
    const { courseId } = req.params;

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const currentTime = dayjs();
    const currentDay = currentTime.format("dddd");

    // Find the schedule for current day
    const schedule = course.schedule.find((item) => item.day === currentDay);
    if (!schedule) {
      return res.status(400).json({
        message: `No class scheduled for ${currentDay}. Please select a correct lecture date.`,
      });
    }

    const { startTime, endTime } = schedule;
    if (!startTime || !endTime) {
      return res.status(400).json({
        message:
          "Schedule for the day is incomplete. Start or End time is missing.",
      });
    }

    try {
      // Parse schedule times
      const [startHours, startMinutes] = startTime.split(":").map(Number);
      const [endHours, endMinutes] = endTime.split(":").map(Number);

      // Create datetime objects for lecture timing
      const lectureStartTime = currentTime
        .set("hour", startHours)
        .set("minute", startMinutes)
        .set("second", 0)
        .set("millisecond", 0);
      const lectureEndTime = currentTime
        .set("hour", endHours)
        .set("minute", endMinutes)
        .set("second", 0)
        .set("millisecond", 0);

      // Check if we're within the valid time window
      const fiveMinutesBeforeStart = lectureStartTime.subtract(5, "minute");

      if (currentTime.isBefore(fiveMinutesBeforeStart)) {
        return res.status(400).json({
          message:
            "Cannot create attendance session more than 5 minutes before the lecture time.",
        });
      }

      if (currentTime.isAfter(lectureEndTime)) {
        return res.status(400).json({
          message:
            "Cannot create attendance session after the lecture has ended.",
        });
      }

      // Generate a unique session identifier
      const sessionIdentifier = `${courseId}_${currentDay}_${startTime}_${Date.now()}`;

      // Create attendance session
      const session = new AttendanceSession({
        course: courseId,
        lectureDate: currentTime.toDate(),
        startTime: lectureStartTime.toDate(),
        endTime: lectureEndTime.toDate(),
        isActive: true,
        sessionIdentifier,
      });

      await session.save();

      // Fetch student data along with their faceData
      const students = await User.find({ _id: { $in: course.students } });

      // Create attendance records for all students
      const attendanceDocs = students.map((student) => ({
        course: courseId,
        student: student._id,
        session: session._id,
        status: "pending",
        lectureDate: currentTime.toDate(),
        teacher: req.user._id,
        faceData: student.faceData || null, // Fetch face data from User model
      }));

      await Attendance.insertMany(attendanceDocs);

      // Schedule automatic marking of absent students
      const markAbsentJob = cron.schedule(
        "*/1 * * * *", // Every minute
        async () => {
          if (dayjs().isAfter(lectureEndTime)) {
            await Attendance.updateMany(
              { session: session._id, status: "pending" },
              { $set: { status: "absent" } }
            );
            console.log(
              `Marked pending records as absent for session ${sessionIdentifier}`
            );
            markAbsentJob.stop(); // Stop this cron job after execution
          }
        },
        { scheduled: true, timezone: "UTC" }
      );

      // Schedule session deactivation
      const deactivateSessionJob = cron.schedule(
        "*/1 * * * *", // Every minute
        async () => {
          if (dayjs().isAfter(lectureEndTime)) {
            await AttendanceSession.findByIdAndUpdate(
              session._id,
              { isActive: false },
              { new: true }
            );
            console.log(`Session ${sessionIdentifier} marked as inactive`);
            deactivateSessionJob.stop(); // Stop this cron job after execution
          }
        },
        { scheduled: true, timezone: "UTC" }
      );

      res.status(201).json({
        message: "Attendance session created successfully",
        session: {
          _id: session._id,
          courseId,
          sessionIdentifier,
          startTime: lectureStartTime.toDate(),
          endTime: lectureEndTime.toDate(),
          isActive: true,
        },
      });
    } catch (error) {
      console.error("Error creating attendance session:", error);
      res.status(500).json({
        message: "Failed to create attendance session",
        error: error.message,
      });
    }
  })
);

// Cron job that runs every minute to check attendance sessions
cron.schedule("*/1 * * * *", async () => {
  try {
    const currentTime = dayjs();

    // Find sessions where the current time is after the session end time and the date has passed
    const expiredSessions = await AttendanceSession.find({
      endTime: { $lt: currentTime.toDate() },
      isActive: true, // Only check active sessions
    });

    if (expiredSessions.length > 0) {
      // Update the isActive field of all expired sessions
      await AttendanceSession.updateMany(
        { _id: { $in: expiredSessions.map((session) => session._id) } },
        { $set: { isActive: false } }
      );

      console.log(`Updated ${expiredSessions.length} sessions to inactive.`);
    }
  } catch (error) {
    console.error("Error checking and updating expired sessions:", error);
  }
});

// Student fetching attendance records
attendanceRouter.get(
  "/student/:courseId",
  auth,
  asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const studentId = req.user._id;

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    if (!course.students.includes(studentId)) {
      return res
        .status(403)
        .json({ message: "You are not enrolled in this course" });
    }

    try {
      const attendanceRecords = await Attendance.find({
        student: studentId,
        course: courseId,
      }).populate("session", "lectureDate startTime endTime isActive");
      console.log(attendanceRecords);
      const attendanceList = attendanceRecords.map((record) => {
        const currentTime = new Date();

        const { lectureDate, startTime, endTime, isActive } = record.session;
        const isWithinTimeframe =
          currentTime >= startTime && currentTime <= endTime;

        return {
          lectureDate,
          status: record.status,
          isActive,
          isWithinTimeframe,
        };
      });

      res.status(200).json({
        courseName: course.name,
        courseCode: course.code,
        attendanceList,
      });
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Failed to fetch attendance details" });
    }
  })
);

// 2. Mark Attendance for a Session (Student)
// Marking attendance
// const faceapi = require("face-api.js");
// const canvas = require("canvas");
// const { Canvas, Image, ImageData } = canvas;
// faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
attendanceRouter.put(
  "/mark/:sessionIdentifier",
  auth,
  asyncHandler(async (req, res) => {
    const { sessionIdentifier } = req.params;
    const { faceData } = req.body; // Face descriptors from frontend

    try {
      // Find the session using the session identifier
      const session = await AttendanceSession.findOne({ sessionIdentifier });
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      // Check if session is active and within timeframe
      const currentTime = new Date();
      if (
        !session.isActive ||
        currentTime < session.startTime ||
        currentTime > session.endTime
      ) {
        return res.status(403).json({
          message:
            "Attendance session is not active or out of allowed timeframe",
        });
      }

      // Fetch all attendance records for this session
      const attendanceRecords = await Attendance.find({
        session: session._id,
        status: "pending",
      }).populate("student"); // Populate student to access faceData

      if (!attendanceRecords || attendanceRecords.length === 0) {
        return res.status(404).json({
          message: "No pending attendance records found for this session",
        });
      }

      let matchedStudent = null;
      let matchedAttendanceRecord = null;
      const FACE_MATCH_THRESHOLD = 0.6; // Adjust threshold as needed
      const faceDataArray = new Float32Array(faceData); // Ensure faceData is a Float32Array

      async function findMatchingStudent(records, faceDataArray, threshold) {
        for (const record of records) {
          if (
            record.student &&
            record.faceData &&
            record.faceData.descriptors &&
            record.faceData.descriptors.length > 0
          ) {
            const storedDescriptor = new Float32Array(
              record.faceData.descriptors
            );
            console.log(storedDescriptor.length, faceDataArray.length);

            const distance = faceapi.euclideanDistance(
              storedDescriptor,
              faceDataArray
            );

            if (distance <= threshold) {
              return {
                matchedStudent: record.student,
                matchedAttendanceRecord: record,
              };
            }
          }
        }
        return { matchedStudent: null, matchedAttendanceRecord: null };
      }

      const matchResult = await findMatchingStudent(
        attendanceRecords,
        faceDataArray,
        FACE_MATCH_THRESHOLD
      );
      matchedStudent = matchResult.matchedStudent;
      matchedAttendanceRecord = matchResult.matchedAttendanceRecord;

      if (!matchedStudent) {
        return res.status(401).json({
          message: "Face verification failed. No matching student found.",
        });
      }

      console.log(matchedAttendanceRecord._id);

      // Check if attendance is already marked for this student and session
      const existingAttendance = await Attendance.findOne({
        student: matchedStudent._id,
        session: session._id,
        status: "present",
      });

      if (existingAttendance) {
        return res.status(409).json({
          message:
            "Attendance already marked for this student in this session.",
        });
      }

      // Update the attendance record directly in the database
      await Attendance.findByIdAndUpdate(matchedAttendanceRecord._id, {
        status: "present",
        verificationMethod: "face",
        verifiedAt: new Date(),
      });

      res.status(200).json({
        message: "Attendance marked successfully",
        verifiedAt: new Date(),
        student: matchedStudent._id,
      });
    } catch (error) {
      console.error("Attendance marking error:", error);
      res.status(500).json({
        message: "Failed to mark attendance",
        error: error.message,
      });
    }
  })
);

// 3. Get Attendance History for Student
attendanceRouter.get(
  "/student/history",
  auth,
  asyncHandler(async (req, res) => {
    const attendances = await Attendance.find({ student: req.user._id })
      .populate("course", "name code")
      .populate("session", "lectureDate startTime endTime")
      .sort({ "session.lectureDate": -1 });

    const history = attendances.map((attendance) => ({
      courseName: attendance.course.name,
      courseCode: attendance.course.code,
      lectureDate: attendance.session.lectureDate,
      status: attendance.status,
    }));

    res.json(history);
  })
);

// 4. Get Attendance History for Teacher (By Course)
attendanceRouter.get(
  "/teacher/history/:courseId",
  auth,
  isTeacher,
  asyncHandler(async (req, res) => {
    const { courseId } = req.params;

    const attendances = await Attendance.find({ course: courseId })
      .populate("student", "firstName lastName email")
      .populate("session", "lectureDate startTime endTime")
      .sort({ "session.lectureDate": -1 });

    const history = attendances.map((attendance) => ({
      lectureDate: attendance.session.lectureDate,
      studentName: `${attendance.student.firstName} ${attendance.student.lastName}`,
      status: attendance.status,
    }));

    res.json(history);
  })
);

export default attendanceRouter;
