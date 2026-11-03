function resolveActiveKonsultasiOutlineStage(stages, isCompleted) {
  const p2 = stages.find((s) => s.stage === "PEMBIMBING_2") ?? null;
  const p1 = stages.find((s) => s.stage === "PEMBIMBING_1") ?? null;

  if (isCompleted || p1?.current_status === "ACCEPTED") {
    return {
      activeStage: p1?.stage ?? "PEMBIMBING_1",
      activeStatus: p1?.current_status ?? "ACCEPTED",
      isCompleted: true,
      stageRow: p1,
    };
  }
  if (!p2) {
    return { activeStage: null, activeStatus: null, isCompleted: false, stageRow: null };
  }
  if (p2.current_status !== "CONTINUE") {
    return {
      activeStage: "PEMBIMBING_2",
      activeStatus: p2.current_status,
      isCompleted: false,
      stageRow: p2,
    };
  }
  if (!p1) {
    return { activeStage: null, activeStatus: null, isCompleted: false, stageRow: null };
  }
  return {
    activeStage: "PEMBIMBING_1",
    activeStatus: p1.current_status,
    isCompleted: false,
    stageRow: p1,
  };
}

const CHAPTER_ORDER = ["BAB_1", "BAB_2", "BAB_3", "BAB_4", "BAB_5"];

function resolveActiveKonsultasiSkripsiStage(stages) {
  for (const chapterGroup of CHAPTER_ORDER) {
    const p2 = stages.find((s) => s.chapter_group === chapterGroup && s.stage === "PEMBIMBING_2") ?? null;
    const p1 = stages.find((s) => s.chapter_group === chapterGroup && s.stage === "PEMBIMBING_1") ?? null;

    if (!p2) {
      return { chapterGroup: null, activeStage: null, activeStatus: null, stageRow: null };
    }
    if (p2.current_status !== "CONTINUE") {
      return { chapterGroup, activeStage: "PEMBIMBING_2", activeStatus: p2.current_status, stageRow: p2 };
    }
    if (!p1) {
      return { chapterGroup: null, activeStage: null, activeStatus: null, stageRow: null };
    }
    if (p1.current_status !== "ACCEPTED") {
      return { chapterGroup, activeStage: "PEMBIMBING_1", activeStatus: p1.current_status, stageRow: p1 };
    }
  }
  return { chapterGroup: null, activeStage: null, activeStatus: null, stageRow: null };
}

function latestByKey(rows, keyField, tieBreakField = "id") {
  const map = new Map();
  for (const row of rows) {
    const key = row[keyField];
    const existing = map.get(key);
    if (!existing || Number(row[tieBreakField]) > Number(existing[tieBreakField])) {
      map.set(key, row);
    }
  }
  return map;
}

const RPS_STAGE_ORDER = ["PENGUJI_2", "PENGUJI_1", "PEMBIMBING_2", "PEMBIMBING_1"];

function resolveActiveRevisiStage(stages, isCompleted) {
  if (isCompleted) return { activeStage: null, activeStatus: null, stageRow: null };
  for (const role of RPS_STAGE_ORDER) {
    const stage = stages.find((s) => s.signer_role === role);
    if (!stage) return { activeStage: null, activeStatus: null, stageRow: null };
    if (stage.current_status !== "APPROVED") {
      return { activeStage: role, activeStatus: stage.current_status, stageRow: stage };
    }
  }
  return { activeStage: null, activeStatus: null, stageRow: null };
}

module.exports = {
  CHAPTER_ORDER,
  RPS_STAGE_ORDER,
  latestByKey,
  resolveActiveKonsultasiOutlineStage,
  resolveActiveKonsultasiSkripsiStage,
  resolveActiveRevisiStage,
};
