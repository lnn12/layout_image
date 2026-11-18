// Config
const PPI = 300;
const MM_TO_INCH = 25.4;

const PAPER_SIZES = {
    'L': { widthMm: 89, heightMm: 127 },
    '2L': { widthMm: 127, heightMm: 178 }
};

// State
let state = {
    paperType: 'L',
    orientation: 'landscape',
    images: [], // { id, bitmap, originalUrl, x, y, width, height, widthMm, heightMm, cropData }
    pendingImageCount: 0,
    editingImageId: null,
    editorReturnFocus: null,
    cropper: null,
    isDragging: false,
    dragTargetId: null,
    dragOffsetX: 0,
    dragOffsetY: 0
};

// DOM Elements
const appContainer = document.querySelector('.app-container');
const canvas = document.getElementById('outputCanvas');
const ctx = canvas.getContext('2d');
const imageInput = document.getElementById('imageInput');
const imageListEl = document.getElementById('imageList');
const cropModal = document.getElementById('cropModal');
const cropImageEl = document.getElementById('cropImage');
const closeModalBtn = document.getElementById('closeModal');
const confirmCropBtn = document.getElementById('confirmCrop');
const deleteImageBtn = document.getElementById('deleteImage');
const cropResolutionEl = document.getElementById('cropResolution');
const cropPpiValueEl = document.getElementById('cropPpiValue');
const cropPpiMessageEl = document.getElementById('cropPpiMessage');
const imageCountEl = document.getElementById('imageCount');
const imageListEmptyEl = document.getElementById('imageListEmpty');
const canvasEmptyEl = document.getElementById('canvasEmpty');
const canvasWrapper = document.querySelector('.canvas-wrapper');
const paperSummaryEl = document.getElementById('paperSummary');
const paperDimensionsEl = document.getElementById('paperDimensions');
const outputDimensionsEl = document.getElementById('outputDimensions');
const downloadPngBtn = document.getElementById('downloadPng');
const downloadJpegBtn = document.getElementById('downloadJpeg');

// Inputs
const sizeSelect = document.getElementById('sizeSelect');
const orientationRadios = document.getElementsByName('orientation');
const cropDidWidthInput = document.getElementById('cropDidWidth');
const cropDidHeightInput = document.getElementById('cropDidHeight');

// --- Initialization ---

function init() {
    updateCanvasSize();
    updateWorkspace();

    // Key Event Listeners
    sizeSelect.addEventListener('change', (e) => {
        state.paperType = e.target.value;
        updateCanvasSize();
    });

    Array.from(orientationRadios).forEach(r => {
        r.addEventListener('change', (e) => {
            state.orientation = e.target.value;
            updateCanvasSize();
        });
    });

    imageInput.addEventListener('change', handleFiles);

    // Drag and Drop (Container)
    if (appContainer) {
        appContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            appContainer.classList.add('drag-over');
        });
        appContainer.addEventListener('dragleave', (e) => {
            e.preventDefault();
            if (!appContainer.contains(e.relatedTarget)) appContainer.classList.remove('drag-over');
        });
        appContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            appContainer.classList.remove('drag-over');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleFiles({ target: { files: e.dataTransfer.files } });
            }
        });
    }

    // Modal
    closeModalBtn.addEventListener('click', closeEditor);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.editingImageId) closeEditor();
    });
    confirmCropBtn.addEventListener('click', applyCrop);
    if (deleteImageBtn) {
        deleteImageBtn.addEventListener('click', deleteEditingImage);
    }

    // Keep the crop frame at the physical output size's aspect ratio.
    const updateRatio = () => {
        if (!state.cropper) return;
        const size = getCropSize();
        if (size && state.cropper.options.aspectRatio !== size.widthMm / size.heightMm) {
            state.cropper.setAspectRatio(size.widthMm / size.heightMm);
        }
        updateCropResolution();
    };

    cropDidWidthInput.addEventListener('input', updateRatio);
    cropDidHeightInput.addEventListener('input', updateRatio);

    // Save
    downloadPngBtn.addEventListener('click', () => downloadResult('png'));
    downloadJpegBtn.addEventListener('click', () => downloadResult('jpeg'));

    // Canvas Interaction
    canvas.addEventListener('mousedown', onCanvasDown);
    canvas.addEventListener('mousemove', onCanvasMove);
    canvas.addEventListener('mouseup', onCanvasUp);
    canvas.addEventListener('mouseout', onCanvasUp);

    canvas.addEventListener('touchstart', onCanvasDown, { passive: false });
    canvas.addEventListener('touchmove', onCanvasMove, { passive: false });
    canvas.addEventListener('touchend', onCanvasUp);
    canvas.addEventListener('touchcancel', onCanvasUp);
}

// --- Canvas Logic ---

function mmToPx(mm) {
    return Math.round((mm / MM_TO_INCH) * PPI);
}

function updateCanvasSize() {
    const sizeDef = PAPER_SIZES[state.paperType];
    const dims = [sizeDef.widthMm, sizeDef.heightMm].sort((a, b) => b - a); // [Large, Small]

    let wMm, hMm;
    if (state.orientation === 'landscape') {
        wMm = dims[0];
        hMm = dims[1];
    } else {
        wMm = dims[1];
        hMm = dims[0];
    }

    canvas.width = mmToPx(wMm);
    canvas.height = mmToPx(hMm);
    canvasWrapper.dataset.orientation = state.orientation;
    paperSummaryEl.textContent = `${state.paperType}判・${state.orientation === 'landscape' ? '横向き' : '縦向き'}`;
    paperDimensionsEl.textContent = `${wMm} × ${hMm} mm`;
    outputDimensionsEl.textContent = `${canvas.width} × ${canvas.height} px`;

    drawCanvas();
}

function updateWorkspace() {
    const count = state.images.length;
    imageCountEl.textContent = `${count} / 4`;
    imageListEmptyEl.classList.toggle('hidden', count > 0);
    canvasEmptyEl.classList.toggle('hidden', count > 0);
    downloadPngBtn.disabled = count === 0;
    downloadJpegBtn.disabled = count === 0;
}

function drawCanvas() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    state.images.forEach(imgState => {
        if (imgState.bitmap) {
            ctx.drawImage(imgState.bitmap, imgState.x, imgState.y, imgState.width, imgState.height);
        }
    });
}

// --- Image Handling ---

async function handleFiles(e) {
    const files = Array.from(e.target.files).filter(file => file.type.startsWith('image/'));
    imageInput.value = '';
    if (files.length === 0) return;

    if (state.images.length + state.pendingImageCount + files.length > 4) {
        alert('画像は最大4枚までです。');
        return;
    }

    state.pendingImageCount += files.length;
    for (const file of files) {
        try {
            const bitmap = await createImageBitmap(file);
            const id = Date.now() + Math.random().toString();
            const offset = state.images.length * 50;
            const widthMm = 40;
            const heightMm = Math.max(1, Math.round(widthMm * bitmap.height / bitmap.width * 10) / 10);
            const imgState = {
                id,
                bitmap,
                originalUrl: URL.createObjectURL(file),
                x: 50 + offset,
                y: 50 + offset,
                width: mmToPx(widthMm),
                height: mmToPx(heightMm),
                widthMm,
                heightMm,
                cropData: null
            };

            state.images.push(imgState);
            addThumbnail(imgState);
            updateWorkspace();
            drawCanvas();
        } catch (error) {
            console.error('画像の読み込みに失敗しました。', error);
            alert(`「${file.name}」を読み込めませんでした。別の画像を選んでください。`);
        } finally {
            state.pendingImageCount -= 1;
        }
    }
}

function addThumbnail(imgState) {
    const div = document.createElement('div');
    div.className = 'image-item';
    div.dataset.id = imgState.id;

    const img = document.createElement('img');
    img.src = imgState.originalUrl;
    img.alt = '配置する画像';

    const btn = document.createElement('button');
    btn.className = 'edit-btn';
    btn.textContent = '編集';
    btn.onclick = () => openEditor(imgState.id);

    div.appendChild(img);
    div.appendChild(btn);
    imageListEl.appendChild(div);
}

function removeImage(id) {
    const imgState = state.images.find(i => i.id === id);
    if (imgState) {
        imgState.bitmap.close();
        URL.revokeObjectURL(imgState.originalUrl);
    }
    state.images = state.images.filter(i => i.id !== id);
    // Remove DOM element - try finding by dataset or traversal
    const items = Array.from(document.querySelectorAll('.image-item'));
    const item = items.find(el => el.dataset.id === id);
    if (item) item.remove();

    updateWorkspace();
    drawCanvas();
}

// --- Editor Logic (Cropper) ---

function getCropSize() {
    if (!cropDidWidthInput.checkValidity() || !cropDidHeightInput.checkValidity()) return null;
    const widthMm = cropDidWidthInput.valueAsNumber;
    const heightMm = cropDidHeightInput.valueAsNumber;
    if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm < 1 || heightMm < 1) return null;
    // Extremely large input must not turn into non-finite canvas dimensions.
    if (!Number.isSafeInteger(mmToPx(widthMm)) || !Number.isSafeInteger(mmToPx(heightMm))) return null;
    return { widthMm, heightMm };
}

function updateCropResolution(cropData) {
    cropResolutionEl.classList.remove('is-warning', 'is-danger');
    cropPpiValueEl.textContent = '— ppi';
    const size = getCropSize();
    if (!size) {
        cropPpiMessageEl.textContent = '幅と高さに有効なサイズを入力してください。';
        return;
    }

    const data = cropData || (state.cropper && state.cropper.getData());
    if (!data || !Number.isFinite(data.width) || !Number.isFinite(data.height) || data.width <= 0 || data.height <= 0) {
        cropPpiMessageEl.textContent = '画像を読み込み中、または切り抜き範囲が未選択です。';
        return;
    }

    // Use source-image pixels, not the 300ppi output canvas or screen pixels.
    // Show the lower axis so neither direction's resolution is overstated.
    const ppi = Math.min(data.width * MM_TO_INCH / size.widthMm, data.height * MM_TO_INCH / size.heightMm);
    // Discard floating-point noise before comparing the exact warning thresholds.
    const effectivePpi = Math.round(ppi * 1e6) / 1e6;
    // Round down for display so a warning never appears next to a rounded-up threshold.
    cropPpiValueEl.textContent = `${(Math.floor(effectivePpi * 10) / 10).toFixed(1)} ppi`;

    if (effectivePpi < 150) {
        cropResolutionEl.classList.add('is-danger');
        cropPpiMessageEl.textContent = '警告：150ppi未満です。印刷が粗くなる可能性が高くなります。';
    } else if (effectivePpi < 250) {
        cropResolutionEl.classList.add('is-warning');
        cropPpiMessageEl.textContent = '注意：250ppi未満です。印刷が粗くなる可能性があります。';
    } else {
        cropPpiMessageEl.textContent = '250ppi以上です。';
    }
}

function openEditor(id) {
    const imgState = state.images.find(i => i.id === id);
    if (!imgState) return;
    if (typeof Cropper === 'undefined') {
        alert('編集機能を読み込めませんでした。インターネット接続を確認してページを再読み込みしてください。');
        return;
    }

    if (state.cropper) state.cropper.destroy();
    state.editingImageId = id;
    confirmCropBtn.disabled = true;
    cropDidWidthInput.value = imgState.widthMm;
    cropDidHeightInput.value = imgState.heightMm;
    cropResolutionEl.classList.remove('is-warning', 'is-danger');
    cropPpiValueEl.textContent = '— ppi';
    cropPpiMessageEl.textContent = '画像を読み込み中です。';
    if (cropModal.classList.contains('hidden')) state.editorReturnFocus = document.activeElement;
    cropModal.classList.remove('hidden');
    appContainer.inert = true;
    document.body.classList.add('editor-open');
    closeModalBtn.focus({ preventScroll: true });
    cropImageEl.src = imgState.originalUrl;

    // Keep cropping as the only interaction mode, including on double-click.
    state.cropper = new Cropper(cropImageEl, {
        viewMode: 1,
        autoCropArea: 0.8,
        dragMode: 'crop',
        movable: false,
        toggleDragModeOnDblclick: false,
        aspectRatio: imgState.widthMm / imgState.heightMm,
        data: imgState.cropData,
        ready() {
            confirmCropBtn.disabled = false;
            updateCropResolution();
        },
        crop(event) {
            updateCropResolution(event.detail);
        }
    });
}

function closeEditor() {
    cropModal.classList.add('hidden');
    appContainer.inert = false;
    document.body.classList.remove('editor-open');
    if (state.cropper) {
        state.cropper.destroy();
        state.cropper = null;
    }
    state.editingImageId = null;
    if (state.editorReturnFocus && state.editorReturnFocus.isConnected) {
        state.editorReturnFocus.focus({ preventScroll: true });
    } else {
        imageInput.focus({ preventScroll: true });
    }
    state.editorReturnFocus = null;
}

function deleteEditingImage() {
    if (state.editingImageId && confirm('この画像を削除しますか？')) {
        removeImage(state.editingImageId);
        closeEditor();
    }
}

async function applyCrop() {
    if (!state.cropper || !state.editingImageId || confirmCropBtn.disabled) return;

    const imgState = state.images.find(i => i.id === state.editingImageId);
    if (!imgState) return;

    const size = getCropSize();
    if (!size) {
        if (cropDidWidthInput.reportValidity() && cropDidHeightInput.reportValidity()) {
            alert('幅と高さに有効なサイズを入力してください。');
        }
        return;
    }

    const cropper = state.cropper;
    confirmCropBtn.disabled = true;
    try {
        const resultCanvas = cropper.getCroppedCanvas();
        if (!resultCanvas || !resultCanvas.width || !resultCanvas.height) {
            throw new Error('切り抜き画像を作成できませんでした。');
        }
        const cropData = cropper.getData();
        const bmp = await createImageBitmap(resultCanvas);

        // Closing, deleting, or switching images must cancel a pending edit.
        if (state.cropper !== cropper || !state.images.includes(imgState)) {
            bmp.close();
            return;
        }
        imgState.bitmap.close();
        imgState.bitmap = bmp;
        imgState.widthMm = size.widthMm;
        imgState.heightMm = size.heightMm;
        imgState.width = mmToPx(size.widthMm);
        imgState.height = mmToPx(size.heightMm);
        imgState.cropData = cropData;
        drawCanvas();
        closeEditor();
    } catch (error) {
        console.error('画像の編集に失敗しました。', error);
        if (state.cropper === cropper) alert('画像を編集できませんでした。サイズや切り抜き範囲を確認してください。');
    } finally {
        if (state.cropper === cropper) confirmCropBtn.disabled = false;
    }
}

// --- Canvas Interaction (Drag & Snap) ---

function getMousePos(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX = evt.clientX;
    let clientY = evt.clientY;

    if (evt.touches && evt.touches.length > 0) {
        clientX = evt.touches[0].clientX;
        clientY = evt.touches[0].clientY;
    }

    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

function onCanvasDown(e) {
    e.preventDefault();
    const pos = getMousePos(e);

    // Hit test reverse
    for (let i = state.images.length - 1; i >= 0; i--) {
        const img = state.images[i];
        if (pos.x >= img.x && pos.x <= img.x + img.width &&
            pos.y >= img.y && pos.y <= img.y + img.height) {

            state.isDragging = true;
            state.dragTargetId = img.id;
            state.dragOffsetX = pos.x - img.x;
            state.dragOffsetY = pos.y - img.y;
            return;
        }
    }
}

function onCanvasMove(e) {
    if (!state.isDragging || !state.dragTargetId) return;
    e.preventDefault();

    const pos = getMousePos(e);
    const img = state.images.find(i => i.id === state.dragTargetId);

    if (img) {
        let newX = pos.x - state.dragOffsetX;
        let newY = pos.y - state.dragOffsetY;

        // SNAP LOGIC
        const snapPx = PPI / MM_TO_INCH;
        newX = Math.round(Math.round(newX / snapPx) * snapPx);
        newY = Math.round(Math.round(newY / snapPx) * snapPx);

        img.x = newX;
        img.y = newY;
        drawCanvas();
    }
}

function onCanvasUp(e) {
    state.isDragging = false;
    state.dragTargetId = null;
}

// --- Download ---

function downloadResult(format) {
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const quality = format === 'jpeg' ? 1.0 : undefined;

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const H = String(now.getHours()).padStart(2, '0');
    const M = String(now.getMinutes()).padStart(2, '0');
    const S = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${y}${m}${d}_${H}${M}${S}`;

    const link = document.createElement('a');
    link.download = `layout_image_${timestamp}.${format}`;
    link.href = canvas.toDataURL(mime, quality);
    link.click();
}

// Start
init();
