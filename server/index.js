'use strict';

const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

const {
  ROOT,
  UPLOAD_DIR,
  EXPORT_DIR,
  POSTER_DIR,
  state,
  newId,
  save,
  saveNow,
  videoById,
  jobById,
  removeVideoRecord,
} = require('./store');
const { probeVideo, makePoster, makePreviewProxy } = require('./media');
const {
  enqueueJobs,
  removeJob,
  removeJobsForVideo,
  requeuePending,
  shutdown,
  normalizeFormat,
  normalizeQuality,
} = require('./exports');

const app = express();
const server = http.createServer(app);
server.requestTimeout = 0;
server.headersTimeout = 120000;

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.m4v',
  '.mov',
  '.webm',
  '.mkv',
  '.avi',
  '.ogv',
  '.ogg',
  '.mpg',
  '.mpeg',
  '.3gp',
  '.ts',
  '.mts',
  '.m2ts',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
  filename: (req, file, callback) => {
    const rawExt = path.extname(file.originalname || '').toLowerCase();
    const ext = VIDEO_EXTENSIONS.has(rawExt) ? rawExt : '.mp4';
    const id = newId(8);
    req.uploadId = id;
    callback(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024 * 1024,
    files: 1,
    fields: 10,
  },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (file.mimetype?.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) {
      callback(null, true);
      return;
    }
    callback(new Error('Please choose a video file.'));
  },
});

function serializeJob(job) {
  return {
    id: job.id,
    videoId: job.videoId,
    clipId: job.clipId,
    clipName: job.clipName,
    crop: job.crop,
    start: job.start,
    duration: job.duration,
    format: job.format,
    quality: job.quality,
    status: job.status,
    progress: job.progress || 0,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    outputWidth: job.outputWidth,
    outputHeight: job.outputHeight,
    fileSize: job.fileSize || 0,
    downloadName: job.downloadName || null,
    downloadUrl: job.status === 'done' ? `/api/exports/${job.id}/download` : null,
    error: job.error || null,
  };
}

function serializeVideo(video) {
  return {
    id: video.id,
    name: video.name,
    originalName: video.originalName,
    duration: video.duration,
    width: video.width,
    height: video.height,
    fps: video.fps,
    hasAudio: video.hasAudio,
    videoCodec: video.videoCodec,
    audioCodec: video.audioCodec,
    container: video.container,
    size: video.size,
    createdAt: video.createdAt,
    posterUrl: video.posterFile ? `/api/videos/${video.id}/poster` : null,
    streamUrl: `/api/videos/${video.id}/stream`,
    proxyStatus: video.proxyStatus || 'none',
    proxyProgress: Math.round((video.proxyProgress || 0) * 100),
    proxyError: video.proxyError || null,
    proxyUrl:
      video.proxyStatus === 'ready' ? `/api/videos/${video.id}/proxy` : null,
  };
}

function cleanDisplayName(originalName) {
  const base = path.basename(originalName || 'Untitled video');
  const withoutExtension = base.replace(/\.[^./\\]+$/, '');
  return (withoutExtension || base).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCrop(crop) {
  const nx = clamp(Number(crop?.x) || 0, 0, 0.999);
  const ny = clamp(Number(crop?.y) || 0, 0, 0.999);
  const nw = clamp(Number(crop?.w) || 1 - nx, 0.001, 1 - nx);
  const nh = clamp(Number(crop?.h) || 1 - ny, 0.001, 1 - ny);
  return { x: nx, y: ny, w: nw, h: nh };
}

function apiError(res, status, message) {
  return res.status(status).json({ error: message });
}

function filePathsForVideo(video) {
  const paths = [path.join(UPLOAD_DIR, video.fileName)];
  if (video.posterFile) paths.push(path.join(POSTER_DIR, video.posterFile));
  if (video.proxyFile) paths.push(path.join(UPLOAD_DIR, video.proxyFile));
  return paths;
}

/* ------------------------------- Uploads -------------------------------- */

app.post('/api/videos', (req, res) => {
  upload.single('video')(req, res, async (uploadError) => {
    if (uploadError) {
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        return apiError(res, 413, 'That video is larger than the 8 GB limit.');
      }
      return apiError(res, 400, uploadError.message || 'The upload failed.');
    }

    if (!req.file) {
      return apiError(res, 400, 'No video file was uploaded.');
    }

    const filePath = req.file.path;
    try {
      const metadata = await probeVideo(filePath);
      if (!metadata.duration || metadata.duration < 0.05) {
        throw new Error('This video appears to have no duration.');
      }

      const id = req.uploadId || path.parse(req.file.filename).name;
      const name = cleanDisplayName(req.file.originalname);
      const posterFile = `${id}.jpg`;
      await makePoster(
        metadata,
        filePath,
        path.join(POSTER_DIR, posterFile)
      ).catch(() => false);

      let hasPoster = false;
      try {
        hasPoster = fs.statSync(path.join(POSTER_DIR, posterFile)).size > 0;
      } catch {
        hasPoster = false;
      }

      const video = {
        id,
        name,
        originalName: req.file.originalname || 'video',
        fileName: req.file.filename,
        sourcePath: filePath,
        posterFile: hasPoster ? posterFile : null,
        size: metadata.size || req.file.size,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        codedWidth: metadata.codedWidth,
        codedHeight: metadata.codedHeight,
        rotation: metadata.rotation,
        fps: metadata.fps,
        hasAudio: metadata.hasAudio,
        videoCodec: metadata.videoCodec,
        audioCodec: metadata.audioCodec,
        container: metadata.container,
        bitrate: metadata.bitrate,
        createdAt: new Date().toISOString(),
        proxyStatus: 'none',
        proxyProgress: 0,
        proxyFile: null,
        proxyError: null,
      };

      state.videos.push(video);
      saveNow();
      res.status(201).json({ video: serializeVideo(video) });
    } catch (error) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
      return apiError(res, 422, error.message || 'Could not read this video.');
    }
  });
});

app.get('/api/videos', (_req, res) => {
  const videos = [...state.videos]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(serializeVideo);
  res.json({ videos });
});

app.get('/api/videos/:id', (req, res) => {
  const video = videoById(req.params.id);
  if (!video) return apiError(res, 404, 'Video not found.');
  res.json({ video: serializeVideo(video) });
});

app.get('/api/videos/:id/stream', (req, res) => {
  const video = videoById(req.params.id);
  if (!video) return apiError(res, 404, 'Video not found.');
  res.sendFile(video.sourcePath, {
    headers: {
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': 'inline',
    },
  });
});

app.get('/api/videos/:id/poster', (req, res) => {
  const video = videoById(req.params.id);
  if (!video || !video.posterFile) return apiError(res, 404, 'Poster not found.');
  res.sendFile(path.join(POSTER_DIR, video.posterFile), {
    headers: { 'Cache-Control': 'private, max-age=86400' },
  });
});

app.get('/api/videos/:id/proxy', (req, res) => {
  const video = videoById(req.params.id);
  if (!video || ![ 'ready', 'processing' ].includes(video.proxyStatus)) {
    return apiError(res, 404, 'Preview not available.');
  }
  if (video.proxyStatus !== 'ready' || !video.proxyFile) {
    return apiError(res, 409, 'Preview is still being prepared.');
  }
  res.sendFile(path.join(UPLOAD_DIR, video.proxyFile), {
    headers: {
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': 'inline',
    },
  });
});

app.post('/api/videos/:id/prepare', (req, res) => {
  const video = videoById(req.params.id);
  if (!video) return apiError(res, 404, 'Video not found.');

  if (video.proxyStatus === 'ready' && video.proxyFile) {
    const proxyPath = path.join(UPLOAD_DIR, video.proxyFile);
    if (fs.existsSync(proxyPath)) {
      return res.json({ video: serializeVideo(video) });
    }
    video.proxyStatus = 'none';
    video.proxyFile = null;
  }

  if (video.proxyStatus === 'processing') {
    return res.status(202).json({ video: serializeVideo(video) });
  }

  video.proxyStatus = 'processing';
  video.proxyProgress = 0;
  video.proxyError = null;
  save();

  const proxyFile = `${video.id}-preview.mp4`;
  const proxyPath = path.join(UPLOAD_DIR, proxyFile);

  makePreviewProxy(video, video.sourcePath, proxyPath, (progress) => {
    video.proxyProgress = progress;
  })
    .then(() => {
      const stillExists = videoById(video.id) === video;
      if (!stillExists) {
        try {
          fs.unlinkSync(proxyPath);
        } catch {
          /* ignore */
        }
        return;
      }
      video.proxyFile = proxyFile;
      video.proxyStatus = 'ready';
      video.proxyProgress = 1;
      video.proxyError = null;
      saveNow();
      console.log(`[proxy] ready for ${video.id}`);
    })
    .catch((error) => {
      console.warn(`[proxy] failed for ${video.id}:`, error.message);
      video.proxyStatus = 'error';
      video.proxyProgress = 0;
      video.proxyError =
        'This video could not be converted for in-browser preview. Exporting may still work.';
      saveNow();
      try {
        fs.unlinkSync(proxyPath);
      } catch {
        /* ignore */
      }
    });

  res.status(202).json({ video: serializeVideo(video) });
});

app.delete('/api/videos/:id', (req, res) => {
  const video = videoById(req.params.id);
  if (!video) return apiError(res, 404, 'Video not found.');

  removeJobsForVideo(video.id);
  for (const filePath of filePathsForVideo(video)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }
  removeVideoRecord(video.id);
  saveNow();
  res.status(204).end();
});

/* ------------------------------- Exports -------------------------------- */

app.post('/api/exports', (req, res) => {
  const { videoId, clips } = req.body || {};
  const video = videoById(videoId);
  if (!video) return apiError(res, 404, 'Video not found.');
  if (!Array.isArray(clips) || clips.length === 0) {
    return apiError(res, 400, 'Add at least one clip to export.');
  }
  if (clips.length > 60) {
    return apiError(res, 400, 'Export up to 60 clips at a time.');
  }

  const jobs = [];
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index] || {};
    const startValue = Number(clip.start);
    const durationValue = Number(clip.duration);
    if (!Number.isFinite(startValue) || !Number.isFinite(durationValue)) {
      return apiError(res, 400, `Clip ${index + 1} has an invalid time range.`);
    }
    const start = clamp(startValue, 0, Math.max(0, video.duration - 0.1));
    const duration = clamp(
      durationValue,
      0.1,
      Math.max(0.1, video.duration - start)
    );
    const name =
      String(clip.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) ||
      `Clip ${index + 1}`;

    const job = {
      id: newId(8),
      videoId: video.id,
      clipId: String(clip.clipId || ''),
      clipName: name,
      crop: normalizeCrop(clip.crop),
      start,
      duration,
      format: normalizeFormat(clip.format),
      quality: normalizeQuality(clip.quality),
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      fileName: null,
      downloadName: null,
      fileSize: 0,
      outputWidth: null,
      outputHeight: null,
      error: null,
    };
    state.jobs.push(job);
    jobs.push(job);
  }

  saveNow();
  enqueueJobs(jobs);
  res.status(202).json({ jobs: jobs.map(serializeJob) });
});

app.get('/api/exports', (req, res) => {
  const { videoId } = req.query;
  const jobs = state.jobs
    .filter((job) => !videoId || job.videoId === videoId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(serializeJob);
  res.json({ jobs });
});

app.get('/api/exports/archive', async (req, res) => {
  const video = videoById(String(req.query.videoId || ''));
  if (!video) return apiError(res, 404, 'Video not found.');

  const jobs = state.jobs
    .filter(
      (job) =>
        job.videoId === video.id &&
        job.status === 'done' &&
        job.fileName &&
        fs.existsSync(path.join(EXPORT_DIR, job.fileName))
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (jobs.length === 0) {
    return apiError(res, 404, 'There are no completed exports to download yet.');
  }

  const baseName =
    video.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 60) ||
    'everyclip';
  const asciiName = baseName.replace(/[^\x20-\x7e]/g, '').trim() || 'everyclip';
  const archiveName = `${asciiName}-clips.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${archiveName}"; filename*=UTF-8''${encodeURIComponent(
      `${baseName}-clips.zip`
    )}`
  );

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', (error) => {
    console.warn('[zip] warning:', error.message);
  });
  archive.on('error', (error) => {
    console.error('[zip] failed:', error.message);
    res.destroy(error);
  });
  archive.pipe(res);

  const usedNames = new Set();
  jobs.forEach((job, index) => {
    const ext = path.extname(job.fileName);
    let name = job.downloadName || `clip-${index + 1}${ext}`;
    let base = name.slice(0, name.length - path.extname(name).length);
    let candidate = `${String(index + 1).padStart(2, '0')} - ${base}${ext}`;
    let counter = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${String(index + 1).padStart(2, '0')} - ${base} (${counter})${ext}`;
      counter += 1;
    }
    usedNames.add(candidate.toLowerCase());
    archive.file(path.join(EXPORT_DIR, job.fileName), { name: candidate });
  });

  try {
    await archive.finalize();
  } catch (error) {
    console.error('[zip] finalize failed:', error.message);
    if (!res.headersSent) {
      return apiError(res, 500, 'Could not build the ZIP file.');
    }
    res.destroy(error);
  }
});

app.get('/api/exports/:id/download', (req, res) => {
  const job = jobById(req.params.id);
  if (!job || job.status !== 'done' || !job.fileName) {
    return apiError(res, 404, 'Export not found.');
  }
  const outputPath = path.join(EXPORT_DIR, job.fileName);
  if (!fs.existsSync(outputPath)) {
    return apiError(res, 404, 'The exported file is missing.');
  }
  res.download(outputPath, job.downloadName || `clip${path.extname(job.fileName)}`);
});

app.delete('/api/exports/:id', (req, res) => {
  const removed = removeJob(req.params.id);
  if (!removed) return apiError(res, 404, 'Export not found.');
  res.status(204).end();
});

/* -------------------------------- Misc ---------------------------------- */

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', (_req, res) => {
  apiError(res, 404, 'Not found.');
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error('[server]', error);
  if (res.headersSent) return res.destroy();
  return apiError(res, 500, 'Something went wrong on the server.');
});

/* ------------------------------- Startup -------------------------------- */

async function portIsFree(port, host) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

async function listenWithFallback(host, startPort) {
  let port = startPort;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await portIsFree(port, host)) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      return port;
    }
    port += 1;
  }
  throw new Error(`Could not find a free port starting at ${startPort}.`);
}

async function main() {
  requeuePending();

  const host = process.env.HOST || '127.0.0.1';
  const requestedPort = Number(process.env.PORT) || 3000;
  const port = await listenWithFallback(host, requestedPort);

  console.log('');
  console.log('  EVERYCLIP · local video studio');
  console.log(`  → http://localhost:${port}`);
  console.log('');
  console.log('  One video in. A batch of clips out.');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
}

let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] ${signal} received, shutting down…`);
  shutdown();
  saveNow();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

main().catch((error) => {
  console.error('[server] failed to start:', error.message);
  process.exit(1);
});
