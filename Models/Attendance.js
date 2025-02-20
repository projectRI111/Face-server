import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AttendanceSession",
      required: true,
    },
    lectureDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["pending", "present", "absent", "late"],
      required: true,
      default: "pending", // Default to pending status when a session is created
    },
    markedAt: {
      type: Date,
      default: null, // Set to null until a student is marked as present or absent
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Assuming the teacher is a User model
    //   required: true,
    },
  },
  { timestamps: true }
);

const Attendance = mongoose.model("Attendance", attendanceSchema);
export default Attendance;
