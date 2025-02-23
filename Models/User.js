import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["student", "teacher"], required: true },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: function () {
        return this.role === "student"; // Required only for students
      },
    },
    uniqueId: { type: String, unique: true, required: true },
    courses: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Course",
      },
    ],
    faceData: {
      image: {
        type: String,
        required: function () {
          return this.role === "student";
        },
      }, // Base64 or URL
      descriptors: {
        type: [Number],
        required: function () {
          return this.role === "student";
        },
      }, // Face recognition data
    },
    profilePicture: {
      type: String,
      default: "https://example.com/default-profile.png", // Placeholder URL
    },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.pre("save", async function (next) {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

const User = mongoose.model("User", userSchema);
export default User;
