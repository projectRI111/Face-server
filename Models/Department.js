import mongoose from "mongoose";

// Define the schema for the Department model
const departmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    courses: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Course",
      },
    ],
  },
  { timestamps: true }
);

// Check if the model already exists in mongoose.models
const Department =
  mongoose.models.Department || mongoose.model("Department", departmentSchema);

export default Department;
