import express from "express";
import dotenv from "dotenv";
import connectDatabase from "./Config/MongoDb.js";
import morgan from "morgan";
import cors from "cors";
import userRouter from "./Routes/Auth.js";
import attendanceRouter from "./Routes/AttendanceRoute.js";
import courseRouter from "./Routes/Course.js";
import { errorHandler, notFound } from "./Middleware/Error.js";
import departmentRouter from "./Routes/DepartmentRoute.js";

dotenv.config();

const app = express();

// const corsOptions = {
//   origin: [
//     "https://daycare-app.onrender.com",
//     "http://localhost:3000",
//     "https://daycare-admin.onrender.com",
//   ],
//   // Add other CORS options as needed
// };

app.use(cors());

app.use(morgan());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", userRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/courses", courseRouter);
app.use("/api/department", departmentRouter);

const YOUR_DOMAIN = "http://localhost:3000"; // Update the port if your frontend is running on a different port

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 1000;

const start = async () => {
  try {
    await connectDatabase(process.env.MONGO_URL);
    app.listen(PORT, console.log(`server is running on port ${PORT}.......`));
  } catch (error) {
    console.log(error);
  }
};
start();
