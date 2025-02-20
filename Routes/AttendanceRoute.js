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
    console.log(studentId)

    try {
      // Fetch all the courses the student is enrolled in
      const courses = await Course.find({ students: studentId });
      console.log(courses)
      if (!courses || courses.length === 0) {
      return res.status(404).json({ message: "No courses found for this student" });
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
      const [startHours, startMinutes] = startTime.split(":").map(Number);
      const [endHours, endMinutes] = endTime.split(":").map(Number);

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

      const sessionIdentifier = `${courseId}_${currentDay}_${startTime}`;

      QRCode.toDataURL(
        sessionIdentifier,
        { errorCorrectionLevel: "H" },
        async (err, qrCodeImage) => {
          if (err) {
            return res
              .status(500)
              .json({ message: "Failed to generate QR code", error: err });
          }

          const session = new AttendanceSession({
            course: courseId,
            qrCode: qrCodeImage,
            lectureDate: currentTime.toDate(),
            startTime: lectureStartTime.toDate(),
            endTime: lectureEndTime.toDate(),
            isActive: true,
            sessionIdentifier, // Save the identifier
          });

          await session.save();

          const attendanceDocs = course.students.map((studentId) => ({
            course: courseId,
            student: studentId,
            session: session._id,
            status: "pending",
            lectureDate: currentTime.toDate(),
            teacher: req.user._id,
          }));

          await Attendance.insertMany(attendanceDocs);

          // Calculate the delay in milliseconds after lectureEndTime
          const delay = lectureEndTime.diff(currentTime);

          if (delay > 0) {
            // Schedule the cron job to mark pending attendance as absent
            cron.schedule(
              `*/1 * * * *`, // Every minute (or adjust frequency as needed)
              async () => {
                if (dayjs().isAfter(lectureEndTime)) {
                  await Attendance.updateMany(
                    { session: session._id, status: "pending" },
                    { $set: { status: "absent" } }
                  );
                  console.log("Marked pending records as absent.");
                }
              },
              { scheduled: true, timezone: "UTC" }
            );
          }
            cron.schedule(
              `*/1 * * * *`, // Every minute (or adjust frequency as needed)
              async () => {
                console.log("ghgh")
                if (dayjs().isAfter(lectureEndTime)) {
                  await AttendanceSession.findByIdAndUpdate(
                    session._id,
                    { isActive: false },
                    { new: true }
                  );
                  console.log(
                    "Session marked as inactive after the lecture time."
                  );
                }
              },
              { scheduled: true, timezone: "UTC" }
            );

          res.status(201).json({
            message: "Attendance session created successfully",
            session,
            qrCode: qrCodeImage,
          });
        }
      );
    } catch (error) {
      res.status(400).json({ message: error.message });
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
      console.log(error)
      res.status(500).json({ message: "Failed to fetch attendance details" });
    }
  })
);

// 2. Mark Attendance for a Session (Student)
// Marking attendance
attendanceRouter.put(
  "/mark/:sessionIdentifier",
  auth,
  asyncHandler(async (req, res) => {
    const { sessionIdentifier } = req.params;
    const studentId = req.user._id;

    try {
      // Find the session using the session identifier
      const session = await AttendanceSession.findOne({ sessionIdentifier });
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

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

      const attendance = await Attendance.findOne({
        session: session._id,
        student: studentId,
      });
      if (!attendance) {
        return res.status(404).json({ message: "Attendance record not found" });
      }

      if (attendance.status !== "pending") {
        return res.status(400).json({ message: "Attendance already marked" });
      }

      attendance.status = "present";
      await attendance.save();

      res.status(200).json({ message: "Attendance marked successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to mark attendance" });
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
