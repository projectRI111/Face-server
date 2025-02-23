import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import User from "../Models/User.js";
import Department from "../Models/Department.js";
import Course from "../Models/Course.js";
import { auth } from "../Middleware/AuthMiddleware.js";

const userRouter = express.Router();

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// Generate Unique ID for Students and Teachers
const generateUniqueId = (role) => {
  const prefix = role === "student" ? "B" : "S"; // B for students, S for teachers
  const uniqueNumber = Math.floor(10000 + Math.random() * 90000); // Generate a 5-digit number
  return `${prefix}${uniqueNumber}`;
};

// Register User (Student or Teacher)
userRouter.post(
  "/register",
  asyncHandler(async (req, res, next) => {
    try {
      const {
        firstName,
        lastName,
        email,
        password,
        role,
        departmentId,
        faceData,
      } = req.body;

      // Validate required fields
      if (!firstName || !lastName || !email || !password || !role) {
        return res
          .status(400)
          .json({ message: "Please fill all required fields." });
      }

      // Ensure faceData is provided for students
      if (
        role === "student" &&
        (!faceData || !faceData.image || !faceData.descriptors)
      ) {
        return res
          .status(400)
          .json({ message: "Face data is required for student registration." });
      }

      // Check if the user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: "User already exists." });
      }

      // Generate a unique ID based on role
      const uniqueId = generateUniqueId(role);

      // Create a new user
      const newUser = new User({
        firstName,
        lastName,
        email,
        password,
        role,
        uniqueId,
        department: departmentId || null,
        courses: [], // Empty course array for students initially
        faceData: role === "student" ? faceData : undefined, // Store faceData only for students
      });

      // If the user is a student, assign courses from the department
      if (role === "student" && departmentId) {
        const department = await Department.findById(departmentId).populate(
          "courses"
        );

        if (!department) {
          return res.status(400).json({ message: "Invalid department." });
        }

        // Enroll the student in all department courses
        newUser.courses = department.courses.map((course) => course._id);

        await Promise.all(
          department.courses.map((course) =>
            Course.findByIdAndUpdate(course._id, {
              $addToSet: { students: newUser._id },
            })
          )
        );
      }

      // Save the user
      const createdUser = await newUser.save();

      // Send response
      res.status(201).json({
        _id: createdUser._id,
        firstName: createdUser.firstName,
        lastName: createdUser.lastName,
        email: createdUser.email,
        role: createdUser.role,
        uniqueId: createdUser.uniqueId,
        faceData: createdUser.faceData,
        token: generateToken(createdUser._id),
      });
    } catch (error) {
      next(error); // Pass errors to global error handler
    }
  })
);

// Login User
userRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    // Ensure the email and password are provided
    if (!email || !password) {
      res.status(400);
      throw new Error("Please fill all fields.");
    }

    // Log the email and password to verify they are correct
    console.log("Email:", email);
    console.log("Password:", password);

    // Find the user by email
    const user = await User.findOne({ email });

    // Check if the user exists and the password is correct
    if (user) {
      const passwordMatch = await bcrypt.compare(password, user.password);
      console.log("Password Match:", passwordMatch); // Log password comparison result

      if (passwordMatch) {
        res.json({
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          uniqueId: user.uniqueId,
          token: generateToken(user._id),
        });
      } else {
        res.status(401);
        throw new Error("Invalid credentials.");
      }
    } else {
      res.status(401);
      throw new Error("Invalid credentials.");
    }
  })
);

// Get Current User Profile

userRouter.get(
  "/profile",
  auth, // Ensure the user is authenticated
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id)
      .populate("department courses")
      .select("-password");
    if (user) {
      res.json(user);
    } else {
      res.status(404);
      throw new Error("User not found.");
    }
  })
);
// Update User Profile
userRouter.put(
  "/profile",
  auth, // Ensure the user is authenticated
  asyncHandler(async (req, res) => {
    const { firstName, lastName, email, password, department, role, uniqueId } =
      req.body;

    const user = await User.findById(req.user._id);

    if (user) {
      user.firstName = firstName || user.firstName;
      user.lastName = lastName || user.lastName;
      user.email = email || user.email;
      user.department = department || user.department;
      user.role = role || user.role;
      user.uniqueId = uniqueId || user.uniqueId;

      // If password is provided, hash it
      if (password) {
        user.password = password;
      }

      const updatedUser = await user.save();
      res.json({
        _id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        department: updatedUser.department,
        role: updatedUser.role,
        uniqueId: updatedUser.uniqueId,
      });
    } else {
      res.status(404);
      throw new Error("User not found.");
    }
  })
);

export default userRouter;
