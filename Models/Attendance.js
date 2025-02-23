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
    status: {
      type: String,
      enum: ["present", "absent", "pending"],
      default: "pending",
    },
    lectureDate: { type: Date, required: true },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    faceData: {
      image: { type: String },
      descriptors: { type: [Number] },
    },
    verificationMethod: {
      type: String,
      enum: ["face", "manual"],
    },
    verifiedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

const Attendance = mongoose.model("Attendance", attendanceSchema);
export default Attendance;
