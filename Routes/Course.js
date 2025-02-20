import express from "express";
import asyncHandler from "express-async-handler";
import Course from "../models/Course.js";
import Department from "../models/Department.js";
import User from "../Models/User.js";
import { isTeacher, auth } from "../Middleware/AuthMiddleware.js";
import Attendance from "../Models/Attendance.js";

const courseRouter = express.Router();

// Fetch Courses for the Authenticated Student
courseRouter.get(
  "/student",
  auth, // Ensure the user is authenticated
  asyncHandler(async (req, res) => {
    try {
      // Find courses where the student is registered (using req.user._id)
      const courses = await Course.find({ students: req.user._id })
        .populate("teacher")
        .exec();

      if (!courses || courses.length === 0) {
        return res
          .status(404)
          .json({ message: "No courses found for this student." });
      }

      res.status(200).json({ success: true, courses });
    } catch (error) {
      console.error("Error fetching courses for student:", error);
      res
        .status(500)
        .json({ success: false, message: "Server error fetching courses." });
    }
  })
);

// Create a Course (Only teachers or admins can create)
courseRouter.post(
  "/create",
  auth,
  isTeacher,
  asyncHandler(async (req, res) => {
    const {
      name,
      code,
      departmentId,
      schedule,
      semesterStartDate,
      semesterDuration,
    } = req.body;

    if (
      !name ||
      !code ||
      !departmentId ||
      !schedule ||
      !semesterStartDate ||
      !semesterDuration
    ) {
      throw new Error("All fields are required");
    }

    const department = await Department.findById(departmentId);
    if (!department) {
      throw new Error("Department not found");
    }

    const courseExists = await Course.findOne({ code });
    if (courseExists) {
      throw new Error("Course code already exists");
    }

    const newCourse = await Course.create({
      name,
      code,
      teacher: req.user._id,
      schedule,
      semesterStartDate,
      semesterDuration,
    });

    department.courses.push(newCourse._id);
    await department.save();

    res.status(201).json({
      message: "Course created successfully",
      course: newCourse,
    });
  })
);
courseRouter.get("/teacher", auth, async (req, res) => {
  try {
    // Find all courses where the teacher is the logged-in user
    const courses = await Course.find({ teacher: req.user._id });

    if (!courses || courses.length === 0) {
      return res
        .status(404)
        .json({ message: "No courses found for this teacher." });
    }

    // Return the courses
    res.status(200).json(courses);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error, unable to fetch courses." });
  }
});

courseRouter.get("/courses-by-teacher", auth, isTeacher, async (req, res) => {
  try {
    const teacherId = req.user._id; // Get the teacher ID from the authenticated user

    // Fetch courses taught by the teacher
    const courses = await Course.find({ teacher: teacherId });

    // Prepare report for each course with grouped attendance data by lecture date
    const reportPromises = courses.map(async (course) => {
      const attendanceData = await Attendance.aggregate([
        { $match: { course: course._id, teacher: teacherId } }, // Filter by course and teacher
        {
          $group: {
            _id: {
              lectureDate: "$lectureDate",
              status: "$status",
            },
            count: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: "$_id.lectureDate",
            presentCount: {
              $sum: {
                $cond: [{ $eq: ["$_id.status", "present"] }, "$count", 0],
              },
            },
            absentCount: {
              $sum: {
                $cond: [{ $eq: ["$_id.status", "absent"] }, "$count", 0],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            lectureDate: "$_id",
            presentCount: 1,
            absentCount: 1,
          },
        },
        { $sort: { lectureDate: 1 } }, // Sort by lecture date
      ]);

      return {
        courseName: course.name,
        courseCode: course.code,
        totalStudents: course.students.length,
        attendanceByDate: attendanceData, // Present and absent counts by date
      };
    });

    const report = await Promise.all(reportPromises);

    res.json({ success: true, report });
  } catch (error) {
    console.error("Error fetching courses and attendance", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

// Fetch All Courses (Admin, Teachers, or Students)
courseRouter.get(
  "/",
  auth,
  asyncHandler(async (req, res) => {
    let courses;

    if (req.user.role === "admin") {
      courses = await Course.find().populate("teacher students department");
    } else if (req.user.role === "teacher") {
      courses = await Course.find({ teacher: req.user._id }).populate(
        "students department"
      );
    } else if (req.user.role === "student") {
      courses = await Course.find({ students: req.user._id }).populate(
        "teacher department"
      );
    }

    if (!courses || courses.length === 0) {
      return res.status(404).json({ error: "No courses found" });
    }

    res.json(courses);
  })
);

// Fetch Courses by Department
courseRouter.get(
  "/department/:departmentId",
  auth,
  asyncHandler(async (req, res) => {
    const { departmentId } = req.params;

    const courses = await Course.find({ department: departmentId }).populate(
      "teacher students"
    );
    if (!courses || courses.length === 0) {
      throw new Error("No courses found for this department");
    }

    res.json(courses);
  })
);

// Register Student for Courses (Based on Department)
courseRouter.post(
  "/register",
  auth,
  asyncHandler(async (req, res) => {
    const { departmentId } = req.body;

    if (!departmentId) {
      throw new Error("Department ID is required");
    }

    const department = await Department.findById(departmentId).populate(
      "courses"
    );
    if (!department) {
      throw new Error("Department not found");
    }

    // Register the student for all courses in the selected department
    for (const course of department.courses) {
      const courseData = await Course.findById(course._id);
      if (!courseData.students.includes(req.user._id)) {
        courseData.students.push(req.user._id);
        await courseData.save();
      }
    }

    req.user.courses = department.courses.map((course) => course._id);
    await req.user.save();

    res.json({
      message: "Courses registered successfully",
      courses: department.courses,
    });
  })
);

// Update Course Information
courseRouter.put(
  "/update/:courseId",
  auth,
  isTeacher,
  asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const { name, schedule, semesterStartDate, semesterDuration } = req.body;

    const course = await Course.findById(courseId);
    if (!course) {
      throw new Error("Course not found");
    }

    if (
      course.teacher.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      throw new Error("Not authorized to update this course");
    }

    course.name = name || course.name;
    course.schedule = schedule || course.schedule;
    course.semesterStartDate = semesterStartDate || course.semesterStartDate;
    course.semesterDuration = semesterDuration || course.semesterDuration;

    const updatedCourse = await course.save();
    res.json(updatedCourse);
  })
);

// Delete Course
courseRouter.delete(
  "/delete/:courseId",
  auth,
  isTeacher,
  asyncHandler(async (req, res) => {
    const { courseId } = req.params;

    const course = await Course.findById(courseId);
    if (!course) {
      throw new Error("Course not found");
    }

    if (
      course.teacher.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      throw new Error("Not authorized to delete this course");
    }

    await course.remove();
    res.json({ message: "Course deleted successfully" });
  })
);

export default courseRouter;
