// Config
const PPI = 300;
const MM_TO_INCH = 25.4;

const PAPER_SIZES = {
    'L': { widthMem: 89, heightMm: 127 },
    '2L': { widthMem: 127, heightMm: 178 }
};

// State
let state = {
    paperType: 'L',
    orientation: 'landscape',
    images: [], // { id, originalFile, currentBitmap, x, y, width, height }
    editingImageId: null,
    cropper: null,
    isDragging: false,
    dragTargetId: null,
    dragOffsetX: 0,
    dragOffsetY: 0,
    lastMouseX: 0,
    lastMouseY: 0
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

// Inputs
const sizeSelect = document.getElementById('sizeSelect');
const orientationRadios = document.getElementsByName('orientation');
const cropModeRadios = document.getElementsByName('cropMode');
const cropToolRadios = document.getElementsByName('cropTool');
const mmControls = document.getElementById('mmControls');
const cropDidWidthInput = document.getElementById('cropDidWidth');
const cropDidHeightInput = document.getElementById('cropDidHeight');

// --- Initialization ---

function init() {
    updateCanvasSize();

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
    // Check if appContainer exists (it should)
    if (appContainer) {
        appContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            appContainer.classList.add('drag-over');
        });
        appContainer.addEventListener('dragleave', (e) => {
            e.preventDefault();
            appContainer.classList.remove('drag-over');
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
    confirmCropBtn.addEventListener('click', applyCrop);
    if (deleteImageBtn) {
        deleteImageBtn.addEventListener('click', deleteEditingImage);
    }

    // MM Controls (Realtime)
    const updateRatio = () => {
        if (!state.cropper) return;
        const w = parseFloat(cropDidWidthInput.value);
        const h = parseFloat(cropDidHeightInput.value);
        if (w > 0 && h > 0) {
            state.cropper.setAspectRatio(w / h);
        }
    };

    Array.from(cropModeRadios).forEach(r => {
        r.addEventListener('change', (e) => {
            const mode = e.target.value;
            if (mode === 'mm') {
                mmControls.classList.remove('hidden');
                updateRatio();
            } else {
                mmControls.classList.add('hidden');
                if (state.cropper) {
                    state.cropper.setAspectRatio(NaN); // Free
                }
            }
        });
    });

    if (cropDidWidthInput) cropDidWidthInput.addEventListener('input', updateRatio);
    if (cropDidHeightInput) cropDidHeightInput.addEventListener('input', updateRatio);

    // Crop Tool Toggle
    Array.from(cropToolRadios).forEach(r => {
        r.addEventListener('change', (e) => {
            if (!state.cropper) return;
            state.cropper.setDragMode(e.target.value);
        });
    });

    // Save
    document.getElementById('downloadPng').addEventListener('click', () => downloadResult('png'));
    document.getElementById('downloadJpeg').addEventListener('click', () => downloadResult('jpeg'));

    // Canvas Interaction
    canvas.addEventListener('mousedown', onCanvasDown);
    canvas.addEventListener('mousemove', onCanvasMove);
    canvas.addEventListener('mouseup', onCanvasUp);
    canvas.addEventListener('mouseout', onCanvasUp);

    canvas.addEventListener('touchstart', onCanvasDown, { passive: false });
    canvas.addEventListener('touchmove', onCanvasMove, { passive: false });
    canvas.addEventListener('touchend', onCanvasUp);
}

// --- Canvas Logic ---

function mmToPx(mm) {
    return Math.round((mm / MM_TO_INCH) * PPI);
}

function updateCanvasSize() {
    const sizeDef = PAPER_SIZES[state.paperType];
    const dims = [sizeDef.widthMem, sizeDef.heightMm].sort((a, b) => b - a); // [Large, Small]

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

    drawCanvas();
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
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    if (state.images.length + files.length > 4) {
        alert('画像は最大4枚までです。');
        return;
    }

    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;

        const id = Date.now() + Math.random().toString();
        const bitmap = await createImageBitmap(file);

        const offset = state.images.length * 50;

        // Default size logic (40mm physical width)
        const defaultMmW = 40;
        const ratio = bitmap.height / bitmap.width;
        const pxW = mmToPx(defaultMmW);
        const pxH = pxW * ratio;

        state.images.push({
            id: id,
            originalFile: file,
            bitmap: bitmap,
            x: 50 + offset,
            y: 50 + offset,
            width: pxW,
            height: pxH,
            originalUrl: null
        });

        addThumbnail(id, file);
    }
    drawCanvas();
    if (imageInput) imageInput.value = '';
}

function addThumbnail(id, file) {
    const div = document.createElement('div');
    div.className = 'image-item';
    div.dataset.id = id;

    const img = document.createElement('img');
    const reader = new FileReader();
    reader.onload = (e) => {
        img.src = e.target.result;
        const stateImg = state.images.find(i => i.id === id);
        if (stateImg) stateImg.originalUrl = e.target.result;
    };
    reader.readAsDataURL(file);

    const btn = document.createElement('button');
    btn.className = 'edit-btn';
    btn.textContent = '編集';
    btn.onclick = () => openEditor(id);

    div.appendChild(img);
    div.appendChild(btn);
    imageListEl.appendChild(div);
}

function removeImage(id) {
    state.images = state.images.filter(i => i.id !== id);
    // Remove DOM element - try finding by dataset or traversal
    const items = Array.from(document.querySelectorAll('.image-item'));
    const item = items.find(el => el.dataset.id === id);
    if (item) item.remove();

    drawCanvas();
}

// --- Editor Logic (Cropper) ---

function openEditor(id) {
    const imgState = state.images.find(i => i.id === id);
    if (!imgState) return;

    state.editingImageId = id;
    cropModal.classList.remove('hidden');
    cropImageEl.src = imgState.originalUrl;

    // Default tool: Crop, Default mode: free
    document.querySelector('input[name="cropTool"][value="crop"]').checked = true;

    // We don't necessarily reset cropMode, but user might want to start fresh?
    // Let's keep it sticky or reset. Sticky is fine.

    if (state.cropper) state.cropper.destroy();

    state.cropper = new Cropper(cropImageEl, {
        viewMode: 1,
        autoCropArea: 0.8,
        dragMode: 'crop'
    });
}

function closeEditor() {
    cropModal.classList.add('hidden');
    if (state.cropper) {
        state.cropper.destroy();
        state.cropper = null;
    }
    state.editingImageId = null;
}

function deleteEditingImage() {
    if (state.editingImageId && confirm('この画像を削除しますか？')) {
        removeImage(state.editingImageId);
        closeEditor();
    }
}

function applyCrop() {
    if (!state.cropper || !state.editingImageId) return;

    const imgState = state.images.find(i => i.id === state.editingImageId);
    if (!imgState) return;

    const mode = document.querySelector('input[name="cropMode"]:checked').value;

    // 1. Get cropped result
    // Note: getCroppedCanvas() returns canvas at ORIGINAL resolution of the crop
    let resultCanvas = state.cropper.getCroppedCanvas();

    if (!resultCanvas) return;

    if (mode === 'mm') {
        // MM Mode: We want the FINAL display size to be exactly what user typed.
        const targetW_mm = parseFloat(cropDidWidthInput.value);
        const targetH_mm = parseFloat(cropDidHeightInput.value);
        const targetW_px = mmToPx(targetW_mm);
        const targetH_px = mmToPx(targetH_mm);

        // We update the display size on the main canvas
        imgState.width = targetW_px;
        imgState.height = targetH_px;

        // The bitmap is the cropped area. We just use it.
        // If the bitmap is 4000px wide, and we display at 400px, it will be high res. Good.
        // We do DO NOT resize the bitmap down, to keep quality for printing.

    } else {
        // Free Mode:
        // We want to MAINTAIN SCALE.
        // Current scale = Display Width / Bitmap Width
        const currentScale = imgState.width / imgState.bitmap.width;

        // New Bitmap Width
        const newBitmapW = resultCanvas.width;
        const newBitmapH = resultCanvas.height;

        // New Display Size = New Bitmap Size * Scale
        imgState.width = newBitmapW * currentScale;
        imgState.height = newBitmapH * currentScale;
    }

    createImageBitmap(resultCanvas).then(bmp => {
        // Close previous bitmap? JS GC handles it usually, but good to know we replace it.
        imgState.bitmap = bmp;
        drawCanvas();
        closeEditor();
    });
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
        // Snap to nearest 1mm
        const snapPx = mmToPx(1);
        newX = Math.round(newX / snapPx) * snapPx;
        newY = Math.round(newY / snapPx) * snapPx;

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

    const link = document.createElement('a');
    link.download = `layout_image.${format}`;
    link.href = canvas.toDataURL(mime, quality);
    link.click();
}

// Start
init();
