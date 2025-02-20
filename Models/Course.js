import mongoose from "mongoose";

const courseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    schedule: [
      {
        day: { type: String, required: true },
        startTime: { type: String, required: true }, // Ensure Date type
        endTime: { type: String, required: true }, // Ensure Date type
      },
    ],
    semesterStartDate: { type: Date, required: true },
    semesterDuration: { type: Number, required: true }, // in months
  },
  { timestamps: true }
);

const Course = mongoose.model("Course", courseSchema);
export default Course;
