const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

const healthRoutes = require("./routes/health.routes");
app.use("/health", healthRoutes);

const dbRoutes = require("./routes/db.routes");
app.use("/db", dbRoutes);

const authRoutes = require("./routes/auth.routes");
app.use("/auth", authRoutes);

const outlineRoutes = require("./routes/outline.routes");
app.use("/outlines", outlineRoutes);

const titleSubmission = require("./routes/titleSubmission.routes");
app.use("/title-submissions", titleSubmission);

const dosenRoutes = require("./routes/dosen.routes");
app.use("/dosen", dosenRoutes);

const programStudiRoutes = require("./routes/programStudi.routes");
app.use("/program-studi", programStudiRoutes);

const usersRoutes = require("./routes/users.routes");
app.use("/users", usersRoutes);

const dummyIntegrationRoutes = require("./routes/dummyIntegration.routes");
app.use("/dummy-integration", dummyIntegrationRoutes);

const outlineSubmissionPeriodRoutes = require("./routes/outlineSubmissionPeriod.routes");
app.use("/outline-submission-period", outlineSubmissionPeriodRoutes);

const halamanPersetujuanRoutes = require("./routes/halamanPersetujuan.routes");
app.use("/", halamanPersetujuanRoutes);

const skPenelitianRoutes = require("./routes/skPenelitian.routes");
app.use("/", skPenelitianRoutes);

const outlineConsultationRoutes = require("./routes/outlineConsultation.routes");
app.use("/", outlineConsultationRoutes);

const skripsiConsultationRoutes = require("./routes/skripsiConsultation.routes");
app.use("/", skripsiConsultationRoutes);

const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");
app.use(notFound);
app.use(errorHandler);

module.exports = app;
