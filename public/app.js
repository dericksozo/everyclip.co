'use strict';

(() => {
  const MIN_DURATION = 0.1;
  const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024;
  const STORAGE_PREFIX = 'everyclip:clips:';
  const LEGACY_STORAGE_PREFIX = 'multicrop:clips:';
  const CLIP_COLORS = [
    '#d6ff3f',
    '#7cc8ff',
    '#ff9d7a',
    '#b9a4ff',
    '#8ff0c0',
    '#ffa8d2',
    '#ffd66b',
    '#6de5de',
  ];
  const VIDEO_EXTENSION = /\.(mp4|m4v|mov|webm|mkv|avi|ogv|ogg|mpg|mpeg|3gp|ts|mts|m2ts)$/i;

  const state = {
    video: null,
    clips: [],
    selectedClipId: null,
    selection: emptySelection(),
    aspect: 'free',
    loop: true,
    muted: false,
    volume: 1,
    activeTab: 'clip',
    jobs: [],
    recents: [],
    uploadXhr: null,
    playing: false,
    videoReady: false,
    displayAspect: 16 / 9,
    playbackSrc: null,
    usingProxy: false,
    proxyAttempted: false,
    proxyPollTimer: null,
    pendingSeek: 0,
    cropHintDismissed: false,
    cropHintTimer: null,
    cropDrag: null,
    rangeDrag: null,
    seeking: false,
    rafId: null,
    jobPollTimer: null,
    watchedJobIds: new Set(),
    watchedNotified: false,
    openToken: 0,
    saveTimer: null,
    thumbQueue: [],
    thumbBusy: false,
    thumbTimers: new Map(),
    justAddedId: null,
    exportStarting: false,
    preview: {
      data: null,
      editClipId: null,
      playWhenReady: false,
    },
  };

  const el = {};
  const ids = [
    'uploadView', 'fileInput', 'dropCard', 'dropzone', 'heroUploadBtn',
    'uploadState', 'uploadName', 'uploadMeta', 'cancelUploadBtn',
    'uploadProgressBar', 'uploadStatus', 'uploadPercent', 'uploadNote',
    'uploadError', 'uploadErrorText', 'retryUploadBtn',
    'recentSection', 'recentList', 'recentCount', 'landingShortcutsBtn',
    'editorView', 'brandHomeBtn', 'videoTitle', 'videoMeta', 'editorShortcutsBtn',
    'newVideoBtn', 'exportAllBtn', 'exportAllLabel', 'exportAllCount',
    'exportButtonProgress', 'clipCount', 'newClipBtn', 'libraryHint',
    'clipList', 'clipEmpty', 'emptyAddBtn', 'librarySummary', 'libraryDuration',
    'exportAllSecondary', 'stage', 'cropDims', 'cropAspectLabel',
    'previewCropBtn', 'resetCropBtn', 'playerArea', 'videoCanvas', 'video',
    'cropBox', 'cropSizeBadge', 'videoLoading', 'videoError',
    'videoErrorTitle', 'videoErrorText', 'convertProgress', 'convertBar',
    'convertPercent', 'preparePreviewBtn', 'cropHint', 'playBtn',
    'currentTime', 'totalTime', 'setInBtn', 'setOutBtn', 'inPointLabel',
    'outPointLabel', 'loopBtn', 'muteBtn', 'volumeSlider', 'fullscreenBtn',
    'timeline', 'timelineRuler', 'timelineTrack', 'trackTicks',
    'rangeSelection', 'rangeStartHandle', 'rangeEndHandle', 'clipLane',
    'playhead', 'timelineHover', 'rangeStartLabel', 'rangeEndLabel',
    'rangeDurationChip', 'clipTab', 'exportsTab', 'exportsTabBadge',
    'tabIndicator', 'inspectorScroll', 'clipPanel', 'exportsPanel',
    'selectionBanner', 'selectionSwatch', 'selectionEyebrow', 'selectionTitle',
    'finishEditingBtn', 'openPreviewBtn', 'clipName', 'clipNameHint',
    'cropInfo', 'aspectChips', 'cropReadout', 'timingOut', 'startInput',
    'durationInput', 'startFromPlayheadBtn', 'durationFromPlayheadBtn',
    'fullVideoBtn', 'fpsLabel', 'outputSummary', 'formatChips', 'qualityChips',
    'outputNote', 'primaryActionBtn', 'primaryActionLabel', 'editActions',
    'duplicateClipBtn', 'exportClipBtn', 'deleteClipBtn', 'ctaHint',
    'downloadAllBtn', 'exportSummaryCard', 'exportSummaryTitle',
    'exportSummaryText', 'exportPanelExportAll', 'exportList', 'exportEmpty',
    'shortcutsDialog', 'closeShortcutsBtn', 'shortcutsDoneBtn',
    'previewDialog', 'previewKicker', 'previewTitle', 'closePreviewBtn',
    'previewStage', 'previewFrame', 'previewVideo', 'previewLoading',
    'previewError', 'previewPlayBtn', 'previewTime', 'previewMeta',
    'previewProgressBar', 'previewEditBtn', 'confirmDialog', 'confirmTitle',
    'confirmText', 'confirmCancelBtn', 'confirmOkBtn', 'toastStack',
    'thumbVideo',
  ];

  init();

  function init() {
    for (const id of ids) el[id] = document.getElementById(id);

    bindEvents();
    updateMuteUI();
    setLoop(true, true);
    setInspectorTab('clip', { refresh: false });

    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => fitCanvas());
      observer.observe(el.playerArea);
    }

    fetchRecents();

    const videoId = parseVideoHash();
    if (videoId) {
      openVideoById(videoId);
    }
  }

  function emptySelection() {
    return {
      name: '',
      crop: { x: 0, y: 0, w: 1, h: 1 },
      start: 0,
      duration: 5,
      format: 'mp4',
      quality: 'original',
    };
  }

  function defaultSelection(video) {
    const duration = Math.max(
      MIN_DURATION,
      Math.min(6, Number(video.duration) || MIN_DURATION)
    );
    return {
      name: '',
      crop: { x: 0, y: 0, w: 1, h: 1 },
      start: 0,
      duration: Math.min(duration, video.duration),
      format: 'mp4',
      quality: 'original',
    };
  }

  /* ============================== Event wiring ============================== */

  function bindEvents() {
    el.dropzone.addEventListener('click', () => el.fileInput.click());
    el.heroUploadBtn.addEventListener('click', () => el.fileInput.click());
    el.fileInput.addEventListener('change', () => {
      const file = el.fileInput.files && el.fileInput.files[0];
      el.fileInput.value = '';
      if (file) uploadVideo(file);
    });
    el.cancelUploadBtn.addEventListener('click', cancelUpload);
    el.retryUploadBtn.addEventListener('click', () => {
      resetUploadUI();
      el.fileInput.click();
    });

    el.dropCard.addEventListener('dragenter', onDragOver);
    el.dropCard.addEventListener('dragover', onDragOver);
    el.dropCard.addEventListener('dragleave', (event) => {
      if (!el.dropCard.contains(event.relatedTarget)) {
        el.dropCard.classList.remove('dragging');
      }
    });
    el.dropCard.addEventListener('drop', onDrop);
    window.addEventListener('dragover', (event) => {
      if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
    });
    window.addEventListener('drop', (event) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      if (state.video) {
        toast('Use “Upload another” to open a different video.', { type: 'info' });
      }
    });

    el.recentList.addEventListener('click', onRecentListClick);
    el.landingShortcutsBtn.addEventListener('click', openShortcuts);

    el.brandHomeBtn.addEventListener('click', () => goHome());
    el.newVideoBtn.addEventListener('click', () => goHome());
    el.editorShortcutsBtn.addEventListener('click', openShortcuts);
    el.exportAllBtn.addEventListener('click', onExportAllClick);
    el.exportAllSecondary.addEventListener('click', onExportAllClick);
    el.exportPanelExportAll.addEventListener('click', onExportAllClick);
    el.downloadAllBtn.addEventListener('click', downloadArchive);

    el.newClipBtn.addEventListener('click', () => {
      startNewSelection();
      scrollStageIntoViewIfStacked();
    });
    el.emptyAddBtn.addEventListener('click', addClipFromSelection);
    el.finishEditingBtn.addEventListener('click', startNewSelection);
    el.clipList.addEventListener('click', onClipListClick);

    el.primaryActionBtn.addEventListener('click', addClipFromSelection);
    el.duplicateClipBtn.addEventListener('click', () => {
      if (state.selectedClipId) duplicateClip(state.selectedClipId);
    });
    el.deleteClipBtn.addEventListener('click', () => {
      if (state.selectedClipId) deleteClip(state.selectedClipId);
    });
    el.exportClipBtn.addEventListener('click', () => {
      if (state.selectedClipId) exportClipById(state.selectedClipId);
    });
    el.openPreviewBtn.addEventListener('click', () => openPreview(null));
    el.previewCropBtn.addEventListener('click', () => openPreview(null));
    el.preparePreviewBtn.addEventListener('click', preparePreview);
    el.resetCropBtn.addEventListener('click', resetCrop);

    el.aspectChips.addEventListener('click', (event) => {
      const button = event.target.closest('[data-aspect]');
      if (button) applyAspect(button.dataset.aspect);
    });
    el.formatChips.addEventListener('click', (event) => {
      const button = event.target.closest('[data-format]');
      if (button) setSelectionFormat(button.dataset.format);
    });
    el.qualityChips.addEventListener('click', (event) => {
      const button = event.target.closest('[data-quality]');
      if (button) setSelectionQuality(button.dataset.quality);
    });

    el.clipName.addEventListener('input', onClipNameInput);
    el.clipName.addEventListener('change', () => renderTimelineClips());
    el.startInput.addEventListener('focus', (event) => event.target.select());
    el.startInput.addEventListener('change', () => applyTimeInput('start'));
    el.startInput.addEventListener('keydown', timeInputKeydown);
    el.durationInput.addEventListener('focus', (event) => event.target.select());
    el.durationInput.addEventListener('change', () => applyTimeInput('duration'));
    el.durationInput.addEventListener('keydown', timeInputKeydown);
    el.startFromPlayheadBtn.addEventListener('click', setStartFromPlayhead);
    el.durationFromPlayheadBtn.addEventListener('click', setDurationFromPlayhead);
    el.fullVideoBtn.addEventListener('click', selectFullVideo);
    document.querySelectorAll('[data-duration]').forEach((button) => {
      button.addEventListener('click', () => {
        applyQuickDuration(Number(button.dataset.duration));
      });
    });

    el.playBtn.addEventListener('click', togglePlay);
    el.setInBtn.addEventListener('click', setInPoint);
    el.setOutBtn.addEventListener('click', setOutPoint);
    el.loopBtn.addEventListener('click', () => setLoop(!state.loop));
    el.muteBtn.addEventListener('click', () => setMuted(!state.muted));
    el.volumeSlider.addEventListener('input', () => {
      const volume = Number(el.volumeSlider.value);
      state.volume = volume;
      el.video.volume = volume;
      setMuted(volume === 0, true);
      if (volume > 0 && state.muted) setMuted(false, true);
    });
    el.fullscreenBtn.addEventListener('click', toggleFullscreen);

    el.clipTab.addEventListener('click', () => setInspectorTab('clip'));
    el.exportsTab.addEventListener('click', () => setInspectorTab('exports'));

    el.exportList.addEventListener('click', onExportListClick);

    el.video.addEventListener('loadedmetadata', onVideoLoadedMetadata);
    el.video.addEventListener('loadeddata', onVideoLoadedData);
    el.video.addEventListener('canplay', hideVideoLoading);
    el.video.addEventListener('error', onVideoError);
    el.video.addEventListener('click', () => {
      /* Clicking the video is reserved for framing, not playback. */
    });
    el.video.addEventListener('play', onVideoPlay);
    el.video.addEventListener('pause', onVideoPause);
    el.video.addEventListener('ended', onVideoEnded);
    el.video.addEventListener('timeupdate', () => {
      if (!state.cropDrag && !state.rangeDrag && !state.seeking) {
        updatePlaybackDisplay();
      }
    });
    el.video.addEventListener('volumechange', updateMuteUI);

    el.cropBox.addEventListener('pointerdown', onCropBoxPointerDown);
    el.videoCanvas.addEventListener('pointerdown', onCanvasPointerDown);
    el.timelineTrack.addEventListener('pointerdown', onTimelinePointerDown);
    el.timelineTrack.addEventListener('pointermove', onTimelineHover);
    el.timelineTrack.addEventListener('pointerleave', hideTimelineHover);
    el.rangeStartHandle.addEventListener('pointerdown', (event) => beginRangeDrag(event, 'start'));
    el.rangeEndHandle.addEventListener('pointerdown', (event) => beginRangeDrag(event, 'end'));
    el.clipLane.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.lane-clip')) event.stopPropagation();
    });
    el.clipLane.addEventListener('click', (event) => {
      const lane = event.target.closest('.lane-clip');
      if (lane && lane.dataset.clipId) selectClipById(lane.dataset.clipId);
    });

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', onGlobalKeydown);
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('beforeunload', () => {
      if (state.video) saveClipsNow();
    });
    document.addEventListener('fullscreenchange', onFullscreenChange);

    el.closeShortcutsBtn.addEventListener('click', () => el.shortcutsDialog.close());
    el.shortcutsDoneBtn.addEventListener('click', () => el.shortcutsDialog.close());
    el.closePreviewBtn.addEventListener('click', () => el.previewDialog.close());
    el.previewPlayBtn.addEventListener('click', togglePreviewPlay);
    el.previewFrame.addEventListener('click', togglePreviewPlay);
    el.previewEditBtn.addEventListener('click', onPreviewEdit);
    el.previewDialog.addEventListener('keydown', onPreviewKeydown);
    el.previewDialog.addEventListener('close', cleanupPreview);

    el.previewVideo.addEventListener('loadedmetadata', onPreviewMetadata);
    el.previewVideo.addEventListener('loadeddata', onPreviewLoaded);
    el.previewVideo.addEventListener('play', updatePreviewPlayState);
    el.previewVideo.addEventListener('pause', updatePreviewPlayState);
    el.previewVideo.addEventListener('timeupdate', onPreviewTimeUpdate);
    el.previewVideo.addEventListener('error', onPreviewError);

    for (const dialog of [el.shortcutsDialog, el.previewDialog, el.confirmDialog]) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }
  }

  /* ================================= Upload ================================= */

  function onDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!state.uploadXhr) el.dropCard.classList.add('dragging');
  }

  function onDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    el.dropCard.classList.remove('dragging');
    if (state.uploadXhr) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) uploadVideo(file);
  }

  function uploadVideo(file) {
    if (state.uploadXhr) return;

    if (!file || file.size === 0) {
      showUploadError('That file appears to be empty. Try another video.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      showUploadError('That video is larger than the 8 GB limit.');
      return;
    }
    if (!file.type.startsWith('video/') && !VIDEO_EXTENSION.test(file.name)) {
      showUploadError('That doesn’t look like a video file. Try an MP4, MOV, WebM or MKV.');
      return;
    }

    el.uploadError.hidden = true;
    el.dropzone.hidden = true;
    el.uploadState.hidden = false;
    el.uploadProgressBar.style.width = '0%';
    el.uploadProgressBar.parentElement.classList.remove('indeterminate');
    el.uploadName.textContent = file.name;
    el.uploadName.title = file.name;
    el.uploadMeta.textContent = formatBytes(file.size);
    el.uploadStatus.textContent = 'Uploading';
    el.uploadPercent.textContent = '0%';
    el.uploadNote.textContent = 'Large videos can take a moment. Keep this tab open.';

    const xhr = new XMLHttpRequest();
    state.uploadXhr = xhr;
    const form = new FormData();
    form.append('video', file, file.name);

    xhr.open('POST', '/api/videos');
    xhr.responseType = 'text';

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
      el.uploadProgressBar.style.width = `${percent}%`;
      el.uploadPercent.textContent = `${percent}%`;
      el.uploadMeta.textContent = `${formatBytes(event.loaded)} of ${formatBytes(event.total)}`;
    });

    xhr.upload.addEventListener('load', () => {
      el.uploadProgressBar.style.width = '100%';
      el.uploadProgressBar.parentElement.classList.add('indeterminate');
      el.uploadStatus.textContent = 'Analyzing video';
      el.uploadPercent.textContent = '··';
      el.uploadMeta.textContent = formatBytes(file.size);
      el.uploadNote.textContent = 'Reading the video and making a thumbnail…';
    });

    xhr.addEventListener('load', () => {
      state.uploadXhr = null;
      let data = null;
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data?.video) {
        resetUploadUI();
        fetchRecents();
        openVideo(data.video);
        return;
      }
      showUploadError(
        data?.error ||
          (xhr.status === 413
            ? 'That video is larger than the 8 GB limit.'
            : `The upload failed (${xhr.status}).`)
      );
    });

    xhr.addEventListener('error', () => {
      state.uploadXhr = null;
      showUploadError('Could not reach the local server. Is it still running?');
    });

    xhr.addEventListener('abort', () => {
      state.uploadXhr = null;
      resetUploadUI();
    });

    xhr.send(form);
  }

  function cancelUpload() {
    if (!state.uploadXhr) return;
    state.uploadXhr.abort();
    state.uploadXhr = null;
    resetUploadUI();
    toast('Upload canceled', { type: 'info' });
  }

  function resetUploadUI() {
    state.uploadXhr = null;
    if (el.uploadState) el.uploadState.hidden = true;
    if (el.uploadError) el.uploadError.hidden = true;
    if (el.dropzone) el.dropzone.hidden = false;
    el.uploadProgressBar.style.width = '0%';
    el.uploadProgressBar.parentElement.classList.remove('indeterminate');
    el.uploadPercent.textContent = '0%';
    el.uploadStatus.textContent = 'Uploading';
  }

  function showUploadError(message) {
    state.uploadXhr = null;
    el.uploadState.hidden = true;
    el.dropzone.hidden = true;
    el.uploadError.hidden = false;
    el.uploadErrorText.textContent = message;
  }

  /* ================================ Recents ================================ */

  async function fetchRecents() {
    try {
      const data = await api('/api/videos');
      state.recents = data.videos || [];
      renderRecents();
    } catch (error) {
      console.warn('[recents]', error.message);
    }
  }

  function renderRecents() {
    const videos = state.recents;
    el.recentSection.hidden = videos.length === 0;
    el.recentCount.textContent = videos.length
      ? `${videos.length} saved project${videos.length === 1 ? '' : 's'}`
      : '';

    el.recentList.innerHTML = videos
      .map((video) => {
        const poster = video.posterUrl
          ? `style="background-image:url('${safeAttr(video.posterUrl)}')"`
          : '';
        const clipCount = getStoredClipCount(video.id);
        const meta = [
          `<span>${formatClock(video.duration, false)}</span>`,
          `<span>${video.width}×${video.height}</span>`,
          clipCount
            ? `<span class="recent-clip-count">${clipCount} clip${clipCount === 1 ? '' : 's'}</span>`
            : '',
        ]
          .filter(Boolean)
          .join('<span class="dot"></span>');
        return `
          <article class="recent-card" data-video-id="${safeAttr(video.id)}">
            <button class="recent-open" type="button" data-action="open" aria-label="Open ${safeAttr(video.name)}">
              <div class="recent-thumb ${video.posterUrl ? '' : 'no-poster'}" ${poster}>
                ${video.posterUrl ? '' : '<span class="recent-thumb-icon"><svg class="icon"><use href="#i-film"></use></svg></span>'}
                <span class="recent-play"><svg class="icon"><use href="#i-play"></use></svg></span>
                <span class="recent-duration">${formatClock(video.duration, false)}</span>
              </div>
              <div class="recent-info">
                <strong title="${safeAttr(video.name)}">${escapeHtml(video.name)}</strong>
                <span class="recent-meta">${meta}</span>
              </div>
            </button>
            <button class="recent-delete" type="button" data-action="delete" title="Delete project" aria-label="Delete ${safeAttr(video.name)}">
              <svg class="icon"><use href="#i-trash"></use></svg>
            </button>
          </article>`;
      })
      .join('');
  }

  async function onRecentListClick(event) {
    const deleteButton = event.target.closest('[data-action="delete"]');
    const card = event.target.closest('[data-video-id]');
    if (!card) return;
    const video = state.recents.find((item) => item.id === card.dataset.videoId);
    if (!video) return;

    if (deleteButton) {
      event.stopPropagation();
      const confirmed = await confirmAction({
        title: 'Delete this project?',
        message: `“${video.name}” and all of its exports will be removed from this machine. The original file on disk is not touched.`,
        confirmLabel: 'Delete project',
      });
      if (!confirmed) return;
      try {
        await api(`/api/videos/${encodeURIComponent(video.id)}`, { method: 'DELETE' });
        localStorage.removeItem(`${STORAGE_PREFIX}${video.id}`);
        localStorage.removeItem(`${LEGACY_STORAGE_PREFIX}${video.id}`);
        await fetchRecents();
        toast('Project deleted', { type: 'success' });
      } catch (error) {
        toast(error.message, { type: 'error' });
      }
      return;
    }

    openVideoById(video.id);
  }

  function getStoredClipCount(videoId) {
    try {
      const parsed = JSON.parse(readClipStorage(videoId) || '[]');
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }

  /* ============================== Open / close ============================== */

  async function openVideoById(videoId) {
    const token = ++state.openToken;
    try {
      const data = await api(`/api/videos/${encodeURIComponent(videoId)}`);
      if (token !== state.openToken) return;
      openVideo(data.video);
    } catch (error) {
      if (token !== state.openToken) return;
      toast(error.message, { type: 'error' });
      goHome();
    }
  }

  function openVideo(video) {
    if (state.video) saveClipsNow();
    cleanupPlayer();
    closeAnyDialog();

    state.video = video;
    state.clips = loadStoredClips(video);
    state.selectedClipId = null;
    state.jobs = [];
    state.selection = defaultSelection(video);
    state.aspect = 'free';
    state.displayAspect = video.width / video.height || 16 / 9;
    state.playbackSrc =
      video.proxyStatus === 'ready' && video.proxyUrl ? video.proxyUrl : video.streamUrl;
    state.usingProxy = video.proxyStatus === 'ready' && Boolean(video.proxyUrl);
    state.proxyAttempted = video.proxyStatus !== 'none';
    state.videoReady = false;
    state.playing = false;
    state.pendingSeek = 0;
    state.cropHintDismissed = false;
    state.justAddedId = null;
    state.watchedJobIds.clear();
    state.watchedNotified = false;

    el.uploadView.hidden = true;
    el.editorView.hidden = false;
    document.title = `${video.name} — Everyclip`;
    history.replaceState(null, '', `#video=${encodeURIComponent(video.id)}`);
    window.scrollTo(0, 0);

    el.videoTitle.textContent = video.name;
    el.videoTitle.title = video.originalName || video.name;
    el.videoMeta.textContent = [
      formatClock(video.duration, false),
      `${video.width}×${video.height}`,
      video.fps ? `${formatFps(video.fps)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    el.video.poster = video.posterUrl || '';
    el.video.volume = state.volume;
    el.video.muted = state.muted;

    renderTimelineRuler();
    renderClips();
    renderTimelineClips();
    renderExports();
    updateExportIndicators();
    updateMuteUI();
    updateLibraryFooter();

    if (state.clips.length > 0) {
      selectClipById(state.clips[0].id, { seek: false, initial: true });
      dismissCropHint();
    } else {
      refreshSelectionUI({ syncName: true });
      state.cropHintDismissed = false;
      el.cropHint.classList.remove('is-hidden');
      clearTimeout(state.cropHintTimer);
      state.cropHintTimer = setTimeout(() => dismissCropHint(), 9000);
    }

    setInspectorTab('clip', { refresh: false });
    requestAnimationFrame(() => {
      fitCanvas();
      updateTabIndicator();
    });

    setupThumbSource();
    loadVideoSource();

    refreshJobs({ initial: true }).then(() => {
      scheduleJobPolling();
    });
    if (video.proxyStatus === 'processing') startProxyPoll();
  }

  function goHome(options = {}) {
    state.openToken += 1;
    if (state.video) saveClipsNow();
    const hadActiveExports = state.jobs.some(isActiveJob);
    cleanupPlayer();
    closeAnyDialog();
    state.video = null;
    state.clips = [];
    state.jobs = [];
    state.selectedClipId = null;
    state.selection = emptySelection();
    state.activeTab = 'clip';
    state.watchedJobIds.clear();
    el.editorView.hidden = true;
    el.uploadView.hidden = false;
    document.title = 'Everyclip — One take. Every clip.';
    if (options.updateHash !== false) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    window.scrollTo(0, 0);
    fetchRecents();
    if (hadActiveExports) {
      toast('Exports keep running in the background. Reopen the project to check them.', {
        type: 'info',
        duration: 5200,
      });
    }
  }

  function cleanupPlayer() {
    stopJobPolling();
    stopProxyPolling();
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    try {
      el.video.pause();
    } catch {
      /* ignore */
    }
    el.video.removeAttribute('src');
    el.video.load();
    state.playing = false;
    state.videoReady = false;
    state.thumbQueue = [];
    state.thumbBusy = false;
    clearTimeout(state.cropHintTimer);
    for (const timer of state.thumbTimers.values()) clearTimeout(timer);
    state.thumbTimers.clear();
    el.thumbVideo.removeAttribute('src');
    el.thumbVideo.load();
    if (el.previewDialog.open) el.previewDialog.close();
    el.videoLoading.classList.remove('is-hidden');
    el.videoError.hidden = true;
    el.convertProgress.hidden = true;
    state.cropDrag = null;
    state.rangeDrag = null;
    state.seeking = false;
    state.preview.data = null;
  }

  function closeAnyDialog() {
    for (const dialog of [el.shortcutsDialog, el.previewDialog, el.confirmDialog]) {
      if (dialog.open) dialog.close();
    }
  }

  function loadVideoSource(options = {}) {
    if (!state.video) return;
    state.videoReady = false;
    state.pendingSeek = clamp(
      Number.isFinite(options.seekTime) ? options.seekTime : state.selection.start || 0,
      0,
      Math.max(0, state.video.duration - 0.01)
    );
    el.videoError.hidden = true;
    el.convertProgress.hidden = true;
    el.videoLoading.classList.remove('is-hidden');
    el.video.poster = state.video.posterUrl || '';
    el.video.volume = state.volume;
    el.video.muted = state.muted;
    el.video.src = state.playbackSrc;
    el.video.load();
    updatePlaybackDisplay();
  }

  function onVideoLoadedMetadata() {
    if (!state.video) return;
    state.videoReady = true;
    if (el.video.videoWidth && el.video.videoHeight) {
      state.displayAspect = el.video.videoWidth / el.video.videoHeight;
    }
    fitCanvas();
    el.totalTime.textContent = formatClock(state.video.duration);
    const seekTo =
      state.pendingSeek > 0
        ? state.pendingSeek
        : state.selection.start || 0;
    try {
      el.video.currentTime = clamp(
        seekTo,
        0,
        Math.max(0, state.video.duration - 0.01)
      );
    } catch {
      /* ignore */
    }
    updatePlaybackDisplay();
  }

  function onVideoLoadedData() {
    if (!state.video) return;
    hideVideoLoading();
    state.videoReady = true;
    queueAllThumbnails();
  }

  function hideVideoLoading() {
    el.videoLoading.classList.add('is-hidden');
  }

  function setVideoErrorUI(title, text, options = {}) {
    el.videoLoading.classList.add('is-hidden');
    el.videoError.hidden = false;
    el.videoErrorTitle.textContent = title;
    el.videoErrorText.textContent = text;
    const converting = Boolean(options.converting);
    el.convertProgress.hidden = !converting;
    el.preparePreviewBtn.hidden = converting;
    if (converting) {
      el.convertBar.style.width = `${options.progress || 0}%`;
      el.convertPercent.textContent = `${options.progress || 0}%`;
      if (options.buttonLabel) el.preparePreviewBtn.textContent = options.buttonLabel;
    }
  }

  function onVideoError() {
    if (!state.video || el.editorView.hidden) return;

    if (state.video.proxyStatus === 'ready' && state.video.proxyUrl && !state.usingProxy) {
      switchToProxy(state.video.proxyUrl);
      return;
    }

    if (state.usingProxy) {
      setVideoErrorUI(
        'Preview unavailable',
        'The converted preview could not be played. Exporting may still work. Try preparing the preview again.',
        {}
      );
      return;
    }

    if (state.video.proxyStatus === 'processing') {
      setVideoErrorUI(
        'Preparing a browser preview',
        'This video uses a format your browser can’t play directly. We’re making a quick preview copy — your original is untouched.',
        { converting: true, progress: state.video.proxyProgress || 0 }
      );
      startProxyPoll();
      return;
    }

    if (!state.proxyAttempted) {
      state.proxyAttempted = true;
      setVideoErrorUI(
        'Preparing a browser preview',
        'This video uses a format your browser can’t play directly. We’re making a quick preview copy — your original is untouched.',
        { converting: true, progress: 0 }
      );
      preparePreview();
      return;
    }

    setVideoErrorUI(
      state.video.proxyStatus === 'error' ? 'Preview still unavailable' : 'Preview unavailable',
      state.video.proxyError ||
        'This video could not be played in the browser. You can still try exporting clips.',
      {}
    );
  }

  async function preparePreview() {
    if (!state.video) return;
    if (state.video.proxyStatus === 'ready' && state.video.proxyUrl) {
      switchToProxy(state.video.proxyUrl);
      return;
    }

    const videoId = state.video.id;
    setVideoErrorUI(
      'Preparing a browser preview',
      'This video uses a format your browser can’t play directly. We’re making a quick preview copy — your original is untouched.',
      { converting: true, progress: state.video.proxyProgress || 0 }
    );

    try {
      const data = await api(`/api/videos/${encodeURIComponent(videoId)}/prepare`, {
        method: 'POST',
      });
      if (!state.video || state.video.id !== videoId) return;
      if (data.video) mergeVideo(data.video);
      if (data.video?.proxyStatus === 'ready' && data.video.proxyUrl) {
        switchToProxy(data.video.proxyUrl);
      } else {
        startProxyPoll();
      }
    } catch (error) {
      if (!state.video || state.video.id !== videoId) return;
      setVideoErrorUI('Preview unavailable', error.message, {});
    }
  }

  function mergeVideo(video) {
    if (!state.video || state.video.id !== video.id) return;
    state.video = { ...state.video, ...video };
  }

  function startProxyPoll() {
    stopProxyPolling();
    if (!state.video) return;
    const videoId = state.video.id;
    state.proxyPollTimer = setInterval(async () => {
      if (!state.video || state.video.id !== videoId) {
        stopProxyPolling();
        return;
      }
      try {
        const data = await api(`/api/videos/${encodeURIComponent(videoId)}`);
        if (!state.video || state.video.id !== videoId) return;
        mergeVideo(data.video);
        if (data.video.proxyStatus === 'ready' && data.video.proxyUrl) {
          stopProxyPolling();
          switchToProxy(data.video.proxyUrl);
        } else if (data.video.proxyStatus === 'error') {
          stopProxyPolling();
          setVideoErrorUI(
            'Preview still unavailable',
            data.video.proxyError ||
              'The preview conversion failed. Your original video is still safe.',
            {}
          );
        } else {
          setVideoErrorUI(
            'Preparing a browser preview',
            'This video uses a format your browser can’t play directly. We’re making a quick preview copy — your original is untouched.',
            { converting: true, progress: data.video.proxyProgress || 0 }
          );
        }
      } catch {
        /* keep trying quietly */
      }
    }, 1000);
  }

  function stopProxyPolling() {
    if (state.proxyPollTimer) {
      clearInterval(state.proxyPollTimer);
      state.proxyPollTimer = null;
    }
  }

  function switchToProxy(proxyUrl) {
    if (!state.video) return;
    stopProxyPolling();
    state.usingProxy = true;
    state.playbackSrc = `${proxyUrl}${proxyUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
    state.proxyAttempted = true;
    el.videoError.hidden = true;
    el.convertProgress.hidden = true;
    el.videoLoading.classList.remove('is-hidden');
    setupThumbSource();
    clearThumbnails();
    const current = el.video.currentTime || state.pendingSeek || state.selection.start || 0;
    loadVideoSource({ seekTime: current });
    toast('Browser preview is ready', { type: 'success' });
  }

  /* ================================ Clips ================================= */

  function clipStorageKey(videoId) {
    return `${STORAGE_PREFIX}${videoId}`;
  }

  function legacyClipStorageKey(videoId) {
    return `${LEGACY_STORAGE_PREFIX}${videoId}`;
  }

  function readClipStorage(videoId) {
    try {
      const current = localStorage.getItem(clipStorageKey(videoId));
      if (current !== null) return current;
      const legacy = localStorage.getItem(legacyClipStorageKey(videoId));
      if (legacy === null) return null;
      // One-time migration so clips saved before the Everyclip rebrand survive.
      localStorage.setItem(clipStorageKey(videoId), legacy);
      localStorage.removeItem(legacyClipStorageKey(videoId));
      return legacy;
    } catch {
      return null;
    }
  }

  function loadStoredClips(video) {
    let stored;
    try {
      stored = JSON.parse(readClipStorage(video.id) || '[]');
    } catch {
      stored = [];
    }
    if (!Array.isArray(stored)) return [];
    const duration = Number(video.duration) || 0;

    return stored
      .filter((clip) => clip && typeof clip === 'object')
      .map((clip, index) => {
        const start = clamp(Number(clip.start) || 0, 0, Math.max(0, duration - MIN_DURATION));
        const clipDuration = clamp(
          Number(clip.duration) || MIN_DURATION,
          MIN_DURATION,
          Math.max(MIN_DURATION, duration - start)
        );
        return {
          id: typeof clip.id === 'string' && clip.id ? clip.id : uid(),
          name: typeof clip.name === 'string' && clip.name.trim()
            ? clip.name.trim().slice(0, 80)
            : `Clip ${index + 1}`,
          crop: normalizeCropRect(clip.crop || { x: 0, y: 0, w: 1, h: 1 }),
          start,
          duration: clipDuration,
          format: ['mp4', 'webm', 'gif'].includes(clip.format) ? clip.format : 'mp4',
          quality: normalizeQuality(clip.quality),
          aspect: typeof clip.aspect === 'string' ? clip.aspect : 'free',
          createdAt: clip.createdAt || new Date().toISOString(),
          updatedAt: clip.updatedAt || new Date().toISOString(),
          thumb: null,
        };
      });
  }

  function serializeClips() {
    return state.clips.map((clip) => ({
      id: clip.id,
      name: clip.name,
      crop: clip.crop,
      start: clip.start,
      duration: clip.duration,
      format: clip.format,
      quality: clip.quality,
      aspect: clip.aspect,
      createdAt: clip.createdAt,
      updatedAt: clip.updatedAt,
    }));
  }

  function saveClipsNow() {
    if (!state.video) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    try {
      localStorage.setItem(clipStorageKey(state.video.id), JSON.stringify(serializeClips()));
    } catch (error) {
      console.warn('[clips] could not save:', error.message);
    }
  }

  function scheduleSaveClips() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveClipsNow, 180);
  }

  function selectedClip() {
    return state.clips.find((clip) => clip.id === state.selectedClipId) || null;
  }

  function clipIndex(clipId) {
    return state.clips.findIndex((clip) => clip.id === clipId);
  }

  function clipColorForIndex(index) {
    return CLIP_COLORS[((index % CLIP_COLORS.length) + CLIP_COLORS.length) % CLIP_COLORS.length];
  }

  function renderClips() {
    if (!state.video) return;
    const listScroll = el.clipList.scrollTop;
    const listScrollLeft = el.clipList.scrollLeft;

    el.clipCount.textContent = state.clips.length;
    el.clipList.hidden = state.clips.length === 0;
    el.clipEmpty.hidden = state.clips.length > 0;

    el.clipList.innerHTML = state.clips
      .map((clip, index) => {
        const color = clipColorForIndex(index);
        const crop = cropPixelsFor(clip.crop);
        const duration = formatClock(clip.duration);
        const rangeLabel = `${formatClock(clip.start)} – ${formatClock(clip.start + clip.duration)}`;
        const aspect = cropAspectLabel(crop.w / Math.max(1, crop.h));
        const thumbStyle = clip.thumb
          ? `style="background-image:url('${clip.thumb}')"`
          : '';
        return `
          <article class="clip-card ${clip.id === state.selectedClipId ? 'selected' : ''} ${
            clip.id === state.justAddedId ? 'just-added' : ''
          }" data-clip-id="${safeAttr(clip.id)}" style="--clip-color:${color}" role="listitem">
            <div class="clip-thumb-wrap">
              <button class="clip-thumb ${clip.thumb ? 'has-thumb' : ''}" type="button" data-action="select" ${thumbStyle} title="Select ${safeAttr(clip.name)}" aria-label="Select ${safeAttr(clip.name)}">
                <span class="clip-thumb-placeholder"><svg class="icon"><use href="#i-film"></use></svg></span>
                <span class="clip-index">${pad2(index + 1)}</span>
                <span class="clip-duration">${duration}</span>
              </button>
              <button class="clip-play" type="button" data-action="preview" title="Preview ${safeAttr(clip.name)}" aria-label="Preview ${safeAttr(clip.name)}"><svg class="icon"><use href="#i-play"></use></svg></button>
            </div>
            <div class="clip-actions">
              <button class="clip-action" type="button" data-action="export" title="Export this clip" aria-label="Export this clip"><svg class="icon"><use href="#i-download"></use></svg></button>
              <button class="clip-action" type="button" data-action="duplicate" title="Duplicate clip" aria-label="Duplicate clip"><svg class="icon"><use href="#i-copy"></use></svg></button>
              <button class="clip-action danger" type="button" data-action="delete" title="Delete clip" aria-label="Delete clip"><svg class="icon"><use href="#i-trash"></use></svg></button>
            </div>
            <button class="clip-main" type="button" data-action="select">
              <span class="clip-name" title="${safeAttr(clip.name)}">${escapeHtml(clip.name)}</span>
              <span class="clip-meta">${rangeLabel}<span class="dot"></span>${clip.format.toUpperCase()}</span>
              <span class="clip-crop-meta">${crop.w}×${crop.h}<span class="aspect-tag">${aspect}</span></span>
            </button>
          </article>`;
      })
      .join('');

    el.clipList.scrollTop = listScroll;
    el.clipList.scrollLeft = listScrollLeft;

    if (state.justAddedId) {
      const id = state.justAddedId;
      setTimeout(() => {
        const card = el.clipList.querySelector(`[data-clip-id="${cssEscape(id)}"]`);
        if (card) card.classList.remove('just-added');
      }, 1150);
    }

    updateLibraryFooter();
  }

  function renderTimelineClips() {
    if (!state.video) return;
    const duration = state.video.duration || 1;
    el.clipLane.innerHTML = state.clips
      .map((clip, index) => {
        const left = clamp((clip.start / duration) * 100, 0, 100);
        const width = clamp((clip.duration / duration) * 100, 0, 100 - left);
        return `<button class="lane-clip ${clip.id === state.selectedClipId ? 'selected' : ''}" type="button" data-clip-id="${safeAttr(clip.id)}" style="left:${left}%;width:${width}%;--clip-color:${clipColorForIndex(index)}" title="${safeAttr(clip.name)} · ${formatClock(clip.start)}–${formatClock(clip.start + clip.duration)}" aria-label="Select ${safeAttr(clip.name)}"></button>`;
      })
      .join('');
  }

  function updateLaneClip() {
    const clip = selectedClip();
    if (!clip || !state.video) return;
    const lane = el.clipLane.querySelector(`[data-clip-id="${cssEscape(clip.id)}"]`);
    if (!lane) return;
    const duration = state.video.duration || 1;
    lane.style.left = `${clamp((clip.start / duration) * 100, 0, 100)}%`;
    lane.style.width = `${clamp((clip.duration / duration) * 100, 0, 100)}%`;
  }

  function onClipListClick(event) {
    const card = event.target.closest('.clip-card');
    if (!card) return;
    const clipId = card.dataset.clipId;
    const actionButton = event.target.closest('[data-action]');
    const action = actionButton?.dataset.action;

    if (action === 'preview') {
      const clip = state.clips.find((item) => item.id === clipId);
      if (clip) openPreview(clip);
      return;
    }
    if (action === 'export') {
      exportClipById(clipId);
      return;
    }
    if (action === 'duplicate') {
      duplicateClip(clipId);
      return;
    }
    if (action === 'delete') {
      deleteClip(clipId);
      return;
    }
    selectClipById(clipId);
    scrollStageIntoViewIfStacked();
  }

  function selectClipById(clipId, options = {}) {
    const clip = state.clips.find((item) => item.id === clipId);
    if (!clip) return;
    if (!options.initial) saveClipsNow();
    state.selectedClipId = clip.id;
    state.aspect = clip.aspect || 'free';
    state.selection = {
      name: clip.name,
      crop: { ...clip.crop },
      start: clip.start,
      duration: clip.duration,
      format: clip.format,
      quality: clip.quality,
    };
    if (options.seek !== false) {
      pauseVideo();
      seekTo(clip.start);
      dismissCropHint();
    }
    renderClips();
    renderTimelineClips();
    refreshSelectionUI({ syncName: true });
    setInspectorTab('clip', { refresh: false });

    if (!options.initial) {
      const card = el.clipList.querySelector(`[data-clip-id="${cssEscape(clip.id)}"]`);
      if (card) card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function scrollStageIntoViewIfStacked() {
    if (!window.matchMedia('(max-width: 1140px)').matches) return;
    requestAnimationFrame(() => {
      el.stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function startNewSelection() {
    if (!state.video) return;
    saveClipsNow();
    state.selectedClipId = null;
    state.selection.name = '';
    state.justAddedId = null;
    renderClips();
    renderTimelineClips();
    refreshSelectionUI({ syncName: true });
    setInspectorTab('clip', { refresh: false });
  }

  function addClipFromSelection() {
    if (!state.video) return;
    const name = state.selection.name.trim() || nextClipName();
    const clip = {
      id: uid(),
      name,
      crop: { ...state.selection.crop },
      start: state.selection.start,
      duration: state.selection.duration,
      format: state.selection.format,
      quality: state.selection.quality,
      aspect: state.aspect,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      thumb: null,
    };
    state.clips.push(clip);
    state.selectedClipId = null;
    state.selection.name = '';
    state.justAddedId = clip.id;
    saveClipsNow();
    renderClips();
    renderTimelineClips();
    refreshSelectionUI({ syncName: true });
    scheduleThumbnail(clip, 20);

    const card = el.clipList.querySelector(`[data-clip-id="${cssEscape(clip.id)}"]`);
    if (card) card.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    toast(`“${clip.name}” added to the sequence`, {
      type: 'success',
      duration: 3000,
      action: {
        label: 'Undo',
        onClick: () => undoAdd(clip.id),
      },
    });
  }

  function undoAdd(clipId) {
    const index = state.clips.findIndex((clip) => clip.id === clipId);
    if (index === -1) return;
    state.clips.splice(index, 1);
    if (state.selectedClipId === clipId) state.selectedClipId = null;
    saveClipsNow();
    renderClips();
    renderTimelineClips();
    refreshSelectionUI({ syncName: true });
    toast('Clip removed', { type: 'info' });
  }

  function nextClipName() {
    let index = state.clips.length + 1;
    let name = `Clip ${index}`;
    const existing = new Set(state.clips.map((clip) => clip.name.toLowerCase()));
    while (existing.has(name.toLowerCase())) {
      index += 1;
      name = `Clip ${index}`;
    }
    return name;
  }

  function uniqueCopyName(base) {
    const existing = new Set(state.clips.map((clip) => clip.name.toLowerCase()));
    let candidate = `${base} copy`;
    let counter = 2;
    while (existing.has(candidate.toLowerCase())) {
      candidate = `${base} copy ${counter}`;
      counter += 1;
    }
    return candidate;
  }

  function duplicateClip(clipId) {
    const clip = state.clips.find((item) => item.id === clipId);
    if (!clip) return;
    const copy = {
      ...clip,
      id: uid(),
      name: uniqueCopyName(clip.name),
      crop: { ...clip.crop },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      thumb: clip.thumb || null,
    };
    const index = state.clips.findIndex((item) => item.id === clipId);
    state.clips.splice(index + 1, 0, copy);
    saveClipsNow();
    renderClips();
    renderTimelineClips();
    selectClipById(copy.id, { seek: false });
    scheduleThumbnail(copy, 140);
    toast('Clip duplicated', { type: 'success' });
  }

  function deleteClip(clipId) {
    const index = state.clips.findIndex((clip) => clip.id === clipId);
    if (index === -1) return;
    const [removed] = state.clips.splice(index, 1);
    const wasSelected = state.selectedClipId === clipId;
    if (wasSelected) {
      state.selectedClipId = null;
      state.selection.name = '';
    }
    saveClipsNow();
    renderClips();
    renderTimelineClips();
    refreshSelectionUI({ syncName: wasSelected });
    toast(`“${removed.name}” deleted`, {
      type: 'info',
      action: {
        label: 'Undo',
        onClick: () => {
          state.clips.splice(Math.min(index, state.clips.length), 0, removed);
          saveClipsNow();
          renderClips();
          renderTimelineClips();
          refreshSelectionUI({ syncName: true });
          toast('Clip restored', { type: 'success' });
        },
      },
    });
  }

  function touchSelectedClip(options = {}) {
    const clip = selectedClip();
    if (!clip) return;
    clip.name = state.selection.name;
    clip.crop = { ...state.selection.crop };
    clip.start = state.selection.start;
    clip.duration = state.selection.duration;
    clip.format = state.selection.format;
    clip.quality = state.selection.quality;
    clip.aspect = state.aspect;
    clip.updatedAt = new Date().toISOString();
    updateLaneClip();
    scheduleSaveClips();
    if (options.thumb !== false) scheduleThumbnail(clip, 420);
  }

  /* ============================== Inspector UI ============================== */

  function refreshSelectionUI(options = {}) {
    if (!state.video) return;
    updateCropMetrics();
    updateRangeUI();
    updateSelectionInputs(Boolean(options.syncName));
    updateContextUI();
    updateChipStates();
  }

  function updateCropMetrics() {
    if (!state.video) return;
    const crop = state.selection.crop;
    const px = cropPixelsFor(crop);
    const aspect = cropAspectLabel(px.w / Math.max(1, px.h));

    el.cropBox.style.left = `${crop.x * 100}%`;
    el.cropBox.style.top = `${crop.y * 100}%`;
    el.cropBox.style.width = `${crop.w * 100}%`;
    el.cropBox.style.height = `${crop.h * 100}%`;
    el.cropBox.classList.toggle('edge-top', crop.y < 0.012);
    el.cropBox.classList.toggle('edge-left', crop.x < 0.012);
    el.cropBox.classList.toggle('edge-right', crop.x + crop.w > 0.988);
    el.cropBox.classList.toggle('edge-bottom', crop.y + crop.h > 0.988);

    el.cropSizeBadge.textContent = `${px.w} × ${px.h}`;
    el.cropSizeBadge.hidden = crop.w * el.videoCanvas.clientWidth < 150;

    el.cropDims.textContent = `${px.w} × ${px.h}`;
    el.cropAspectLabel.textContent = aspect;
    el.cropInfo.textContent = `${px.w} × ${px.h} px`;
    el.cropReadout.innerHTML = `
      <span><em>W</em>${px.w}</span>
      <span><em>H</em>${px.h}</span>
      <span><em>X</em>${px.x}</span>
      <span><em>Y</em>${px.y}</span>`;
  }

  function updateRangeUI() {
    if (!state.video) return;
    const duration = Math.max(0.001, state.video.duration);
    const start = clamp(state.selection.start, 0, duration);
    const length = clamp(state.selection.duration, MIN_DURATION, duration - start);
    const end = Math.min(duration, start + length);
    const leftPercent = (start / duration) * 100;
    const widthPercent = (length / duration) * 100;

    el.rangeSelection.style.left = `${leftPercent}%`;
    el.rangeSelection.style.width = `${widthPercent}%`;

    el.rangeStartLabel.textContent = formatClock(start);
    el.rangeEndLabel.textContent = formatClock(end);
    el.rangeDurationChip.textContent = formatDurationHuman(length);
    el.inPointLabel.textContent = formatClock(start);
    el.outPointLabel.textContent = formatClock(end);
    el.timingOut.textContent = `Out at ${formatClock(end)}`;
    el.playhead.style.left = `${(clamp(el.video.currentTime || 0, 0, duration) / duration) * 100}%`;

    if (document.activeElement !== el.startInput) {
      el.startInput.value = formatInputTime(start);
    }
    if (document.activeElement !== el.durationInput) {
      el.durationInput.value = formatInputTime(length);
    }
    el.startInput.title = formatInputTime(start);
    el.durationInput.title = formatInputTime(length);

    const title = `${state.selection.name.trim() || 'Untitled clip'} · ${formatDurationHuman(length)}`;
    el.selectionTitle.textContent = title;
  }

  function updateContextUI() {
    const selected = selectedClip();
    const editing = Boolean(selected);
    const index = selected ? clipIndex(selected.id) : -1;
    const color = editing ? clipColorForIndex(index) : CLIP_COLORS[0];

    el.selectionBanner.style.setProperty('--clip-color', color);
    el.selectionSwatch.textContent = editing ? pad2(index + 1) : '+';
    el.selectionEyebrow.textContent = editing ? `Editing clip ${pad2(index + 1)}` : 'New clip';
    el.selectionTitle.textContent = `${state.selection.name.trim() || 'Untitled clip'} · ${formatDurationHuman(state.selection.duration)}`;
    el.finishEditingBtn.hidden = !editing;
    el.clipNameHint.textContent = editing ? 'Saves automatically' : 'Optional';
    el.primaryActionBtn.hidden = editing;
    el.editActions.hidden = !editing;
    el.ctaHint.textContent = editing
      ? 'Changes save as you go. Press C to add these settings as a new clip.'
      : 'Frame it, trim it, add it. This clip will enter your sequence.';
    el.clipName.placeholder = `e.g. ${nextClipName()} — vertical`;
    el.openPreviewBtn.disabled = !state.selection.duration;
    if (editing) {
      el.selectionBanner.setAttribute('data-editing', 'true');
    } else {
      el.selectionBanner.removeAttribute('data-editing');
    }
  }

  function updateSelectionInputs(force) {
    if (force || document.activeElement !== el.clipName) {
      if (el.clipName.value !== state.selection.name) {
        el.clipName.value = state.selection.name;
      }
    }
    if (force || document.activeElement !== el.startInput) {
      el.startInput.value = formatInputTime(state.selection.start);
    }
    if (force || document.activeElement !== el.durationInput) {
      el.durationInput.value = formatInputTime(state.selection.duration);
    }
    if (force) {
      el.clipName.value = state.selection.name;
    }
  }

  function updateChipStates() {
    for (const button of el.aspectChips.querySelectorAll('[data-aspect]')) {
      button.classList.toggle('active', button.dataset.aspect === state.aspect);
    }
    for (const button of el.formatChips.querySelectorAll('[data-format]')) {
      button.classList.toggle('active', button.dataset.format === state.selection.format);
    }
    for (const button of el.qualityChips.querySelectorAll('[data-quality]')) {
      button.classList.toggle(
        'active',
        String(button.dataset.quality) === String(state.selection.quality)
      );
    }
    const qualityLabel =
      state.selection.format === 'gif'
        ? '480p max'
        : state.selection.quality === 'original'
          ? 'Source'
          : `${state.selection.quality}p`;
    el.outputSummary.textContent = `${state.selection.format.toUpperCase()} · ${qualityLabel}`;

    if (state.selection.format === 'gif') {
      el.outputNote.textContent = '15 fps · no audio · scaled to fit 480px';
    } else if (state.selection.format === 'webm') {
      el.outputNote.textContent = 'VP9 + Opus · smaller files, slower renders';
    } else if (state.selection.quality === 'original') {
      el.outputNote.textContent = 'H.264 + AAC · source crop resolution';
    } else {
      el.outputNote.textContent = `H.264 + AAC · capped at ${state.selection.quality}p`;
    }

    el.fpsLabel.textContent = state.video?.fps
      ? `${formatFps(state.video.fps)} · ${state.video.width}×${state.video.height}`
      : '—';
  }

  function updateLibraryFooter() {
    const clips = state.clips;
    const total = clips.reduce((sum, clip) => sum + clip.duration, 0);
    el.clipCount.textContent = clips.length;
    el.librarySummary.textContent = clips.length
      ? `${clips.length} clip${clips.length === 1 ? '' : 's'}`
      : 'No clips yet';
    el.libraryDuration.textContent = clips.length ? `${formatDurationHuman(total)} total` : '';
    const none = clips.length === 0;
    el.exportAllSecondary.disabled = none;
    el.exportAllBtn.disabled = none && !state.jobs.some(isActiveJob);
    el.libraryHint.textContent = clips.length
      ? 'Click a clip to load it back into the editor. Changes save automatically.'
      : 'New clips land here. Frame a shot, set a range, then add it.';
    updateExportIndicators();
  }

  /* =============================== Selection =============================== */

  function onClipNameInput() {
    state.selection.name = el.clipName.value;
    if (state.selectedClipId) {
      touchSelectedClip({ thumb: false });
      renderClips();
    }
    el.selectionTitle.textContent = `${state.selection.name.trim() || 'Untitled clip'} · ${formatDurationHuman(state.selection.duration)}`;
    scheduleSaveClips();
  }

  function setSelectionFormat(format) {
    if (!['mp4', 'webm', 'gif'].includes(format)) return;
    state.selection.format = format;
    touchSelectedClip({ thumb: false });
    saveClipsNow();
    updateChipStates();
    renderClips();
    if (state.selectedClipId) renderTimelineClips();
  }

  function setSelectionQuality(quality) {
    const normalized = normalizeQuality(quality);
    state.selection.quality = normalized;
    touchSelectedClip({ thumb: false });
    saveClipsNow();
    updateChipStates();
    renderClips();
  }

  function applyAspect(value) {
    if (!state.video) return;
    if (!['free', 'source', '1:1', '16:9', '9:16', '4:5'].includes(value)) return;
    state.aspect = value;
    if (value !== 'free') {
      const ratio = aspectValue(value);
      if (ratio) {
        state.selection.crop = fitCropToAspect(ratio);
      }
    }
    touchSelectedClip();
    saveClipsNow();
    refreshSelectionUI();
    renderClips();
  }

  function aspectValue(value) {
    if (!state.video) return null;
    if (value === 'source') return state.video.width / state.video.height;
    if (value === 'free') return null;
    const [w, h] = String(value).split(':').map(Number);
    return w > 0 && h > 0 ? w / h : null;
  }

  function fitCropToAspect(ratio) {
    if (!state.video) return state.selection.crop;
    const W = state.video.width;
    const H = state.video.height;
    const current = state.selection.crop;
    const cx = (current.x + current.w / 2) * W;
    const cy = (current.y + current.h / 2) * H;

    // Use the largest frame with this ratio, then keep it as close to the
    // current crop's center as the video bounds allow.
    let w;
    let h;
    if (W / H > ratio) {
      h = H;
      w = h * ratio;
    } else {
      w = W;
      h = w / ratio;
    }
    const x = clamp(cx - w / 2, 0, W - w);
    const y = clamp(cy - h / 2, 0, H - h);
    return normalizeCropRect({ x: x / W, y: y / H, w: w / W, h: h / H });
  }

  function resetCrop() {
    state.selection.crop = { x: 0, y: 0, w: 1, h: 1 };
    state.aspect = 'free';
    touchSelectedClip();
    saveClipsNow();
    refreshSelectionUI();
    renderClips();
    dismissCropHint();
  }

  function setInPoint() {
    if (!state.video) return;
    pauseVideo();
    const t = clamp(el.video.currentTime, 0, Math.max(0, state.video.duration - MIN_DURATION));
    const end = state.selection.start + state.selection.duration;
    if (t >= end - 0.03) {
      const length = Math.min(state.selection.duration, state.video.duration - t);
      state.selection.start = t;
      state.selection.duration = Math.max(MIN_DURATION, length);
    } else {
      state.selection.start = t;
      state.selection.duration = Math.max(MIN_DURATION, end - t);
    }
    seekTo(state.selection.start);
    touchSelectedClip();
    saveClipsNow();
    refreshSelectionUI();
    renderClips();
    renderTimelineClips();
  }

  function setOutPoint() {
    if (!state.video) return;
    pauseVideo();
    const t = clamp(el.video.currentTime, MIN_DURATION, state.video.duration);
    const start = state.selection.start;
    if (t <= start + 0.03) {
      const length = Math.min(state.selection.duration, t);
      state.selection.start = Math.max(0, t - length);
      state.selection.duration = Math.max(MIN_DURATION, t - state.selection.start);
    } else {
      state.selection.duration = t - start;
    }
    touchSelectedClip();
    saveClipsNow();
    refreshSelectionUI();
    renderClips();
    renderTimelineClips();
  }

  function setStartFromPlayhead() {
    if (!state.video) return;
    const t = clamp(el.video.currentTime, 0, Math.max(0, state.video.duration - MIN_DURATION));
    state.selection.start = t;
    state.selection.duration = Math.max(
      MIN_DURATION,
      Math.min(state.selection.duration, state.video.duration - t)
    );
    seekTo(t);
    touchSelectedClip();
    saveClipsNow();
    refreshSelectionUI();
    renderClips();
    renderTimelineClips();
  }

  function setDurationFromPlayhead() {
    if (!state.video) return;
    const t = el.video.currentTime;
    if (t <= state.selection.start + 0.05) {
      toast('Move the playhead after the clip start first.', { type: 'info' });
      return;
    }
    state.selection.duration = clamp(
      t - state.selection.start,
      MIN_DURATION,
      state.video.duration - state.selection.start
    );
    touchSelectedClip();
    saveClipsNow();
    refreshSelectionUI();
    renderClips();
    renderTimelineClips();
  }

  function selectFullVideo() {
    if (!state.video) return;
    state.selection.start = 0;
    state.selection.duration = state.video.duration;
    seekTo(0);
    touchSelectedClip();
    saveClipsNow();
    refreshSelectionUI();
    renderClips();
    renderTimelineClips();
  }

  function applyQuickDuration(value) {
    if (!state.video || !Number.isFinite(value)) return;
    state.selection.duration = Math.max(
      MIN_DURATION,
      Math.min(value, state.video.duration - state.selection.start)
    );
    if (state.selection.duration < value - 0.05) {
      state.selection.start = Math.max(0, state.video.duration - value);
      state.selection.duration = Math.min(value, state.video.duration);
    }
    touchSelectedClip();
    saveClipsNow();
    refreshSelectionUI();
    renderClips();
    renderTimelineClips();
  }

  function applyTimeInput(kind) {
    if (!state.video) return;
    const input = kind === 'start' ? el.startInput : el.durationInput;
    const parsed = parseTimeInput(input.value);
    if (!Number.isFinite(parsed)) {
      input.value = formatInputTime(
        kind === 'start' ? state.selection.start : state.selection.duration
      );
      toast('Enter a time like 0:12.5 or 12.5', { type: 'error' });
      return;
    }
    if (kind === 'start') {
      const start = clamp(parsed, 0, Math.max(0, state.video.duration - MIN_DURATION));
      state.selection.start = start;
      state.selection.duration = Math.max(
        MIN_DURATION,
        Math.min(state.selection.duration, state.video.duration - start)
      );
      seekTo(start);
    } else {
      const duration = clamp(
        parsed,
        MIN_DURATION,
        Math.max(MIN_DURATION, state.video.duration - state.selection.start)
      );
      state.selection.duration = duration;
    }
    touchSelectedClip();
    saveClipsNow();
    refreshSelectionUI();
    renderClips();
    renderTimelineClips();
  }

  function timeInputKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.target.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      const isStart = event.target === el.startInput;
      event.target.value = formatInputTime(
        isStart ? state.selection.start : state.selection.duration
      );
      event.target.blur();
    }
  }

  /* ================================== Crop ================================== */

  function cropPixelsFor(crop) {
    if (!state.video) return { x: 0, y: 0, w: 2, h: 2 };
    const W = state.video.width;
    const H = state.video.height;
    let w = Math.max(2, evenCoord(Math.round(crop.w * W)));
    let h = Math.max(2, evenCoord(Math.round(crop.h * H)));
    w = Math.min(w, Math.max(2, evenCoord(W)));
    h = Math.min(h, Math.max(2, evenCoord(H)));
    let x = clamp(Math.round(crop.x * W), 0, Math.max(0, W - w));
    let y = clamp(Math.round(crop.y * H), 0, Math.max(0, H - h));
    x = evenCoord(x);
    y = evenCoord(y);
    if (x + w > W) x = Math.max(0, evenCoord(W - w));
    if (y + h > H) y = Math.max(0, evenCoord(H - h));
    return { x, y, w, h };
  }

  function normalizeCropRect(crop) {
    const x = clamp(Number(crop?.x) || 0, 0, 0.9999);
    const y = clamp(Number(crop?.y) || 0, 0, 0.9999);
    const w = clamp(Number(crop?.w) || 1 - x, 0.001, 1 - x);
    const h = clamp(Number(crop?.h) || 1 - y, 0.001, 1 - y);
    return { x, y, w, h };
  }

  function canvasPoint(event) {
    const rect = el.videoCanvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
      y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
    };
  }

  function onCropBoxPointerDown(event) {
    if (!state.video || event.button !== 0) return;
    const handle = event.target.closest('.crop-handle');
    const crop = state.selection.crop;
    if (handle) {
      event.preventDefault();
      event.stopPropagation();
      beginCropResize(handle.dataset.handle, event);
      return;
    }
    const isFull = crop.w > 0.995 && crop.h > 0.995;
    event.preventDefault();
    event.stopPropagation();
    if (isFull) {
      beginCropDraw(event);
    } else {
      beginCropMove(event);
    }
  }

  function onCanvasPointerDown(event) {
    if (!state.video || event.button !== 0) return;
    if (event.target.closest('button, .video-error, .video-loading')) return;
    if (event.target.closest('#cropBox')) return;
    beginCropDraw(event);
  }

  function beginCropDraw(event) {
    if (!state.video || state.rangeDrag || state.seeking) return;
    pauseVideo();
    dismissCropHint();
    const point = canvasPoint(event);
    state.cropDrag = {
      type: 'draw',
      anchor: point,
      startRect: { ...state.selection.crop },
      previousAspect: state.aspect,
      pointerId: event.pointerId,
    };
    state.aspect = 'free';
    state.selection.crop = normalizeCropRect({
      x: point.x,
      y: point.y,
      w: 0.001,
      h: 0.001,
    });
    el.cropBox.classList.add('is-active', 'is-drawing');
    updateChipStates();
    updateCropMetrics();
    try {
      el.videoCanvas.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  function beginCropMove(event) {
    const point = canvasPoint(event);
    state.cropDrag = {
      type: 'move',
      startPoint: point,
      startRect: { ...state.selection.crop },
      pointerId: event.pointerId,
    };
    el.cropBox.classList.add('is-active');
    dismissCropHint();
    try {
      el.cropBox.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  function beginCropResize(handle, event) {
    if (!state.video) return;
    pauseVideo();
    state.cropDrag = {
      type: 'resize',
      handle,
      startRect: { ...state.selection.crop },
      pointerId: event.pointerId,
    };
    el.cropBox.classList.add('is-active');
    dismissCropHint();
    try {
      el.cropBox.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onWindowPointerMove(event) {
    if (state.cropDrag) {
      handleCropPointerMove(event);
    } else if (state.rangeDrag) {
      handleRangePointerMove(event);
    } else if (state.seeking) {
      seekFromTimelinePointer(event);
    }
  }

  function onWindowPointerUp(event) {
    if (state.cropDrag) finishCropDrag(event);
    if (state.rangeDrag) finishRangeDrag();
    if (state.seeking) state.seeking = false;
  }

  function handleCropPointerMove(event) {
    if (!state.video) return;
    const point = canvasPoint(event);
    const drag = state.cropDrag;

    if (drag.type === 'draw') {
      const x = Math.min(drag.anchor.x, point.x);
      const y = Math.min(drag.anchor.y, point.y);
      const w = Math.abs(point.x - drag.anchor.x);
      const h = Math.abs(point.y - drag.anchor.y);
      const minW = Math.max(0.004, 10 / Math.max(1, el.videoCanvas.clientWidth));
      const minH = Math.max(0.004, 10 / Math.max(1, el.videoCanvas.clientHeight));
      state.selection.crop = normalizeCropRect({
        x,
        y,
        w: Math.max(minW, w),
        h: Math.max(minH, h),
      });
    } else if (drag.type === 'move') {
      const dx = point.x - drag.startPoint.x;
      const dy = point.y - drag.startPoint.y;
      const w = drag.startRect.w;
      const h = drag.startRect.h;
      state.selection.crop = {
        x: clamp(drag.startRect.x + dx, 0, 1 - w),
        y: clamp(drag.startRect.y + dy, 0, 1 - h),
        w,
        h,
      };
    } else if (drag.type === 'resize') {
      state.selection.crop = computeCropResize(drag, point);
    }

    touchSelectedClip();
    updateCropMetrics();
    updateContextUI();
    updateChipStates();
    scheduleSaveClips();
  }

  function computeCropResize(drag, point) {
    const rect = el.videoCanvas.getBoundingClientRect();
    const W = Math.max(1, rect.width);
    const H = Math.max(1, rect.height);
    const handle = drag.handle;
    const start = drag.startRect;
    const px = {
      x: start.x * W,
      y: start.y * H,
      w: start.w * W,
      h: start.h * H,
    };
    const pointer = { x: point.x * W, y: point.y * H };
    const minPx = 22;
    const ratio = aspectValue(state.aspect);
    let x;
    let y;
    let w;
    let h;

    if (!ratio) {
      let left = px.x;
      let top = px.y;
      let right = px.x + px.w;
      let bottom = px.y + px.h;
      if (handle.includes('e')) {
        right = clamp(pointer.x, left + minPx, W);
      }
      if (handle.includes('w')) {
        left = clamp(pointer.x, 0, right - minPx);
      }
      if (handle.includes('s')) {
        bottom = clamp(pointer.y, top + minPx, H);
      }
      if (handle.includes('n')) {
        top = clamp(pointer.y, 0, bottom - minPx);
      }
      x = left;
      y = top;
      w = right - left;
      h = bottom - top;
    } else if (handle === 'n' || handle === 's') {
      const centerX = px.x + px.w / 2;
      const anchorY = handle === 's' ? px.y : px.y + px.h;
      const maxHByWidth = (2 * Math.min(centerX, W - centerX)) / ratio;
      const maxHEdge = handle === 's' ? H - anchorY : anchorY;
      let desiredH = handle === 's' ? pointer.y - anchorY : anchorY - pointer.y;
      desiredH = clamp(desiredH, minPx, Math.max(minPx, Math.min(maxHByWidth, maxHEdge, H)));
      h = desiredH;
      w = h * ratio;
      x = clamp(centerX - w / 2, 0, W - w);
      y = handle === 's' ? anchorY : anchorY - h;
    } else if (handle === 'e' || handle === 'w') {
      const centerY = px.y + px.h / 2;
      const anchorX = handle === 'e' ? px.x : px.x + px.w;
      const maxWByHeight = (2 * Math.min(centerY, H - centerY)) * ratio;
      const maxWEdge = handle === 'e' ? W - anchorX : anchorX;
      let desiredW = handle === 'e' ? pointer.x - anchorX : anchorX - pointer.x;
      desiredW = clamp(desiredW, minPx, Math.max(minPx, Math.min(maxWByHeight, maxWEdge, W)));
      w = desiredW;
      h = w / ratio;
      x = handle === 'e' ? anchorX : anchorX - w;
      y = clamp(centerY - h / 2, 0, H - h);
    } else {
      const east = handle.includes('e');
      const south = handle.includes('s');
      const anchorX = east ? px.x : px.x + px.w;
      const anchorY = south ? px.y : px.y + px.h;
      const maxW = east ? W - anchorX : anchorX;
      const maxH = south ? H - anchorY : anchorY;
      const desiredW = east ? pointer.x - anchorX : anchorX - pointer.x;
      const desiredH = south ? pointer.y - anchorY : anchorY - pointer.y;
      const useWidth =
        desiredW / Math.max(1, px.w) >= desiredH / Math.max(1, px.h);
      w = useWidth ? desiredW : desiredH * ratio;
      h = useWidth ? desiredW / ratio : desiredH;
      w = Math.max(w, minPx);
      h = Math.max(h, minPx / ratio);
      const scale = Math.min(1, maxW / w, maxH / h);
      w *= scale;
      h *= scale;
      x = east ? anchorX : anchorX - w;
      y = south ? anchorY : anchorY - h;
    }

    w = Math.max(2, w);
    h = Math.max(2, h);
    x = clamp(x, 0, W - w);
    y = clamp(y, 0, H - h);
    return normalizeCropRect({ x: x / W, y: y / H, w: w / W, h: h / H });
  }

  function finishCropDrag() {
    if (!state.cropDrag) return;
    const drag = state.cropDrag;
    if (drag.type === 'draw') {
      const crop = state.selection.crop;
      const displayWidth = crop.w * el.videoCanvas.clientWidth;
      const displayHeight = crop.h * el.videoCanvas.clientHeight;
      if (displayWidth < 12 || displayHeight < 12) {
        state.selection.crop = drag.startRect;
        state.aspect = drag.previousAspect || 'free';
      }
    }
    state.cropDrag = null;
    el.cropBox.classList.remove('is-active', 'is-drawing');
    saveClipsNow();
    touchSelectedClip({ thumb: false });
    if (selectedClip()) scheduleThumbnail(selectedClip(), 120);
    refreshSelectionUI();
    renderClips();
    renderTimelineClips();
  }

  function dismissCropHint() {
    if (state.cropHintDismissed) return;
    state.cropHintDismissed = true;
    el.cropHint.classList.add('is-hidden');
  }

  /* ================================ Timeline ================================ */

  function timeFromClientX(clientX) {
    const rect = el.timelineTrack.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    return ratio * (state.video?.duration || 0);
  }

  function onTimelinePointerDown(event) {
    if (!state.video || event.button !== 0) return;
    if (event.target.closest('.range-handle, .lane-clip')) return;
    event.preventDefault();
    pauseVideo();
    state.seeking = true;
    seekTo(timeFromClientX(event.clientX));
    try {
      el.timelineTrack.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  function seekFromTimelinePointer(event) {
    if (!state.video) return;
    seekTo(timeFromClientX(event.clientX));
  }

  function onTimelineHover(event) {
    if (!state.video || state.seeking || state.rangeDrag) return;
    const time = timeFromClientX(event.clientX);
    const rect = el.timelineTrack.getBoundingClientRect();
    el.timelineHover.hidden = false;
    el.timelineHover.textContent = formatClock(time);
    el.timelineHover.style.left = `${clamp(event.clientX - rect.left, 20, rect.width - 20)}px`;
  }

  function hideTimelineHover() {
    el.timelineHover.hidden = true;
  }

  function beginRangeDrag(event, edge) {
    if (!state.video || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    pauseVideo();
    dismissCropHint();
    state.rangeDrag = {
      edge,
      fixedEnd: state.selection.start + state.selection.duration,
      fixedStart: state.selection.start,
    };
    const handle = edge === 'start' ? el.rangeStartHandle : el.rangeEndHandle;
    handle.classList.add('dragging');
    handleRangePointerMove(event);
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  function handleRangePointerMove(event) {
    if (!state.video || !state.rangeDrag) return;
    const time = timeFromClientX(event.clientX);
    if (state.rangeDrag.edge === 'start') {
      const end = state.rangeDrag.fixedEnd;
      const start = clamp(time, 0, end - MIN_DURATION);
      state.selection.start = start;
      state.selection.duration = end - start;
      seekTo(start);
    } else {
      const start = state.rangeDrag.fixedStart;
      const end = clamp(time, start + MIN_DURATION, state.video.duration);
      state.selection.start = start;
      state.selection.duration = end - start;
      seekTo(end);
    }
    touchSelectedClip({ thumb: false });
    updateRangeUI();
    updateContextUI();
    updateLaneClip();
    scheduleSaveClips();
  }

  function finishRangeDrag() {
    if (!state.rangeDrag) return;
    state.rangeDrag = null;
    el.rangeStartHandle.classList.remove('dragging');
    el.rangeEndHandle.classList.remove('dragging');
    saveClipsNow();
    if (selectedClip()) scheduleThumbnail(selectedClip(), 140);
    refreshSelectionUI();
    renderClips();
    renderTimelineClips();
  }

  function renderTimelineRuler() {
    if (!state.video) return;
    const duration = state.video.duration;
    const interval = niceInterval(duration);
    const ticks = [];
    for (let t = 0; t <= duration + interval * 0.1 && ticks.length < 24; t += interval) {
      ticks.push(Math.min(t, duration));
    }
    if (ticks.length === 0) ticks.push(0);
    const last = ticks[ticks.length - 1];
    if (duration - last > interval * 0.45) ticks.push(duration);

    el.timelineRuler.innerHTML = ticks
      .map((time, index) => {
        const percent = (time / duration) * 100;
        const classes = [
          'ruler-label',
          index === 0 ? 'first' : '',
          percent > 93 ? 'last' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `<span class="${classes}" style="left:${percent}%">${formatRulerTime(time, interval)}</span>`;
      })
      .join('');

    el.trackTicks.innerHTML = ticks
      .map((time) => `<span class="track-tick" style="left:${(time / duration) * 100}%"></span>`)
      .join('');
  }

  function niceInterval(duration) {
    const ideal = duration / 7;
    const steps = [
      0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200,
    ];
    return steps.find((step) => step >= ideal) || 7200;
  }

  /* ================================ Playback ================================ */

  function togglePlay() {
    if (!state.video || !state.videoReady) {
      if (!el.videoError.hidden) {
        toast('Prepare a preview before playing this video.', { type: 'info' });
      }
      return;
    }
    if (el.video.paused) {
      if (state.loop) {
        const end = state.selection.start + state.selection.duration;
        const time = el.video.currentTime;
        if (time < state.selection.start - 0.02 || time >= end - 0.02) {
          seekTo(state.selection.start);
        }
      }
      if (el.video.ended || el.video.currentTime >= state.video.duration - 0.01) {
        seekTo(state.loop ? state.selection.start : 0);
      }
      el.video.play().catch(() => {
        toast('Playback was blocked by the browser. Try again.', { type: 'info' });
      });
    } else {
      pauseVideo();
    }
  }

  function pauseVideo() {
    if (!el.video.paused) el.video.pause();
  }

  function seekTo(time) {
    if (!state.video) return;
    const target = clamp(time, 0, Math.max(0, state.video.duration));
    state.pendingSeek = target;
    if (el.video.readyState >= 1) {
      try {
        el.video.currentTime = target;
      } catch {
        /* ignore */
      }
    }
    updatePlaybackDisplay(target);
  }

  function updatePlaybackDisplay(overrideTime) {
    if (!state.video) return;
    const duration = Math.max(0.001, state.video.duration);
    const time = clamp(
      Number.isFinite(overrideTime) ? overrideTime : el.video.currentTime || 0,
      0,
      duration
    );
    el.playhead.style.left = `${(time / duration) * 100}%`;
    el.currentTime.textContent = formatClock(time);
    el.totalTime.textContent = formatClock(state.video.duration);
  }

  function onVideoPlay() {
    state.playing = true;
    el.playBtn.classList.add('is-playing');
    el.playBtn.setAttribute('aria-label', 'Pause');
    if (state.loop) {
      const end = state.selection.start + state.selection.duration;
      if (
        el.video.currentTime < state.selection.start - 0.02 ||
        el.video.currentTime >= end - 0.02
      ) {
        seekTo(state.selection.start);
      }
    }
    startPlaybackLoop();
  }

  function onVideoPause() {
    state.playing = false;
    el.playBtn.classList.remove('is-playing');
    el.playBtn.setAttribute('aria-label', 'Play');
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    updatePlaybackDisplay();
  }

  function onVideoEnded() {
    if (state.loop && state.video) {
      seekTo(state.selection.start);
      el.video.play().catch(() => {});
    }
  }

  function startPlaybackLoop() {
    if (state.rafId) return;
    const tick = () => {
      if (!state.playing || !state.video) {
        state.rafId = null;
        return;
      }
      if (el.video.paused) {
        state.playing = false;
        state.rafId = null;
        el.playBtn.classList.remove('is-playing');
        el.playBtn.setAttribute('aria-label', 'Play');
        updatePlaybackDisplay();
        return;
      }
      if (state.loop) {
        const end = state.selection.start + state.selection.duration;
        if (el.video.currentTime >= end - 0.015) {
          seekTo(state.selection.start);
        }
      }
      updatePlaybackDisplay();
      state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
  }

  function setLoop(enabled, silent) {
    state.loop = Boolean(enabled);
    el.loopBtn.classList.toggle('active', state.loop);
    el.loopBtn.classList.toggle('is-on', state.loop);
    el.loopBtn.setAttribute('aria-pressed', String(state.loop));
    el.loopBtn.title = state.loop ? 'Looping selected range (L)' : 'Loop selected range (L)';
    if (!silent && state.video) {
      toast(state.loop ? 'Looping the selected range' : 'Loop off', { type: 'info', duration: 1600 });
    }
  }

  function setMuted(muted, silent) {
    state.muted = Boolean(muted);
    el.video.muted = state.muted;
    if (!state.muted && state.volume === 0) {
      state.volume = 1;
      el.video.volume = 1;
      el.volumeSlider.value = '1';
    }
    updateMuteUI();
    if (!silent) {
      toast(state.muted ? 'Muted' : 'Sound on', { type: 'info', duration: 1300 });
    }
  }

  function updateMuteUI() {
    const muted = state.muted || el.video.muted;
    state.muted = muted;
    el.muteBtn.classList.toggle('is-muted', muted);
    el.muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    el.muteBtn.title = muted ? 'Unmute (M)' : 'Mute (M)';
    el.volumeSlider.value = String(muted ? 0 : state.volume);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.stage.requestFullscreen();
      }
    } catch (error) {
      toast('Fullscreen is unavailable in this browser.', { type: 'info' });
    }
  }

  function onFullscreenChange() {
    const active = document.fullscreenElement === el.stage;
    const use = el.fullscreenBtn.querySelector('use');
    if (use) use.setAttribute('href', active ? '#i-shrink' : '#i-expand');
    el.fullscreenBtn.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Fullscreen');
    requestAnimationFrame(fitCanvas);
  }

  function onWindowResize() {
    fitCanvas();
    if (el.previewDialog.open) fitPreviewFrame();
    updateTabIndicator();
  }

  function fitCanvas() {
    if (!state.video || el.editorView.hidden) return;
    const style = getComputedStyle(el.playerArea);
    const padX =
      parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
    const padY =
      parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0');
    const availableWidth = el.playerArea.clientWidth - padX;
    const availableHeight = el.playerArea.clientHeight - padY;
    if (availableWidth <= 0 || availableHeight <= 0) return;

    const aspect =
      state.displayAspect ||
      (state.video.width && state.video.height
        ? state.video.width / state.video.height
        : 16 / 9);
    let width = availableWidth;
    let height = width / aspect;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * aspect;
    }
    el.videoCanvas.style.width = `${Math.max(1, Math.floor(width))}px`;
    el.videoCanvas.style.height = `${Math.max(1, Math.floor(height))}px`;
    updateCropMetrics();
  }

  /* ================================ Thumbs ================================= */

  function setupThumbSource() {
    if (!state.playbackSrc) return;
    if (el.thumbVideo.getAttribute('src') === state.playbackSrc) return;
    el.thumbVideo.src = state.playbackSrc;
    el.thumbVideo.load();
  }

  function clearThumbnails() {
    for (const clip of state.clips) clip.thumb = null;
    for (const thumb of el.clipList.querySelectorAll('.clip-thumb')) {
      thumb.classList.remove('has-thumb');
      thumb.style.backgroundImage = '';
    }
    state.thumbQueue = [];
    for (const timer of state.thumbTimers.values()) clearTimeout(timer);
    state.thumbTimers.clear();
  }

  function queueAllThumbnails() {
    if (!state.video) return;
    for (const clip of state.clips) scheduleThumbnail(clip, 60);
  }

  function scheduleThumbnail(clip, delay = 300) {
    if (!clip) return;
    const existing = state.thumbTimers.get(clip.id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      state.thumbTimers.delete(clip.id);
      enqueueThumbnail(clip.id);
    }, delay);
    state.thumbTimers.set(clip.id, timer);
  }

  function thumbnailSignature(clip) {
    return JSON.stringify([
      Math.round(clip.crop.x * 10000),
      Math.round(clip.crop.y * 10000),
      Math.round(clip.crop.w * 10000),
      Math.round(clip.crop.h * 10000),
      Math.round(clip.start * 1000),
      Math.round(clip.duration * 1000),
    ]);
  }

  function enqueueThumbnail(clipId) {
    const clip = state.clips.find((item) => item.id === clipId);
    if (!clip) return;
    const signature = thumbnailSignature(clip);
    const queued = state.thumbQueue.find((item) => item.id === clipId);
    if (queued) {
      queued.signature = signature;
      return;
    }
    state.thumbQueue.push({ id: clipId, signature });
    pumpThumbQueue();
  }

  async function pumpThumbQueue() {
    if (state.thumbBusy || !state.video || state.thumbQueue.length === 0) return;
    const item = state.thumbQueue.shift();
    const clip = state.clips.find((entry) => entry.id === item.id);
    if (!clip) {
      pumpThumbQueue();
      return;
    }

    state.thumbBusy = true;
    try {
      await waitForThumbReady();
      const seekTime = clamp(
        clip.start + clip.duration / 2,
        0,
        Math.max(0, (el.thumbVideo.duration || state.video.duration) - 0.05)
      );
      await seekThumbVideo(seekTime);
      const current = state.clips.find((entry) => entry.id === item.id);
      if (!current || thumbnailSignature(current) !== item.signature) {
        if (current) enqueueThumbnail(current.id);
        state.thumbBusy = false;
        pumpThumbQueue();
        return;
      }
      const dataUrl = drawThumbnail(current);
      if (dataUrl) {
        current.thumb = dataUrl;
        const thumb = el.clipList.querySelector(
          `[data-clip-id="${cssEscape(current.id)}"] .clip-thumb`
        );
        if (thumb) {
          thumb.classList.add('has-thumb');
          thumb.style.backgroundImage = `url('${dataUrl}')`;
        }
      }
    } catch (error) {
      console.warn('[thumbnail]', error.message);
    } finally {
      state.thumbBusy = false;
      if (state.thumbQueue.length) pumpThumbQueue();
    }
  }

  function waitForThumbReady() {
    if (el.thumbVideo.readyState >= 2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Thumbnail source timed out'));
      }, 10000);
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Thumbnail source failed'));
      };
      const cleanup = () => {
        clearTimeout(timeout);
        el.thumbVideo.removeEventListener('loadeddata', onReady);
        el.thumbVideo.removeEventListener('error', onError);
      };
      el.thumbVideo.addEventListener('loadeddata', onReady);
      el.thumbVideo.addEventListener('error', onError);
    });
  }

  function seekThumbVideo(time) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        el.thumbVideo.removeEventListener('seeked', finish);
        resolve();
      };
      const timeout = setTimeout(finish, 4500);
      el.thumbVideo.addEventListener('seeked', finish);
      try {
        el.thumbVideo.currentTime = time;
      } catch {
        finish();
      }
    });
  }

  function drawThumbnail(clip) {
    const video = el.thumbVideo;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const sx = clamp(Math.round(clip.crop.x * vw), 0, vw - 1);
    const sy = clamp(Math.round(clip.crop.y * vh), 0, vh - 1);
    const sw = Math.max(1, Math.min(vw - sx, Math.round(clip.crop.w * vw)));
    const sh = Math.max(1, Math.min(vh - sy, Math.round(clip.crop.h * vh)));
    const scale = Math.min(480 / sw, 480 / sh);
    const tw = Math.max(2, Math.round(sw * scale));
    const th = Math.max(2, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(video, sx, sy, sw, sh, 0, 0, tw, th);
    try {
      return canvas.toDataURL('image/jpeg', 0.84);
    } catch {
      return null;
    }
  }

  /* ================================ Exports ================================ */

  function onExportAllClick() {
    if (state.jobs.some(isActiveJob)) {
      setInspectorTab('exports');
      return;
    }
    if (state.clips.length === 0) {
      toast('Add a clip first, then export.', { type: 'info' });
      return;
    }
    startExport(state.clips);
  }

  function exportClipById(clipId) {
    const clip = state.clips.find((item) => item.id === clipId);
    if (!clip) return;
    startExport([clip]);
  }

  async function startExport(clips) {
    if (!state.video || clips.length === 0 || state.exportStarting) return;
    const videoId = state.video.id;
    state.exportStarting = true;
    try {
      const payload = {
        videoId,
        clips: clips.map((clip, index) => ({
          clipId: clip.id,
          name: clip.name || `Clip ${index + 1}`,
          crop: clip.crop,
          start: clip.start,
          duration: clip.duration,
          format: clip.format,
          quality: clip.quality,
        })),
      };
      const data = await apiJSON('/api/exports', 'POST', payload);
      if (!state.video || state.video.id !== videoId) return;
      for (const job of data.jobs || []) {
        if (!state.jobs.some((existing) => existing.id === job.id)) {
          state.jobs.push(job);
        }
        state.watchedJobIds.add(job.id);
      }
      state.watchedNotified = false;
      setInspectorTab('exports');
      renderExports();
      updateExportIndicators();
      scheduleJobPolling();
      toast(
        `${payload.clips.length} clip${payload.clips.length === 1 ? '' : 's'} queued for export`,
        { type: 'success' }
      );
      requestAnimationFrame(() => {
        el.inspectorScroll.scrollTop = 0;
        updateTabIndicator();
      });
    } catch (error) {
      toast(error.message, { type: 'error' });
    } finally {
      state.exportStarting = false;
    }
  }

  async function refreshJobs(options = {}) {
    if (!state.video) return;
    const videoId = state.video.id;
    try {
      const data = await api(`/api/exports?videoId=${encodeURIComponent(videoId)}`);
      if (!state.video || state.video.id !== videoId) return;
      state.jobs = data.jobs || [];
      renderExports();
      updateExportIndicators();
      checkWatchedJobs();
      if (options.initial && state.jobs.some(isActiveJob)) {
        setInspectorTab('exports');
      }
    } catch (error) {
      console.warn('[exports]', error.message);
    }
  }

  function scheduleJobPolling() {
    stopJobPolling();
    if (!state.video) return;
    if (!state.jobs.some(isActiveJob)) return;
    state.jobPollTimer = setTimeout(async () => {
      await refreshJobs();
      scheduleJobPolling();
    }, 750);
  }

  function stopJobPolling() {
    if (state.jobPollTimer) {
      clearTimeout(state.jobPollTimer);
      state.jobPollTimer = null;
    }
  }

  function checkWatchedJobs() {
    if (state.watchedJobIds.size === 0 || state.watchedNotified) return;
    const watched = state.jobs.filter((job) => state.watchedJobIds.has(job.id));
    const stillActive = watched.some(isActiveJob);
    if (stillActive) return;

    state.watchedNotified = true;
    const done = watched.filter((job) => job.status === 'done').length;
    const errors = watched.filter((job) => job.status === 'error').length;
    const missing = state.watchedJobIds.size - watched.length;
    if (done > 0) {
      toast(
        `${done} clip${done === 1 ? '' : 's'} exported${errors || missing ? `, ${errors + missing} failed` : ''}`,
        {
          type: errors ? 'error' : 'success',
          duration: 6500,
          action: {
            label: 'Download .zip',
            onClick: downloadArchive,
          },
        }
      );
    } else if (errors > 0 || missing > 0) {
      toast(
        `${errors + missing} export${errors + missing === 1 ? '' : 's'} failed`,
        {
          type: 'error',
          action: {
            label: 'View',
            onClick: () => setInspectorTab('exports'),
          },
        }
      );
    }
    state.watchedJobIds.clear();
  }

  function isActiveJob(job) {
    return job.status === 'queued' || job.status === 'processing';
  }

  function renderExports() {
    const jobs = [...state.jobs];
    const active = jobs.filter(isActiveJob);
    const done = jobs.filter((job) => job.status === 'done');
    const errors = jobs.filter((job) => job.status === 'error');
    const doneBytes = done.reduce((sum, job) => sum + (job.fileSize || 0), 0);
    const activeProgress = active.length
      ? Math.round(
          active.reduce((sum, job) => sum + (job.progress || 0), 0) / active.length
        )
      : 0;

    el.exportSummaryCard.classList.toggle('is-active', active.length > 0);
    if (active.length) {
      el.exportSummaryTitle.textContent = `${active.length} export${active.length === 1 ? '' : 's'} in progress`;
      el.exportSummaryText.textContent = `${activeProgress}% overall · ${done.length} finished`;
    } else if (done.length) {
      el.exportSummaryTitle.textContent = `${done.length} clip${done.length === 1 ? '' : 's'} ready`;
      el.exportSummaryText.textContent = `${formatBytes(doneBytes)} total · download individually or as a ZIP`;
    } else if (errors.length) {
      el.exportSummaryTitle.textContent = 'Exports need attention';
      el.exportSummaryText.textContent = `${errors.length} export${errors.length === 1 ? '' : 's'} failed — open the list for details`;
    } else {
      el.exportSummaryTitle.textContent = 'Nothing exported yet';
      el.exportSummaryText.textContent = state.clips.length
        ? `Export all ${state.clips.length} clip${state.clips.length === 1 ? '' : 's'} in one batch.`
        : 'Export a clip and it will show up here.';
    }

    const noClips = state.clips.length === 0;
    el.exportPanelExportAll.disabled = noClips || active.length > 0;
    el.exportPanelExportAll.hidden = active.length > 0;
    el.downloadAllBtn.disabled = done.length === 0;
    el.exportEmpty.hidden = jobs.length > 0;
    el.exportList.hidden = jobs.length === 0;

    const activeIndex = new Map(active.map((job, index) => [job.id, index + 1]));
    const ordered = [...active, ...jobs.filter((job) => !isActiveJob(job)).reverse()];

    el.exportList.innerHTML = ordered
      .map((job) => {
        const index = clipIndex(job.clipId);
        const color = index >= 0 ? clipColorForIndex(index) : '#5b6069';
        const number = index >= 0 ? pad2(index + 1) : pad2(Math.max(1, jobs.indexOf(job) + 1));
        const format = String(job.format || 'mp4').toUpperCase();
        const isDone = job.status === 'done';
        const isError = job.status === 'error';
        const isQueued = job.status === 'queued';
        const progress = isDone ? 100 : job.progress || 0;
        const statusClass = isDone ? 'done' : isError ? 'error' : '';
        let statusText = 'Queued for export';
        if (job.status === 'processing') statusText = 'Rendering';
        if (isQueued && activeIndex.has(job.id)) {
          statusText = `Queued · ${activeIndex.get(job.id)} of ${active.length}`;
        }
        if (isDone) {
          statusText = job.outputWidth && job.outputHeight
            ? `Ready · ${job.outputWidth}×${job.outputHeight}`
            : 'Ready to download';
        }
        if (isError) statusText = job.error || 'Export failed';

        let actions = '';
        if (isDone) {
          actions += `<a class="job-action download" href="${safeAttr(job.downloadUrl)}" download title="Download clip" aria-label="Download clip"><svg class="icon"><use href="#i-download"></use></svg></a>`;
        } else if (isError) {
          const clipExists = state.clips.some((clip) => clip.id === job.clipId);
          if (clipExists) {
            actions += `<button class="job-action" type="button" data-job-action="retry" data-job-id="${safeAttr(job.id)}" title="Retry export" aria-label="Retry export"><svg class="icon"><use href="#i-reset"></use></svg></button>`;
          }
        }
        actions += `<button class="job-action danger" type="button" data-job-action="delete" data-job-id="${safeAttr(job.id)}" title="${isActiveJob(job) ? 'Cancel export' : 'Remove export'}" aria-label="${isActiveJob(job) ? 'Cancel export' : 'Remove export'}"><svg class="icon"><use href="#i-x"></use></svg></button>`;

        return `
          <div class="export-job ${isActiveJob(job) ? 'is-active' : ''} ${isDone ? 'is-done' : ''} ${isError ? 'is-error' : ''}" data-job-id="${safeAttr(job.id)}" style="--clip-color:${color}">
            <span class="export-job-swatch">${number}</span>
            <div class="export-job-main">
              <div class="export-job-top">
                <span class="export-job-name" title="${safeAttr(job.clipName)}">${escapeHtml(job.clipName)}</span>
                <span class="job-format">${format}</span>
                ${isDone ? `<span class="job-size">${formatBytes(job.fileSize || 0)}</span>` : ''}
              </div>
              <div class="job-progress-track"><span class="job-progress-bar" style="width:${progress}%"></span></div>
              <div class="job-status-row">
                <span class="job-status ${statusClass}" title="${safeAttr(statusText)}">${escapeHtml(statusText)}</span>
                ${job.status === 'processing' ? `<span class="job-progress-number">${progress}%</span>` : ''}
              </div>
            </div>
            <div class="export-job-actions">${actions}</div>
          </div>`;
      })
      .join('');

    updateExportIndicators();
    updateTabIndicator();
  }

  async function onExportListClick(event) {
    const button = event.target.closest('[data-job-action]');
    if (!button) return;
    const jobId = button.dataset.jobId;
    const action = button.dataset.jobAction;
    if (action === 'delete') {
      try {
        await api(`/api/exports/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
        state.jobs = state.jobs.filter((job) => job.id !== jobId);
        state.watchedJobIds.delete(jobId);
        renderExports();
        updateExportIndicators();
        toast('Export removed', { type: 'info' });
      } catch (error) {
        toast(error.message, { type: 'error' });
      }
    } else if (action === 'retry') {
      const job = state.jobs.find((item) => item.id === jobId);
      const clip = job && state.clips.find((item) => item.id === job.clipId);
      if (clip) {
        exportClipById(clip.id);
      } else {
        toast('The original clip no longer exists. Add it again to export.', { type: 'info' });
      }
    }
  }

  function updateExportIndicators() {
    const active = state.jobs.filter(isActiveJob);
    const progress = active.length
      ? Math.round(active.reduce((sum, job) => sum + (job.progress || 0), 0) / active.length)
      : 0;
    el.exportButtonProgress.style.width = `${active.length ? Math.max(3, progress) : 0}%`;
    el.exportAllBtn.classList.toggle('is-exporting', active.length > 0);
    el.exportAllLabel.textContent = active.length > 0 ? 'Exporting' : 'Export all';
    el.exportAllCount.textContent = String(
      active.length > 0 ? active.length : state.clips.length
    );
    el.exportAllCount.hidden = active.length === 0 && state.clips.length === 0;
    el.exportAllBtn.title = active.length
      ? `${active.length} export${active.length === 1 ? '' : 's'} in progress — open the exports panel`
      : state.clips.length
        ? 'Export all clips'
        : 'Add a clip first';
    if (state.clips.length === 0 && active.length === 0) {
      el.exportAllBtn.disabled = true;
    } else {
      el.exportAllBtn.disabled = false;
    }

    if (active.length) {
      el.exportsTabBadge.hidden = false;
      el.exportsTabBadge.textContent = String(active.length);
      el.exportsTabBadge.classList.add('has-progress');
    } else if (state.jobs.length) {
      el.exportsTabBadge.hidden = false;
      el.exportsTabBadge.textContent = String(state.jobs.length);
      el.exportsTabBadge.classList.remove('has-progress');
    } else {
      el.exportsTabBadge.hidden = true;
      el.exportsTabBadge.classList.remove('has-progress');
    }

    el.exportAllSecondary.disabled = state.clips.length === 0;
    el.exportEmpty.hidden = state.jobs.length > 0;
    updateTabIndicator();
  }

  function downloadArchive() {
    if (!state.video) return;
    const done = state.jobs.filter((job) => job.status === 'done');
    if (!done.length) {
      toast('Finish an export before downloading the ZIP.', { type: 'info' });
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = `/api/exports/archive?videoId=${encodeURIComponent(state.video.id)}`;
    anchor.download = '';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    toast(`Zipping ${done.length} clip${done.length === 1 ? '' : 's'}…`, { type: 'info' });
  }

  /* ================================= Tabs ================================== */

  function setInspectorTab(tab, options = {}) {
    state.activeTab = tab === 'exports' ? 'exports' : 'clip';
    el.clipPanel.hidden = state.activeTab !== 'clip';
    el.exportsPanel.hidden = state.activeTab !== 'exports';
    for (const button of [el.clipTab, el.exportsTab]) {
      const active = button.dataset.tab === state.activeTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    }
    requestAnimationFrame(updateTabIndicator);
    if (state.activeTab === 'exports' && options.refresh !== false && state.video) {
      refreshJobs();
    }
  }

  function updateTabIndicator() {
    if (!el.tabIndicator || el.editorView.hidden) return;
    const active = state.activeTab === 'exports' ? el.exportsTab : el.clipTab;
    if (!active) return;
    el.tabIndicator.style.left = `${active.offsetLeft}px`;
    el.tabIndicator.style.width = `${active.offsetWidth}px`;
  }

  /* ================================ Preview ================================ */

  function openPreview(clip) {
    if (!state.video) return;
    pauseVideo();
    const data = clip
      ? {
          name: clip.name,
          crop: { ...clip.crop },
          start: clip.start,
          duration: clip.duration,
          format: clip.format,
          quality: clip.quality,
        }
      : {
          name: state.selection.name,
          crop: { ...state.selection.crop },
          start: state.selection.start,
          duration: state.selection.duration,
          format: state.selection.format,
          quality: state.selection.quality,
        };
    const editClipId = clip?.id || state.selectedClipId || null;
    state.preview.data = data;
    state.preview.editClipId = editClipId;
    state.preview.playWhenReady = true;

    el.previewKicker.textContent = data.name ? 'Cropped preview' : 'Selection preview';
    el.previewTitle.textContent = data.name || 'Untitled clip';
    el.previewMeta.textContent = `${cropPixelsFor(data.crop).w} × ${cropPixelsFor(data.crop).h} px · ${data.format.toUpperCase()}`;
    el.previewEditBtn.hidden = !editClipId;
    el.previewPlayBtn.classList.remove('is-playing');
    el.previewLoading.classList.remove('is-hidden');
    el.previewError.hidden = true;
    el.previewProgressBar.style.width = '0%';
    el.previewTime.textContent = `0:00.0 / ${formatClock(data.duration)}`;

    const outputAspect =
      (data.crop.w * state.video.width) / (data.crop.h * state.video.height);
    el.previewFrame.style.aspectRatio = String(outputAspect);
    el.previewVideo.style.width = `${(1 / data.crop.w) * 100}%`;
    el.previewVideo.style.height = `${(1 / data.crop.h) * 100}%`;
    el.previewVideo.style.left = `${(-data.crop.x / data.crop.w) * 100}%`;
    el.previewVideo.style.top = `${(-data.crop.y / data.crop.h) * 100}%`;
    el.previewVideo.muted = state.muted;
    el.previewVideo.volume = state.volume;

    el.previewDialog.showModal();
    requestAnimationFrame(fitPreviewFrame);

    el.previewVideo.src = state.playbackSrc;
    el.previewVideo.load();
  }

  function fitPreviewFrame() {
    if (!state.preview.data) return;
    const data = state.preview.data;
    const stageRect = el.previewStage.getBoundingClientRect();
    const style = getComputedStyle(el.previewStage);
    const padX =
      parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
    const padY =
      parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0');
    const availableWidth = Math.max(40, stageRect.width - padX);
    const availableHeight = Math.max(40, stageRect.height - padY);
    const aspect =
      (data.crop.w * state.video.width) / (data.crop.h * state.video.height);
    let width = availableWidth;
    let height = width / aspect;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * aspect;
    }
    el.previewFrame.style.width = `${Math.floor(width)}px`;
    el.previewFrame.style.height = `${Math.floor(height)}px`;
  }

  function onPreviewMetadata() {
    const data = state.preview.data;
    if (!data) return;
    try {
      el.previewVideo.currentTime = clamp(
        data.start,
        0,
        Math.max(0, (el.previewVideo.duration || state.video.duration) - 0.01)
      );
    } catch {
      /* ignore */
    }
  }

  function onPreviewLoaded() {
    if (!state.preview.data) return;
    el.previewLoading.classList.add('is-hidden');
    if (state.preview.playWhenReady) {
      state.preview.playWhenReady = false;
      el.previewVideo.play().catch(() => {
        updatePreviewPlayState();
      });
    }
  }

  function onPreviewError() {
    if (!state.preview.data) return;
    el.previewLoading.classList.add('is-hidden');
    el.previewError.hidden = false;
  }

  function onPreviewTimeUpdate() {
    const data = state.preview.data;
    if (!data) return;
    const start = data.start;
    const end = start + data.duration;
    if (el.previewVideo.currentTime >= end - 0.02) {
      try {
        el.previewVideo.currentTime = start;
      } catch {
        /* ignore */
      }
    }
    const elapsed = clamp(el.previewVideo.currentTime - start, 0, data.duration);
    el.previewTime.textContent = `${formatClock(elapsed)} / ${formatClock(data.duration)}`;
    el.previewProgressBar.style.width = `${(elapsed / Math.max(0.01, data.duration)) * 100}%`;
    updatePreviewPlayState();
  }

  function updatePreviewPlayState() {
    const playing = !el.previewVideo.paused;
    el.previewPlayBtn.classList.toggle('is-playing', playing);
    el.previewPlayBtn.setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview');
  }

  function togglePreviewPlay(event) {
    event?.stopPropagation();
    if (!state.preview.data) return;
    if (el.previewVideo.paused) {
      const data = state.preview.data;
      const end = data.start + data.duration;
      if (
        el.previewVideo.currentTime < data.start - 0.02 ||
        el.previewVideo.currentTime >= end - 0.02
      ) {
        el.previewVideo.currentTime = data.start;
      }
      el.previewVideo.play().catch(() => {
        el.previewError.hidden = false;
      });
    } else {
      el.previewVideo.pause();
    }
  }

  function onPreviewKeydown(event) {
    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      togglePreviewPlay();
    }
  }

  function onPreviewEdit() {
    const clipId = state.preview.editClipId;
    el.previewDialog.close();
    if (clipId) {
      selectClipById(clipId);
      scrollStageIntoViewIfStacked();
    }
  }

  function cleanupPreview() {
    state.preview.data = null;
    state.preview.editClipId = null;
    state.preview.playWhenReady = false;
    el.previewVideo.pause();
    el.previewVideo.removeAttribute('src');
    el.previewVideo.load();
    el.previewLoading.classList.remove('is-hidden');
    el.previewError.hidden = true;
    el.previewProgressBar.style.width = '0%';
    el.previewPlayBtn.classList.remove('is-playing');
  }

  /* =============================== Dialog bits ============================== */

  function openShortcuts() {
    if (!el.shortcutsDialog.open) el.shortcutsDialog.showModal();
  }

  function confirmAction({ title, message, confirmLabel = 'Delete' }) {
    return new Promise((resolve) => {
      el.confirmTitle.textContent = title;
      el.confirmText.textContent = message;
      el.confirmOkBtn.textContent = confirmLabel;
      let settled = false;

      const settle = (value) => {
        if (settled) return;
        settled = true;
        if (el.confirmDialog.open) el.confirmDialog.close();
        resolve(value);
      };

      el.confirmOkBtn.onclick = () => settle(true);
      el.confirmCancelBtn.onclick = () => settle(false);
      el.confirmDialog.addEventListener(
        'close',
        () => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        },
        { once: true }
      );
      el.confirmDialog.showModal();
    });
  }

  /* ================================= Toasts ================================= */

  function toast(message, options = {}) {
    const { type = 'info', action = null, duration = 4200 } = options;
    while (el.toastStack.children.length >= 3) {
      el.toastStack.firstElementChild?.remove();
    }
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    const icon = type === 'error' ? 'i-alert' : type === 'success' ? 'i-check' : 'i-sparkle';
    node.innerHTML = `
      <span class="toast-icon"><svg class="icon"><use href="#${icon}"></use></svg></span>
      <span class="toast-body"></span>
      ${action ? '<button class="toast-action" type="button"></button>' : ''}
      <button class="toast-close" type="button" aria-label="Dismiss"><svg class="icon"><use href="#i-x"></use></svg></button>
    `;
    node.querySelector('.toast-body').textContent = message;
    const actionButton = node.querySelector('.toast-action');
    if (action && actionButton) {
      actionButton.textContent = action.label;
      actionButton.addEventListener('click', () => {
        action.onClick?.();
        dismiss();
      });
    }
    node.querySelector('.toast-close').addEventListener('click', dismiss);
    el.toastStack.appendChild(node);

    let timer = setTimeout(dismiss, duration);
    node.addEventListener('mouseenter', () => clearTimeout(timer));
    node.addEventListener('mouseleave', () => {
      timer = setTimeout(dismiss, Math.min(2200, duration));
    });

    function dismiss() {
      clearTimeout(timer);
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 190);
    }
  }

  /* ================================ Keyboard =============================== */

  function onGlobalKeydown(event) {
    if (document.querySelector('dialog[open]')) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    if (!state.video || el.editorView.hidden) return;

    const key = event.key;
    const lower = key.toLowerCase();

    if (key === ' ' || event.code === 'Space') {
      event.preventDefault();
      togglePlay();
      return;
    }
    if (lower === 'c') {
      event.preventDefault();
      addClipFromSelection();
      return;
    }
    if (lower === 'n') {
      event.preventDefault();
      startNewSelection();
      return;
    }
    if (lower === 'i') {
      event.preventDefault();
      setInPoint();
      return;
    }
    if (lower === 'o') {
      event.preventDefault();
      setOutPoint();
      return;
    }
    if (lower === 'l') {
      event.preventDefault();
      setLoop(!state.loop);
      return;
    }
    if (lower === 'm') {
      event.preventDefault();
      setMuted(!state.muted);
      return;
    }
    if (lower === 'f') {
      event.preventDefault();
      toggleFullscreen();
      return;
    }
    if (lower === 'p') {
      event.preventDefault();
      openPreview(null);
      return;
    }
    if (key === '?') {
      event.preventDefault();
      openShortcuts();
      return;
    }
    if (key === 'Escape') {
      if (state.selectedClipId) {
        event.preventDefault();
        startNewSelection();
      }
      return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      const fps = state.video.fps || 30;
      const step = event.shiftKey ? 1 : 1 / fps;
      const direction = key === 'ArrowRight' ? 1 : -1;
      seekTo(el.video.currentTime + direction * step);
      return;
    }
    if (key === 'Home') {
      event.preventDefault();
      seekTo(0);
      return;
    }
    if (key === 'End') {
      event.preventDefault();
      seekTo(state.video.duration);
    }
  }

  function isTypingTarget(target) {
    return (
      target instanceof Element &&
      Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
    );
  }

  /* =============================== Navigation =============================== */

  function parseVideoHash() {
    const hash = location.hash.startsWith('#')
      ? location.hash.slice(1)
      : location.hash;
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    return params.get('video');
  }

  function onHashChange() {
    const id = parseVideoHash();
    if (id && id !== state.video?.id) {
      openVideoById(id);
    } else if (!id && !el.editorView.hidden) {
      goHome({ updateHash: false });
    }
  }

  /* ================================= Helpers ================================ */

  async function api(path, options = {}) {
    const response = await fetch(path, options);
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const message =
        (data && typeof data === 'object' && data.error) ||
        (typeof data === 'string' && data) ||
        `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function apiJSON(path, method, body) {
    return api(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function evenCoord(value) {
    return Math.max(0, Math.floor(value / 2) * 2);
  }

  function evenFloor(value) {
    return Math.max(2, evenCoord(value));
  }

  function uid() {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeQuality(value) {
    if (value === 'original' || value === undefined || value === null) return 'original';
    const numeric = Number(value);
    return [1080, 720, 480, 360].includes(numeric) ? numeric : 'original';
  }

  function pad2(value) {
    return String(Math.max(0, Math.floor(value))).padStart(2, '0');
  }

  function pad3(value) {
    return String(Math.max(0, Math.floor(value))).padStart(3, '0');
  }

  function formatClock(seconds, tenths = true) {
    const value = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = Math.floor(value % 60);
    let out = hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(secs)}` : `${minutes}:${pad2(secs)}`;
    if (tenths) {
      out += `.${Math.floor((value % 1) * 10)}`;
    }
    return out;
  }

  function formatRulerTime(seconds, interval) {
    const value = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = Math.floor(value % 60);
    if (interval < 1) {
      const tenths = Math.floor((value % 1) * 10);
      return hours > 0
        ? `${hours}:${pad2(minutes)}:${pad2(secs)}.${tenths}`
        : `${minutes}:${pad2(secs)}.${tenths}`;
    }
    return hours > 0
      ? `${hours}:${pad2(minutes)}:${pad2(secs)}`
      : `${minutes}:${pad2(secs)}`;
  }

  function formatInputTime(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const totalMs = Math.round(value * 1000);
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    return hours > 0
      ? `${hours}:${pad2(minutes)}:${pad2(secs)}.${pad3(ms)}`
      : `${pad2(minutes)}:${pad2(secs)}.${pad3(ms)}`;
  }

  function parseTimeInput(value) {
    const cleaned = String(value || '')
      .trim()
      .replace(',', '.');
    if (!cleaned || cleaned.includes('-')) return NaN;
    if (cleaned.includes(':')) {
      const parts = cleaned.split(':').map((part) => Number(part));
      if (parts.some((part) => !Number.isFinite(part) || part < 0)) return NaN;
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      return NaN;
    }
    const numericString = cleaned.replace(/[^\d.]/g, '');
    if (!/\d/.test(numericString)) return NaN;
    if ((numericString.match(/\./g) || []).length > 1) return NaN;
    const numeric = Number(numericString);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : NaN;
  }

  function formatDurationHuman(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return `${value.toFixed(1)}s`;
    if (value < 3600) {
      const mins = Math.floor(value / 60);
      const secs = Math.round(value % 60);
      return `${mins}m ${pad2(secs)}s`;
    }
    const hours = Math.floor(value / 3600);
    const mins = Math.round((value % 3600) / 60);
    return `${hours}h ${pad2(mins)}m`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    const size = value / 1024 ** index;
    return `${size >= 100 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
  }

  function formatFps(fps) {
    const value = Number(fps) || 0;
    if (!value) return '';
    return `${Math.abs(value - Math.round(value)) < 0.01 ? Math.round(value) : value.toFixed(2)} fps`;
  }

  function cropAspectLabel(value) {
    const aspect = Number(value) || 1;
    const common = [
      [1, '1:1'],
      [16 / 9, '16:9'],
      [9 / 16, '9:16'],
      [4 / 5, '4:5'],
      [4 / 3, '4:3'],
      [3 / 2, '3:2'],
      [2 / 3, '2:3'],
      [21 / 9, '21:9'],
    ];
    const match = common.find(([ratio]) => Math.abs(ratio - aspect) < 0.012);
    if (match) return match[1];
    return aspect < 1
      ? `1:${(1 / aspect).toFixed(2)}`
      : `${aspect.toFixed(2)}:1`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[char];
    });
  }

  function safeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
  }
})();
