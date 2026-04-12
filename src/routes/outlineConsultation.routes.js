const router = require("express").Router();
const auth = require("../middlewares/auth");
const c = require("../controllers/outlineConsultation.controller");

router.post(
  "/internal/pengajuan-judul/:pengajuanJudulId/kartu-konsultasi-outline/init",
  auth,
  c.initFromApprovedPengajuan
);

router.get("/outline-consultations/me", auth, c.listMine);
router.get("/outline-consultations/me/:pengajuanJudulId", auth, c.getMyDetail);
router.post(
  "/outline-consultations/me/:pengajuanJudulId/submissions",
  auth,
  c.submitMyOutline
);
router.get(
  "/outline-consultations/me/:pengajuanJudulId/reviews",
  auth,
  c.getMyReviewHistory
);
router.get("/outline-consultations/me/:pengajuanJudulId/kartu", auth, c.getMyKartu);
router.get(
  "/outline-consultations/me/:pengajuanJudulId/kartu/final",
  auth,
  c.getMyFinalKartuFile
);

router.get("/lecturer/outline-consultations", auth, c.listAssignedToLecturer);
router.get(
  "/test-kartu-konsultasi-outline-docx",
  auth,
  c.testKartuKonsultasiOutlineDocx
);
router.get(
  "/lecturer/outline-consultations/:stageId",
  auth,
  c.getLecturerStageDetail
);
router.post(
  "/lecturer/outline-consultations/:stageId/reviews",
  auth,
  c.reviewStageByLecturer
);

router.post(
  "/outline-consultations/:pengajuanJudulId/kartu/finalize",
  auth,
  c.finalizeKartu
);
router.get(
  "/outline-consultations/:pengajuanJudulId/kartu/files",
  auth,
  c.getKartuFiles
);

module.exports = router;
