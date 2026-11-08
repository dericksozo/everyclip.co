# Everyclip

**One take. Every clip.**

Everyclip is the local video studio for [everyclip.co](https://everyclip.co). Upload one video, frame any crop, mark any moment, collect the shots you need, then export them all at once.

## Run it

```bash
./start.sh
```

or

```bash
npm install
npm run start
```

Then open **http://localhost:3000**.

Node.js 18+ is required. Video processing is powered by a bundled FFmpeg binary — you don't need to install FFmpeg separately.

## What it does

- **Upload once** — drag in an MP4, MOV, WebM, MKV, AVI or similar file.
- **Frame any crop** — draw a crop directly on the video, drag it around, resize it, and lock it to 1:1, 16:9, 9:16, 4:5, or the source aspect.
- **Trim any moment** — set in/out points on the timeline, drag the range handles, or type exact timecodes.
- **Loop and audition** — playback can loop the selected range for easy review.
- **Preview the result** — open a cropped preview that shows exactly what the exported frame will look like.
- **Keep a sequence** — add as many clips as you need. Clips, names, and settings are saved in your browser per project.
- **Export batches** — render individual clips, or export the whole sequence and download everything as a ZIP.
- **MP4, WebM, or GIF** — choose H.264 MP4 for compatibility, VP9 WebM for smaller files, or GIF for quick sharing.
- **Source / 1080p / 720p / 480p** — cap output resolution on the short edge while keeping the crop's aspect ratio (so a 9:16 clip at 1080p becomes 1080×1920).
- **Browser-preview conversion** — if Chrome can't play a source container/codec, Everyclip automatically prepares a lightweight H.264 preview copy. Your original is never modified.

Everything stays on your machine. Uploaded files and renders live in `data/` and can be deleted from the recent-projects screen.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `I` / `O` | Set in / out point at the playhead |
| `←` / `→` | Nudge one frame |
| `Shift` + `←` / `→` | Jump one second |
| `C` | Add the current selection as a clip |
| `N` | Start a new selection |
| `L` | Toggle range looping |
| `M` | Mute |
| `F` | Fullscreen player |
| `P` | Preview the current crop |
| `?` | Show all shortcuts |
| `Esc` | Finish editing the selected clip |

## How exporting works

The server writes the upload to `data/uploads/`, probes it with FFprobe, and queues exports one at a time. Each render uses FFmpeg with an accurate trim and pixel-mapped crop, then writes the result to `data/exports/`. The browser polls the queue and exposes downloads as soon as a render finishes. The ZIP endpoint packages every completed render for the project.

The FFmpeg and FFprobe binaries come from the `ffmpeg-static` and `@ffprobe-installer/ffprobe` packages, so the app is self-contained after installation.

## Project structure

```
server/
  index.js     HTTP API, uploads, streaming, downloads, ZIP
  media.js     FFprobe metadata, posters, preview conversion
  exports.js   FFmpeg export queue and progress
  store.js     Local JSON state + data directories
public/
  index.html   Landing page and editor shell
  styles.css   Design system and responsive layout
  app.js       Upload, crop, timeline, clips, preview, exports
data/          Created at runtime: uploads, renders, posters, state.json
```

## Notes

- Maximum upload size is 8 GB.
- Rendering happens locally, so long videos and GIF/WebM exports can take a while.
- Browser preview support depends on the codecs available in your browser; the preview conversion fallback handles most unsupported sources.
- Deleting a project from the recent-projects screen removes its upload, poster, preview proxy, and rendered exports. It does not touch the original file you uploaded from disk.

## Repository

[github.com/dericksozo/everyclip.co](https://github.com/dericksozo/everyclip.co)
