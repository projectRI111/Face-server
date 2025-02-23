import mongoose from "mongoose";

const AttendanceSessionSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true,
  },
  qrCode: { type: String },
  lectureDate: { type: Date, required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  sessionIdentifier: { type: String, required: true }, // Add this field
});

const AttendanceSession = mongoose.model(
  "AttendanceSession",
  AttendanceSessionSchema
);

export default AttendanceSession;

