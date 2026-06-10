const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/skripsiConsultation.controller");

// Student routes
router.post("/skripsi-consultations/:skripsiId/init", auth, c.initKartu);
router.get("/skripsi-consultations/:skripsiId", auth, c.getMyDetail);
router.post("/skripsi-consultations/:skripsiId/submissions", auth, c.submitMyChapter);
router.get("/skripsi-consultations/:skripsiId/kartu/final", auth, c.getFinalKartuFile);
router.get("/skripsi-consultations/:skripsiId/kartu/preview-docx", auth, c.previewKartuDocx);

// File download routes
router.get("/skripsi-consultations/submissions/:submissionId/file", auth, c.getSubmissionFile);
router.get("/skripsi-consultations/reviews/:reviewId/file", auth, c.getReviewFile);

// Lecturer routes
router.get("/lecturer/skripsi-consultations", auth, c.listMySupervisedConsultations);
router.get("/lecturer/skripsi-consultations/:stageId", auth, c.getLecturerStageDetail);
router.post("/lecturer/skripsi-consultations/:stageId/reviews", auth, c.reviewStageByLecturer);

// Kaprodi routes
router.get("/kaprodi/skripsi-consultations", auth, c.listForKaprodi);
router.get("/kaprodi/skripsi-consultations/:skripsiId", auth, c.getDetailForKaprodi);

module.exports = router;
