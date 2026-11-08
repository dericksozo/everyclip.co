'use strict';

const fs = require('fs');
const path = require('path');
const {
  EXPORT_DIR,
  state,
  save,
  saveNow,
  jobById,
  videoById,
  removeJobRecord,
} = require('./store');
const { runFfmpeg } = require('./media');

const queue = [];
let active = null; // { jobId, child, canceled }

const FORMATS = new Set(['mp4', 'webm', 'gif']);
const QUALITIES = new Set(['original', 1080, 720, 480, 360]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function evenFloor(value) {
  return Math.max(0, Math.floor(value / 2) * 2);
}

function evenSize(value) {
  return Math.max(2, evenFloor(value));
}

function cropPixels(crop, video) {
  const width = video.width;
  const height = video.height;
  const nx = clamp(Number(crop?.x) || 0, 0, 1);
  const ny = clamp(Number(crop?.y) || 0, 0, 1);
  const nw = clamp(Number(crop?.w) || 1, 0.002, 1 - nx);
  const nh = clamp(Number(crop?.h) || 1, 0.002, 1 - ny);

  let w = evenSize(Math.round(nw * width));
  let h = evenSize(Math.round(nh * height));
  w = Math.min(w, evenSize(width));
  h = Math.min(h, evenSize(height));

  let x = Math.round(nx * width);
  let y = Math.round(ny * height);
  x = clamp(x, 0, Math.max(0, width - w));
  y = clamp(y, 0, Math.max(0, height - h));
  x = evenFloor(x);
  y = evenFloor(y);
  if (x + w > width) x = Math.max(0, evenFloor(width - w));
  if (y + h > height) y = Math.max(0, evenFloor(height - h));

  return { x, y, w, h };
}

function outputSize(cropRect, quality, format) {
  let targetWidth = cropRect.w;
  let targetHeight = cropRect.h;

  if (format === 'gif') {
    // Keep GIFs shareable: fit within a 480px box.
    const scale = Math.min(1, 480 / Math.max(targetWidth, targetHeight));
    targetWidth *= scale;
    targetHeight *= scale;
  } else if (quality !== 'original') {
    const cap = Number(quality);
    if (Number.isFinite(cap) && cap > 0) {
      const shortSide = Math.min(targetWidth, targetHeight);
      if (shortSide > cap) {
        const scale = cap / shortSide;
        targetWidth *= scale;
        targetHeight *= scale;
      }
    }
  }

  return {
    width: Math.max(2, evenSize(Math.round(targetWidth))),
    height: Math.max(2, evenSize(Math.round(targetHeight))),
  };
}

function sanitizeName(name, ext) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80);
  return `${cleaned || 'clip'}.${ext}`;
}

function buildFfmpegArgs(job, video, outputPath) {
  const crop = cropPixels(job.crop, video);
  const size = outputSize(crop, job.quality, job.format);
  const start = clamp(Number(job.start) || 0, 0, Math.max(0, video.duration - 0.05));
  const duration = clamp(
    Number(job.duration) || 0,
    0.05,
    Math.max(0.05, video.duration - start)
  );

  const needsScale = size.width !== crop.w || size.height !== crop.h;
  const baseFilter = `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}${
    needsScale ? `,scale=${size.width}:${size.height}` : ''
  }`;

  const common = [
    '-y',
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    start.toFixed(3),
    '-i',
    video.sourcePath,
    '-t',
    duration.toFixed(3),
    '-map_metadata',
    '-1',
    '-progress',
    'pipe:1',
    '-nostats',
  ];

  let args;
  if (job.format === 'gif') {
    const filterComplex =
      `[0:v]${baseFilter},fps=15,split[gifA][gifB];` +
      `[gifA]palettegen=max_colors=128:stats_mode=full[palette];` +
      `[gifB][palette]paletteuse=dither=sierra2_4a[out]`;
    args = [
      ...common,
      '-filter_complex',
      filterComplex,
      '-map',
      '[out]',
      '-an',
      '-loop',
      '0',
      outputPath,
    ];
  } else if (job.format === 'webm') {
    args = [
      ...common,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      baseFilter,
      '-c:v',
      'libvpx-vp9',
      '-crf',
      '32',
      '-b:v',
      '0',
      '-row-mt',
      '1',
      '-deadline',
      'good',
      '-cpu-used',
      '3',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'libopus',
      '-b:a',
      '128k',
      outputPath,
    ];
  } else {
    args = [
      ...common,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      baseFilter,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-movflags',
      '+faststart',
      '-max_muxing_queue_size',
      '1024',
      outputPath,
    ];
  }

  return {
    args,
    crop,
    size,
    start,
    duration,
    ext: job.format === 'gif' ? 'gif' : job.format === 'webm' ? 'webm' : 'mp4',
  };
}

function friendlyError(message) {
  const text = String(message || '').trim();
  if (!text) return 'The export failed unexpectedly.';
  const useful = text
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('frame=') && !line.startsWith('size='))
    .slice(-6)
    .join(' ');
  return useful.slice(0, 600) || 'The export failed unexpectedly.';
}

function pump() {
  if (active) return;

  while (queue.length) {
    const jobId = queue.shift();
    const job = jobById(jobId);
    if (!job || job.status !== 'queued') continue;
    const video = videoById(job.videoId);
    if (!video) {
      job.status = 'error';
      job.error = 'The source video is missing.';
      save();
      continue;
    }
    runJob(job, video);
    return;
  }
}

async function runJob(job, video) {
  const context = { jobId: job.id, child: null, canceled: false };
  active = context;

  let built;
  try {
    built = buildFfmpegArgs(job, video, '');
  } catch (error) {
    job.status = 'error';
    job.error = friendlyError(error.message);
    active = null;
    saveNow();
    pump();
    return;
  }

  const internalName = `${job.id}.${built.ext}`;
  const outputPath = path.join(EXPORT_DIR, internalName);

  job.status = 'processing';
  job.progress = 0;
  job.startedAt = new Date().toISOString();
  job.completedAt = null;
  job.error = null;
  job.fileName = internalName;
  job.downloadName = sanitizeName(job.clipName, built.ext);
  job.outputWidth = built.size.width;
  job.outputHeight = built.size.height;
  job.cropPixels = built.crop;
  save();

  try {
    const ffmpegArgs = buildFfmpegArgs(job, video, outputPath).args;
    await runFfmpeg(ffmpegArgs, {
      onSpawn: (child) => {
        context.child = child;
        if (context.canceled) child.kill('SIGTERM');
      },
      onProgress: (seconds) => {
        if (context.canceled || !job.duration) return;
        const progress = Math.min(99, Math.round((seconds / job.duration) * 100));
        if (progress > job.progress) job.progress = Math.max(1, progress);
      },
    });

    if (context.canceled) return;

    let fileSize = 0;
    try {
      fileSize = fs.statSync(outputPath).size;
    } catch {
      /* ignore */
    }
    job.status = 'done';
    job.progress = 100;
    job.completedAt = new Date().toISOString();
    job.fileSize = fileSize;
    saveNow();
  } catch (error) {
    try {
      fs.unlinkSync(outputPath);
    } catch {
      /* ignore */
    }
    if (!context.canceled) {
      job.status = 'error';
      job.progress = 0;
      job.error = friendlyError(error.stderr || error.message);
      job.completedAt = null;
      console.warn(`[export ${job.id}]`, job.error);
      saveNow();
    }
  } finally {
    if (active === context) active = null;
    pump();
  }
}

function enqueueJobs(jobs) {
  for (const job of jobs) {
    if (!job || job.status !== 'queued') continue;
    if (!queue.includes(job.id)) queue.push(job.id);
  }
  save();
  pump();
}

function removeJob(jobId) {
  const job = jobById(jobId);
  if (!job) return false;

  if (active && active.jobId === jobId) {
    active.canceled = true;
    if (active.child) active.child.kill('SIGTERM');
  }
  const queueIndex = queue.indexOf(jobId);
  if (queueIndex !== -1) queue.splice(queueIndex, 1);

  if (job.fileName) {
    try {
      fs.unlinkSync(path.join(EXPORT_DIR, job.fileName));
    } catch {
      /* ignore */
    }
  }
  removeJobRecord(jobId);
  saveNow();
  return true;
}

function removeJobsForVideo(videoId) {
  const ids = state.jobs
    .filter((job) => job.videoId === videoId)
    .map((job) => job.id);
  for (const id of ids) removeJob(id);
}

function requeuePending() {
  const pending = state.jobs.filter((job) => job.status === 'queued');
  if (pending.length) {
    console.log(`[export] resuming ${pending.length} queued export(s)`);
    enqueueJobs(pending);
  }
}

function shutdown() {
  if (active) {
    const job = jobById(active.jobId);
    if (job && job.status === 'processing') {
      job.status = 'queued';
      job.progress = 0;
    }
    active.canceled = true;
    if (active.child) active.child.kill('SIGTERM');
  }
  saveNow();
}

function isQuality(value) {
  return value === 'original' || QUALITIES.has(Number(value));
}

function normalizeFormat(value) {
  const format = String(value || 'mp4').toLowerCase();
  return FORMATS.has(format) ? format : 'mp4';
}

function normalizeQuality(value) {
  if (isQuality(value)) {
    return value === 'original' ? 'original' : Number(value);
  }
  return 'original';
}

module.exports = {
  enqueueJobs,
  removeJob,
  removeJobsForVideo,
  requeuePending,
  shutdown,
  cropPixels,
  normalizeFormat,
  normalizeQuality,
  sanitizeName,
  activeJobId: () => active?.jobId || null,
};
