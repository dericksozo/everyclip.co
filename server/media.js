'use strict';

const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const ffmpegPath = require('ffmpeg-static');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

const execFileAsync = promisify(execFile);

function stderrTail(text, limit = 1600) {
  const trimmed = text.trim();
  return trimmed.length > limit ? trimmed.slice(-limit) : trimmed;
}

/**
 * Spawn ffmpeg and report progress by parsed -progress output.
 */
function runFfmpeg(args, options = {}) {
  const { onProgress, onSpawn, timeoutMs = 0 } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    onSpawn?.(child);

    let stdoutBuffer = '';
    let stderr = '';
    let killedByTimeout = false;

    const timer = timeoutMs
      ? setTimeout(() => {
          killedByTimeout = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;

    function parseChunk(chunk) {
      if (!onProgress) return;
      stdoutBuffer += chunk.toString();
      let newline;
      while ((newline = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        let seconds = null;
        const micros = /^out_time_(?:us|ms)=(-?\d+)$/.exec(line);
        if (micros) seconds = Number(micros[1]) / 1e6;
        if (!Number.isFinite(seconds) && line.startsWith('out_time=')) {
          const value = line.slice('out_time='.length);
          const parts = value.split(':');
          if (parts.length === 3) {
            const parsed =
              Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
            if (Number.isFinite(parsed)) seconds = parsed;
          }
        }
        if (Number.isFinite(seconds) && seconds >= 0) {
          onProgress(seconds);
        }
      }
    }

    child.stdout.on('data', parseChunk);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-8000);
    });

    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ stderr });
        return;
      }
      const reason = killedByTimeout
        ? 'Video processing timed out.'
        : stderrTail(stderr) || `ffmpeg exited with code ${code}${signal ? ` (${signal})` : ''}`;
      const error = new Error(reason);
      error.code = code;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function parseFps(value) {
  if (!value || typeof value !== 'string') return 0;
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : 0;
}

function getRotation(videoStream) {
  let rotation = 0;
  if (Array.isArray(videoStream.side_data_list)) {
    const side = videoStream.side_data_list.find(
      (entry) => entry && Number.isFinite(Number(entry.rotation))
    );
    if (side) rotation = Number(side.rotation);
  }
  if (!rotation && videoStream.tags && videoStream.tags.rotate) {
    rotation = Number(videoStream.tags.rotate);
  }
  if (!Number.isFinite(rotation)) rotation = 0;
  rotation = ((Math.round(rotation) % 360) + 360) % 360;
  return rotation;
}

async function probeVideo(filePath) {
  let stdout;
  try {
    const result = await execFileAsync(
      ffprobeInstaller.path,
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      { maxBuffer: 20 * 1024 * 1024 }
    );
    stdout = result.stdout;
  } catch (error) {
    const detail = stderrTail(error.stderr || error.message || 'Unknown error');
    throw new Error(`Could not read this video. ${detail}`);
  }

  let info;
  try {
    info = JSON.parse(stdout);
  } catch {
    throw new Error('Could not read this video metadata.');
  }

  const streams = Array.isArray(info.streams) ? info.streams : [];
  const videoStream = streams.find(
    (stream) =>
      stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1
  );
  if (!videoStream || !videoStream.width || !videoStream.height) {
    throw new Error('This file does not contain a video track.');
  }

  const audioStream = streams.find((stream) => stream.codec_type === 'audio');
  const rotation = getRotation(videoStream);
  const swapped = rotation === 90 || rotation === 270;
  const width = swapped ? videoStream.height : videoStream.width;
  const height = swapped ? videoStream.width : videoStream.height;

  const durationCandidates = [
    Number(info.format?.duration),
    Number(videoStream.duration),
    Number(info.format?.tags?.duration),
  ].filter((value) => Number.isFinite(value) && value > 0);
  const duration = durationCandidates[0] || 0;

  const fps =
    parseFps(videoStream.avg_frame_rate) || parseFps(videoStream.r_frame_rate);

  return {
    duration,
    width,
    height,
    codedWidth: videoStream.width,
    codedHeight: videoStream.height,
    rotation,
    fps,
    videoCodec: videoStream.codec_name || 'unknown',
    audioCodec: audioStream?.codec_name || null,
    hasAudio: Boolean(audioStream),
    container: (info.format?.format_name || '').split(',')[0] || 'unknown',
    bitrate: Number(info.format?.bit_rate) || 0,
    size: Number(info.format?.size) || 0,
  };
}

async function makePoster(video, sourcePath, outputPath) {
  const timestamp =
    video.duration > 1.2
      ? Math.min(5, Math.max(0.4, video.duration * 0.12))
      : Math.max(0, video.duration / 2);
  const targetWidth = Math.max(2, Math.floor(Math.min(900, video.width) / 2) * 2);
  try {
    await runFfmpeg(
      [
        '-y',
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        timestamp.toFixed(3),
        '-i',
        sourcePath,
        '-frames:v',
        '1',
        '-vf',
        `scale=${targetWidth}:-2`,
        '-q:v',
        '3',
        outputPath,
      ],
      { timeoutMs: 45000 }
    );
    return true;
  } catch (error) {
    console.warn('[poster] generation failed:', error.message);
    return false;
  }
}

async function makePreviewProxy(video, sourcePath, outputPath, onProgress) {
  const targetHeight = Math.max(
    2,
    Math.min(720, video.height) - (Math.min(720, video.height) % 2)
  );
  const rawWidth = (video.width * targetHeight) / video.height;
  const targetWidth = Math.max(2, Math.round(rawWidth / 2) * 2);
  const duration = video.duration || 0;

  const args = [
    '-y',
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    sourcePath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    `scale=${targetWidth}:${targetHeight}`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  ];

  await runFfmpeg(args, {
    onProgress: (seconds) => {
      if (duration > 0) {
        onProgress?.(Math.min(0.99, seconds / duration));
      }
    },
  });
}

module.exports = {
  ffmpegPath,
  runFfmpeg,
  probeVideo,
  makePoster,
  makePreviewProxy,
};
