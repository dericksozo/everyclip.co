'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const dataDirEnv =
  process.env.EVERYCLIP_DATA_DIR || process.env.MULTICROP_DATA_DIR;
const DATA_DIR = dataDirEnv
  ? path.resolve(dataDirEnv)
  : path.join(ROOT, 'data');

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const EXPORT_DIR = path.join(DATA_DIR, 'exports');
const POSTER_DIR = path.join(DATA_DIR, 'posters');
const STATE_PATH = path.join(DATA_DIR, 'state.json');

for (const dir of [DATA_DIR, UPLOAD_DIR, EXPORT_DIR, POSTER_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const state = {
  version: 1,
  videos: [],
  jobs: [],
};

function newId(bytes = 6) {
  return crypto.randomBytes(bytes).toString('hex');
}

function load() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.videos)) state.videos = parsed.videos;
    if (Array.isArray(parsed.jobs)) state.jobs = parsed.jobs;
  } catch {
    // First run or a corrupt state file: start fresh.
  }

  // Drop videos whose source file no longer exists.
  state.videos = state.videos.filter((video) =>
    fs.existsSync(path.join(UPLOAD_DIR, video.fileName))
  );
  const videoIds = new Set(state.videos.map((video) => video.id));

  for (const video of state.videos) {
    // Paths are relative to the data directory; keep them portable if the
    // project folder is moved.
    video.sourcePath = path.join(UPLOAD_DIR, video.fileName);
    if (video.proxyStatus === 'processing') {
      video.proxyStatus = 'none';
      video.proxyProgress = 0;
      try {
        if (video.proxyFile) fs.unlinkSync(path.join(UPLOAD_DIR, video.proxyFile));
      } catch {
        /* ignore */
      }
      video.proxyFile = null;
    }
    if (video.posterFile && !fs.existsSync(path.join(POSTER_DIR, video.posterFile))) {
      video.posterFile = null;
    }
    if (
      video.proxyStatus === 'ready' &&
      (!video.proxyFile || !fs.existsSync(path.join(UPLOAD_DIR, video.proxyFile)))
    ) {
      video.proxyStatus = 'none';
      video.proxyFile = null;
    }
  }

  state.jobs = state.jobs.filter((job) => videoIds.has(job.videoId));

  for (const job of state.jobs) {
    if (job.status === 'processing' || job.status === 'queued') {
      // Resume the queue after a restart.
      job.status = 'queued';
      job.progress = 0;
      job.startedAt = null;
      job.error = null;
    } else if (job.status === 'done') {
      const output = path.join(EXPORT_DIR, job.fileName || '');
      if (!job.fileName || !fs.existsSync(output)) {
        job.status = 'error';
        job.error = 'The exported file is no longer available.';
        job.progress = 0;
      }
    }
  }
}

let saveTimer = null;
function saveNow() {
  try {
    const tmp = `${STATE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_PATH);
  } catch (error) {
    console.error('[state] failed to save:', error.message);
  }
}

function save() {
  // Coalesce rapid updates (progress is intentionally not persisted).
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 80);
}

function videoById(id) {
  return state.videos.find((video) => video.id === id);
}

function jobById(id) {
  return state.jobs.find((job) => job.id === id);
}

function removeVideoRecord(videoId) {
  const videoIndex = state.videos.findIndex((video) => video.id === videoId);
  if (videoIndex !== -1) state.videos.splice(videoIndex, 1);
  state.jobs = state.jobs.filter((job) => job.videoId !== videoId);
}

function removeJobRecord(jobId) {
  const index = state.jobs.findIndex((job) => job.id === jobId);
  if (index !== -1) {
    const [job] = state.jobs.splice(index, 1);
    return job;
  }
  return null;
}

load();

module.exports = {
  ROOT,
  DATA_DIR,
  UPLOAD_DIR,
  EXPORT_DIR,
  POSTER_DIR,
  STATE_PATH,
  state,
  newId,
  load,
  save,
  saveNow,
  videoById,
  jobById,
  removeVideoRecord,
  removeJobRecord,
};
