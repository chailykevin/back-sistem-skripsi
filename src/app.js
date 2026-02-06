const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const healthRoutes = require("./routes/health.routes");
app.use("/health", healthRoutes);

const dbRoutes = require("./routes/db.routes");
app.use("/db", dbRoutes);

const authRoutes = require("./routes/auth.routes");
app.use("/auth", authRoutes);

const outlineRoutes = require("./routes/outline.routes");
app.use("/outlines", outlineRoutes);

const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");
app.use(notFound);
app.use(errorHandler);

module.exports = app;
