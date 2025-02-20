import express from "express";

import asyncHandler from "express-async-handler";
import Department from "../Models/Department.js";

const departmentRouter = express.Router();

// Route to fetch all departments
departmentRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const departments = await Department.find();
    res.status(200).json(departments);
  })
);
departmentRouter.post(
  "/create",
  asyncHandler(async (req, res) => {
    const { name } = req.body;

    // Validate that the department name is provided
    if (!name) {
      return res.status(400).json({ message: "Department name is required." });
    }

    try {
      // Create a new department with the provided name and empty courses array
      const department = new Department({
        name,
        courses: [], // Initially set the courses array to be empty
      });

      // Save the department to the database
      await department.save();

      res.status(201).json({
        message: "Department created successfully",
        department,
      });
    } catch (err) {
      res
        .status(500)
        .json({ message: "Error creating department", error: err.message });
    }
  })
);




export default departmentRouter;
