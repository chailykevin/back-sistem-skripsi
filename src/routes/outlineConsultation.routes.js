const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/outlineConsultation.controller");

router.post(
  "/internal/outline/:outlineId/kartu-konsultasi-outline/init",
  auth,
  c.initFromApprovedPengajuan,
);

router.get("/outline-consultations/me", auth, c.listMine);
router.get("/outline-consultations/me/:outlineId", auth, c.getMyDetail);
router.post(
  "/outline-consultations/me/:outlineId/submissions",
  auth,
  c.submitMyOutline,
);
router.get(
  "/outline-consultations/me/:outlineId/reviews",
  auth,
  c.getMyReviewHistory,
);
router.get(
  "/outline-consultations/me/:outlineId/kartu",
  auth,
  c.getMyKartu,
);
router.get(
  "/outline-consultations/:outlineId/kartu/final",
  auth,
  c.getMyFinalKartuFile,
);

router.get("/lecturer/outline-consultations", auth, c.listAssignedToLecturer);
router.get(
  "/lecturer/outline-consultations/monitoring",
  auth,
  c.listMySupervisedConsultations,
);
router.get("/kaprodi/outline-consultations", auth, c.listForKaprodi);
router.get(
  "/kaprodi/outline-consultations/:outlineId",
  auth,
  c.getDetailForKaprodi,
);
router.get(
  "/test-kartu-konsultasi-outline-docx",
  auth,
  c.testKartuKonsultasiOutlineDocx,
);
router.get(
  "/lecturer/outline-consultations/:stageId",
  auth,
  c.getLecturerStageDetail,
);
router.post(
  "/lecturer/outline-consultations/:stageId/reviews",
  auth,
  c.reviewStageByLecturer,
);

router.post(
  "/outline-consultations/:outlineId/kartu/finalize",
  auth,
  c.finalizeKartu,
);
router.get(
  "/outline-consultations/:outlineId/kartu/preview-docx",
  auth,
  c.previewKartuDocx,
);
router.get(
  "/outline-consultations/:outlineId/kartu/files",
  auth,
  c.getKartuFiles,
);

module.exports = router;
