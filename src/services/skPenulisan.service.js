const { JENIS } = require("./sidangScope.service");
const { assertSignatures, getStaffSignature } = require("../utils/signature");
const {
  generateHalamanPersetujuanJudulDesainSkripsiFTI,
} = require("./generateHalamanPersetujuanJudulDesainSkripsiFTI.js");

// The first SK (pengajuan_sk_penelitian) is "SK Penulisan Proposal" for a Bisnis Digital student in
// Seminar Bisnis Digital and "SK Penulisan Skripsi" for everyone else. jenis_sk is only set at VERIFY,
// so before that the student's tahap_tugas_akhir decides.
function skPenulisanName(jenis) {
  return jenis === JENIS.SEMINAR_BISNIS_DIGITAL
    ? "SK Penulisan Proposal"
    : "SK Penulisan Skripsi";
}

async function getSkPenulisanNameForOutline(queryable, outlineId) {
  const [[row]] = await queryable.query(
    `SELECT sk.jenis_sk, m.tahap_tugas_akhir
     FROM outline o
     JOIN mahasiswa m ON m.npm = o.npm
     LEFT JOIN pengajuan_sk_penelitian sk ON sk.outline_id = o.id
     WHERE o.id = ? LIMIT 1`,
    [outlineId],
  );
  return skPenulisanName(row?.jenis_sk ?? row?.tahap_tugas_akhir);
}

function buildStudentFileName(npm, namaMahasiswa, suffix) {
  const clean = (value) =>
    String(value ?? "")
      .trim()
      .replace(/[/\\:*?"<>|]+/g, "_");
  return `${clean(npm)} - ${clean(namaMahasiswa)} - ${suffix}.pdf`;
}

// Halaman Persetujuan Judul Desain Skripsi for an outline, ready to store as HALAMAN_PERSETUJUAN.
// Blocking on all 4 signatures: the file is auto-verified and required for SK VERIFY, and it can't be
// requested again, so it must not be generated without them. Dosen signatures come from SIMIKO.
async function generateHalamanPersetujuanFile(conn, outlineId) {
  const [[row]] = await conn.query(
    `SELECT o.npm, o.judul, o.pembimbing1_nidn, o.pembimbing2_nidn,
            ps.nama AS program_studi_nama, ps.kaprodi_staff_usr_id,
            COALESCE(staf.nama, dk.nama) AS kaprodi_nama,
            m.nama AS nama_mahasiswa,
            d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama
     FROM outline o
     JOIN mahasiswa m ON m.npm = o.npm
     JOIN program_studi ps ON ps.id = o.program_studi_id
     LEFT JOIN staf ON staf.usr_id = ps.kaprodi_staff_usr_id
     LEFT JOIN dosen dk ON dk.nidn = ps.kaprodi_nidn
     LEFT JOIN dosen d1 ON d1.nidn = o.pembimbing1_nidn
     LEFT JOIN dosen d2 ON d2.nidn = o.pembimbing2_nidn
     WHERE o.id = ? LIMIT 1`,
    [outlineId],
  );
  if (!row) {
    throw Object.assign(new Error("Outline tidak ditemukan"), { statusCode: 404 });
  }

  const [[mahasiswaUser]] = await conn.query(
    `SELECT signature_image FROM users WHERE npm = ? LIMIT 1`,
    [row.npm],
  );
  const dosenSignature = async (nidn) => {
    if (!nidn) return null;
    const [[dosen]] = await conn.query(
      `SELECT dsnTtd AS signature_image FROM widya_miko.m_dosen WHERE dsnId = ? LIMIT 1`,
      [nidn],
    );
    return dosen?.signature_image ?? null;
  };
  const mahasiswaSignature = mahasiswaUser?.signature_image ?? null;
  const pembimbing1Signature = await dosenSignature(row.pembimbing1_nidn);
  const pembimbing2Signature = await dosenSignature(row.pembimbing2_nidn);
  const kaprodiSignature = await getStaffSignature(conn, row.kaprodi_staff_usr_id);

  assertSignatures([
    { role: "Mahasiswa", nama: row.nama_mahasiswa, signatureImage: mahasiswaSignature },
    { role: "Pembimbing 2", nama: row.pembimbing2_nama, signatureImage: pembimbing2Signature },
    { role: "Pembimbing 1", nama: row.pembimbing1_nama, signatureImage: pembimbing1Signature },
    { role: "Kaprodi", nama: row.kaprodi_nama, signatureImage: kaprodiSignature },
  ]);

  const buffer = await generateHalamanPersetujuanJudulDesainSkripsiFTI({
    mahasiswa: {
      nama: row.nama_mahasiswa ?? "",
      npm: row.npm,
      signatureBase64: mahasiswaSignature,
    },
    pembimbing: {
      pertama: { nama: row.pembimbing1_nama ?? "", signatureBase64: pembimbing1Signature },
      kedua: { nama: row.pembimbing2_nama ?? "", signatureBase64: pembimbing2Signature },
    },
    ketuaProgramStudi: { nama: row.kaprodi_nama ?? "", signatureBase64: kaprodiSignature },
    programStudi: row.program_studi_nama ?? "",
    judulSkripsi: row.judul ?? "",
    tahun: String(new Date().getFullYear()),
  });

  return {
    fileName: buildStudentFileName(row.npm, row.nama_mahasiswa, "Halaman Persetujuan Judul"),
    mimeType: "application/pdf",
    content: Buffer.from(buffer).toString("base64"),
  };
}

module.exports = {
  skPenulisanName,
  getSkPenulisanNameForOutline,
  buildStudentFileName,
  generateHalamanPersetujuanFile,
};
