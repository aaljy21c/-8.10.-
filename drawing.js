class NeonDrawingBoard {
  constructor(container, options = {}) {
    this.container = container;
    this.onChange = options.onChange || null;
    this.onClose = options.onClose || null;
    this.readOnly = options.readOnly || false;

    // Load initial data
    
    // Multi-page State
    this.isMultiPage = false;
    this.pdfFileId = null;
    this._pages = [{ type: 'blank', _strokes: [], bgCanvas: null }];
    this.currentPageIndex = 0;
    
    Object.defineProperty(this, 'strokes', {
      get: () => this._pages[this.currentPageIndex]._strokes,
      set: (val) => { this._pages[this.currentPageIndex]._strokes = val; }
    });

    // Load initial data
    if (options.initialData && !Array.isArray(options.initialData) && options.initialData.type === 'pdf_drawing') {
      this.isMultiPage = true;
      this.pdfFileId = options.initialData.pdfFileId;
      this._pages = options.initialData.strokesPerPage.map(st => ({ type: 'pdf', _strokes: st, bgCanvas: null }));
      this.loadExistingPdf();
    } else {
      this.strokes = options.initialData ? JSON.parse(JSON.stringify(options.initialData)) : [];
    }
    
    const bgStroke = this.strokes.find(s => s.isBg);

    const savedBg = localStorage.getItem('planeer_drawing_bg');
    this.bgColor = bgStroke ? bgStroke.color : (savedBg || '#1e1e1e');
    this.undoStack = [];
    this.redoStack = [];

    // Settings
    this.currentTool = 'pen'; // pen, highlighter, eraser, lasso
    this.penColor = '#ffffff';
    this.penSize = 2;
    this.penOpacity = 1.0;
    this.highlighterColor = '#facc15';
    this.highlighterSize = 15;
    this.highlighterOpacity = 0.4;
    
    this.penPresets = JSON.parse(localStorage.getItem('planeer_pen_presets')) || ['#ffffff', '#ff4d4d', '#4da6ff', '#50c878', '#facc15'];
    if (this.penPresets.length < 5) this.penPresets = [...this.penPresets, '#ffffff', '#ff4d4d', '#4da6ff', '#50c878', '#facc15'].slice(0, 5);
    this.hlPresets = JSON.parse(localStorage.getItem('planeer_hl_presets')) || ['#facc15', '#ff7b72', '#79c0ff', '#50c878', '#d8b4e2'];
    if (this.hlPresets.length < 5) this.hlPresets = [...this.hlPresets, '#facc15', '#ff7b72', '#79c0ff', '#50c878', '#d8b4e2'].slice(0, 5);

    // Interaction state
    this.isDrawing = false;
    this.currentStroke = null;
    this.points = [];
    this.holdTimer = null;
    this.isSnapped = false;
    this.penOnlyMode = true; // Pen Only mode (Palm rejection) by default
    
    // Pan and Zoom
    this.viewScale = 1;
    this.panX = 0;
    this.panY = 0;
    this.activePointers = new Map();
    this.isPanning = false;

    // Lasso state
    this.lassoPoints = [];
    this.selectedStrokes = [];
    this.isDraggingSelection = false;
    this.dragStartPoint = null;
    this.dragOffset = { x: 0, y: 0 };

    this.initDOM();
    if (!this.readOnly) {
      this.bindEvents();
    }
    
    // Resize handling
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.wrapper);
    
    // Initial render
    setTimeout(() => this.resize(), 0);
  }

  initDOM() {
    this.container.innerHTML = '';
    
    // Main wrapper
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'neon-drawing-wrapper';
    
    // Toolbar
    if (!this.readOnly) {
      
    // Sidebar
    this.sidebar = document.createElement('div');
    this.sidebar.className = 'drawing-sidebar hidden';
    this.sidebar.innerHTML = `
      <div class="sidebar-header">
        <label class="sidebar-btn" style="display:block; text-align:center; cursor:pointer;">
          📄 PDF 불러오기
          <input type="file" id="pdf-import-input" accept="application/pdf" style="display:none">
        </label>
      </div>
      <div id="drawing-thumbnails" class="sidebar-thumbnails"></div>
    `;
    this.container.appendChild(this.sidebar);
    
    this.sidebar.querySelector('#pdf-import-input').addEventListener('change', (e) => this.handlePdfImport(e));

    // Floating Toolbar
    this.toolbar = document.createElement('div');

      this.toolbar.className = 'neon-drawing-toolbar';
      this.buildToolbar();
      this.wrapper.appendChild(this.toolbar);
    }

    // Canvas Container
    this.canvasContainer = document.createElement('div');
    this.canvasContainer.className = 'neon-drawing-canvas-container';
    this.canvasContainer.style.backgroundColor = this.bgColor;
    
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    // Prevent touch gestures like scrolling
    this.canvas.style.touchAction = 'none';

    this.canvasContainer.appendChild(this.canvas);
    
    this.zoomIndicator = document.createElement('div');
    this.zoomIndicator.style.cssText = 'position:absolute; top:12px; right:12px; background:rgba(0,0,0,0.6); color:white; padding:4px 8px; border-radius:6px; font-size:0.8rem; pointer-events:none; z-index:100; transition: opacity 0.3s;';
    this.zoomIndicator.innerText = '100%';
    this.canvasContainer.appendChild(this.zoomIndicator);
    
    this.wrapper.appendChild(this.canvasContainer);
    this.container.appendChild(this.wrapper);

    // Auto-expand if initial strokes go beyond default height
    let maxY = 0;
    this.strokes.forEach(stroke => {
      stroke.points.forEach(p => {
        if (p.y > maxY) maxY = p.y;
      });
    });
    if (maxY > 350) { // Default is 400, add padding
      this.canvasContainer.style.minHeight = `${maxY + 50}px`;
    }
  }

  buildToolbar() {
    this.toolbar.innerHTML = `
      <div class="drawing-tools">
        <button class="tool-btn active" data-tool="pen" title="펜">🖊️</button>
        <button class="tool-btn" data-tool="highlighter" title="형광펜">🖍️</button>
        <button class="tool-btn" data-tool="eraser" title="지우개">🧽</button>
        <button class="tool-btn" data-tool="lasso" title="올가미 선택">✂️</button>
      </div>
      <div class="drawing-settings">
        <!-- Settings dynamically change based on tool -->
      </div>
      <div class="global-settings" style="display:flex; align-items:center; gap:4px; margin-left:auto; border-left: 1px solid #444; padding-left: 8px;">
        <span style="font-size:0.8rem; color:#aaa; margin-right:4px;">배경지</span>
        <div class="bg-presets" style="display:flex; gap:4px;">
          <input type="color" id="bg-color-picker" class="color-picker" value="${this.bgColor}" title="배경색 변경" style="width:24px; height:24px; padding:0; border:2px solid #555; border-radius:50%; cursor:pointer;">
        </div>
      </div>
      <div class="drawing-actions">
        <button class="action-btn" id="btn-save-image" title="이미지로 저장">💾</button>
        <button class="action-btn" id="btn-toggle-sidebar" title="페이지 목록">📑</button>
        <button class="action-btn" id="btn-export-pdf" title="PDF로 다운로드" style="display:none">📥</button>
        <button class="action-btn" id="btn-reset-view" title="1:1 화면 초기화">🔍</button>
        <button class="action-btn" id="btn-pen-mode" title="손가락 그리기 허용됨 (클릭하여 펜 전용 모드로 전환)">👆</button>
        <button class="action-btn" id="btn-undo" title="실행 취소">↩️</button>
        <button class="action-btn" id="btn-redo" title="다시 실행">↪️</button>
        <button class="action-btn" id="btn-clear" title="전체 지우기">🗑️</button>
        ${this.onClose ? `<button class="drawing-toolbar-close-btn" id="btn-close-drawing" title="저장 후 닫기">저장/닫기</button>` : ''}
      </div>
    `;

    // Tool switching
    const toolBtns = this.toolbar.querySelectorAll('.tool-btn');
    toolBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        toolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentTool = btn.dataset.tool;
        this.clearSelection();
        this.updateSettingsUI();
      });
    });

    // Action buttons
    this.toolbar.querySelector('#btn-undo').addEventListener('click', (e) => { e.preventDefault(); this.undo(); });
    this.toolbar.querySelector('#btn-redo').addEventListener('click', (e) => { e.preventDefault(); this.redo(); });
    this.toolbar.querySelector('#btn-clear').addEventListener('click', () => {
      if (confirm('그림을 모두 지우시겠습니까?')) this.clearAll();
    });

    const btnPenMode = this.toolbar.querySelector('#btn-pen-mode');
    if (btnPenMode) {
      btnPenMode.addEventListener('click', () => {
        this.penOnlyMode = !this.penOnlyMode;
        if (this.penOnlyMode) {
          btnPenMode.innerHTML = '🖊️';
          btnPenMode.title = '펜 전용 모드 켜짐 (클릭하여 손가락 그리기 허용)';
          btnPenMode.classList.add('active');
        } else {
          btnPenMode.innerHTML = '👆';
          btnPenMode.title = '손가락 그리기 허용됨 (클릭하여 펜 전용 모드로 전환)';
          btnPenMode.classList.remove('active');
        }
      });
    }

    const btnClose = this.toolbar.querySelector('#btn-close-drawing');
    if (btnClose && this.onClose) {
      btnClose.addEventListener('click', (e) => {
        e.preventDefault();
        this.onClose(this.getData());
      });
    }

    const bgColorPicker = this.toolbar.querySelector('#bg-color-picker');
    if (bgColorPicker) {
      bgColorPicker.addEventListener('input', (e) => {
        this.bgColor = e.target.value;
        localStorage.setItem('planeer_drawing_bg', this.bgColor);
        this.canvasContainer.style.backgroundColor = this.bgColor;
        this.strokes = this.strokes.filter(s => !s.isBg);
        this.strokes.unshift({ isBg: true, color: this.bgColor });
        this.saveState();
      });
    }

    
    
    const btnExportPdf = this.toolbar.querySelector('#btn-export-pdf');
    if (btnExportPdf) {
      if (this.isMultiPage) {
        btnExportPdf.style.display = 'inline-block';
      }
      btnExportPdf.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          const originalText = btnExportPdf.innerHTML;
          btnExportPdf.innerHTML = '⏳';
          
          const { PDFDocument } = window.PDFLib;
          const pdfDoc = await PDFDocument.create();
          
          for (let i = 0; i < this._pages.length; i++) {
            const pageObj = this._pages[i];
            
            // Create a temp canvas matching the page size
            const tempCanvas = document.createElement('canvas');
            const targetWidth = pageObj.width || this.canvas.width;
            const targetHeight = pageObj.height || this.canvas.height;
            tempCanvas.width = targetWidth;
            tempCanvas.height = targetHeight;
            const tempCtx = tempCanvas.getContext('2d');
            
            // Draw background
            if (pageObj.bgCanvas) {
               tempCtx.drawImage(pageObj.bgCanvas, 0, 0, targetWidth, targetHeight);
            } else {
               tempCtx.fillStyle = this.bgColor;
               tempCtx.fillRect(0, 0, targetWidth, targetHeight);
            }
            
            // Draw strokes
            pageObj._strokes.forEach(stroke => {
              tempCtx.beginPath();
              tempCtx.lineCap = 'round'; tempCtx.lineJoin = 'round';
              tempCtx.lineWidth = stroke.size; tempCtx.strokeStyle = stroke.color; tempCtx.globalAlpha = stroke.opacity || 1;
              
              if (stroke.tool === 'highlighter') {
                tempCtx.globalCompositeOperation = 'multiply';
              }
              
              stroke.points.forEach((pt, j) => {
                if (j===0) tempCtx.moveTo(pt.x, pt.y); else tempCtx.lineTo(pt.x, pt.y);
              });
              tempCtx.stroke();
              tempCtx.globalCompositeOperation = 'source-over';
            });
            
            // Embed to PDF
            const pngDataUrl = tempCanvas.toDataURL('image/png');
            const pngImage = await pdfDoc.embedPng(pngDataUrl);
            
            const pdfPage = pdfDoc.addPage([targetWidth, targetHeight]);
            pdfPage.drawImage(pngImage, {
              x: 0,
              y: 0,
              width: targetWidth,
              height: targetHeight
            });
          }
          
          const pdfBytes = await pdfDoc.save();
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'edited_planeer_notes.pdf';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          btnExportPdf.innerHTML = originalText;
        } catch(err) {
          console.error('PDF Export Error:', err);
          alert('PDF 다운로드 중 오류가 발생했습니다.');
          btnExportPdf.innerHTML = '📥';
        }
      });
    }

    const btnToggleSidebar = this.toolbar.querySelector('#btn-toggle-sidebar');
    if (btnToggleSidebar) {
      btnToggleSidebar.addEventListener('click', (e) => {
        e.preventDefault();
        this.sidebar.classList.toggle('hidden');
      });
    }

    const btnResetView = this.toolbar.querySelector('#btn-reset-view');

    if (btnResetView) {
      btnResetView.addEventListener('click', (e) => {
        e.preventDefault();
        this.viewScale = 1;
        this.panX = 0;
        this.panY = 0;
        this.updateZoomIndicator();
        this.render();
      });
    }

    const btnSaveImage = this.toolbar.querySelector('#btn-save-image');
    if (btnSaveImage) {
      btnSaveImage.addEventListener('click', (e) => {
        e.preventDefault();
        // Create a temporary canvas to fill background
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.canvas.width;
        tempCanvas.height = this.canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        
        // Fill background with card-bg color
        tempCtx.fillStyle = this.bgColor;
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        
        // Draw the drawing canvas over it
        tempCtx.drawImage(this.canvas, 0, 0);
        
        // Export and download
        const dataUrl = tempCanvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        
        // Format YYYYMMDD_HHMM
        const now = new Date();
        const dateStr = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + '_' + String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0');
        
        a.download = `planeer_drawing_${dateStr}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
    }

    this.settingsContainer = this.toolbar.querySelector('.drawing-settings');
    this.updateSettingsUI();
  }

  updateZoomIndicator() {
    if (this.zoomIndicator) {
      this.zoomIndicator.innerText = Math.round(this.viewScale * 100) + '%';
      this.zoomIndicator.style.opacity = '1';
      clearTimeout(this.zoomTimer);
      this.zoomTimer = setTimeout(() => {
        this.zoomIndicator.style.opacity = '0.4';
      }, 1500);
    }
  }

  updateSettingsUI() {
    this.settingsContainer.innerHTML = '';
    
    const renderPresets = (presets) => {
      return presets.map((color, idx) => {
        const isActive = (this.currentTool === 'pen' && this.penColor === color) || (this.currentTool === 'highlighter' && this.highlighterColor === color);
        const borderStyle = isActive ? '2px solid #fff' : '2px solid transparent';
        const boxShadow = isActive ? '0 0 0 2px #3b82f6' : '0 0 0 1px #555';
        return `<button class="preset-color" style="background:${color}; width:26px; height:26px; border-radius:50%; border:${borderStyle}; box-shadow:${boxShadow}; cursor:pointer; padding:0;" data-index="${idx}" data-color="${color}" title="클릭하여 선택 (다시 클릭 시 색상 변경)"></button>`;
      }).join('');
    };

    if (this.currentTool === 'pen') {
      this.settingsContainer.innerHTML = `
        <div class="setting-group" style="display:flex; align-items:center; gap:6px;">
          ${renderPresets(this.penPresets)}
          <input type="color" class="color-picker" id="hidden-preset-picker" style="opacity:0; position:absolute; width:0; height:0; pointer-events:none;">
          <input type="color" class="color-picker" value="${this.penColor}" id="pen-color" style="margin-left:4px;" title="색상 지정">
          <input type="range" class="size-slider" min="1" max="20" value="${this.penSize}" id="pen-size" title="굵기">
          <input type="range" class="opacity-slider" min="0.1" max="1" step="0.1" value="${this.penOpacity}" id="pen-opacity" title="농도">
        </div>
      `;
    } else if (this.currentTool === 'highlighter') {
      this.settingsContainer.innerHTML = `
        <div class="setting-group" style="display:flex; align-items:center; gap:6px;">
          ${renderPresets(this.hlPresets)}
          <input type="color" class="color-picker" id="hidden-preset-picker" style="opacity:0; position:absolute; width:0; height:0; pointer-events:none;">
          <input type="color" class="color-picker" value="${this.highlighterColor}" id="hl-color" style="margin-left:4px;" title="색상 지정">
          <input type="range" class="size-slider" min="5" max="50" value="${this.highlighterSize}" id="hl-size" title="굵기">
          <input type="range" class="opacity-slider" min="0.1" max="1" step="0.1" value="${this.highlighterOpacity}" id="hl-opacity" title="농도">
        </div>
      `;
    }

    if (this.currentTool === 'pen' || this.currentTool === 'highlighter') {
      const isPen = this.currentTool === 'pen';
      const colorInputId = isPen ? '#pen-color' : '#hl-color';
      const sizeInputId = isPen ? '#pen-size' : '#hl-size';
      const opacityInputId = isPen ? '#pen-opacity' : '#hl-opacity';
      
      const hiddenPicker = this.settingsContainer.querySelector('#hidden-preset-picker');
      let targetPresetIndex = -1;

      hiddenPicker.addEventListener('input', e => {
        if (targetPresetIndex >= 0) {
          const newColor = e.target.value;
          const presets = isPen ? this.penPresets : this.hlPresets;
          presets[targetPresetIndex] = newColor;
          localStorage.setItem(isPen ? 'planeer_pen_presets' : 'planeer_hl_presets', JSON.stringify(presets));
          this.updateSettingsUI();
          if (isPen) this.penColor = newColor;
          else this.highlighterColor = newColor;
          this.settingsContainer.querySelector(colorInputId).value = newColor;
        }
      });

      this.settingsContainer.querySelectorAll('.preset-color').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const color = btn.dataset.color;
          const isActive = (isPen ? this.penColor : this.highlighterColor) === color;
          
          if (isActive) {
            targetPresetIndex = parseInt(btn.dataset.index);
            hiddenPicker.value = color;
            hiddenPicker.click();
          } else {
            if (isPen) this.penColor = color;
            else this.highlighterColor = color;
            this.settingsContainer.querySelector(colorInputId).value = color;
            this.updateSettingsUI(); // Re-render to update active borders
          }
        });
      });

      this.settingsContainer.querySelector(colorInputId).addEventListener('input', e => {
        if (isPen) this.penColor = e.target.value;
        else this.highlighterColor = e.target.value;
      });
      this.settingsContainer.querySelector(sizeInputId).addEventListener('input', e => {
        if (isPen) this.penSize = parseInt(e.target.value);
        else this.highlighterSize = parseInt(e.target.value);
      });
      this.settingsContainer.querySelector(opacityInputId).addEventListener('input', e => {
        if (isPen) this.penOpacity = parseFloat(e.target.value);
        else this.highlighterOpacity = parseFloat(e.target.value);
      });
    }
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.canvas.addEventListener('pointerout', this.onPointerUp.bind(this));
  }

  getPointerPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) - this.panX) / this.viewScale,
      y: ((e.clientY - rect.top) - this.panY) / this.viewScale
    };
  }

  onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    
    this.isTempEraser = false;
    if (e.pointerType === 'pen' && (e.button === 2 || e.button === 5 || (e.buttons & 2) || (e.buttons & 32))) {
      this.isTempEraser = true;
    }
    
    if (this.penOnlyMode && e.pointerType === 'touch') {
      this.activePointers.set(e.pointerId, e);
      if (this.activePointers.size < 2) return;
    } else {
      this.activePointers.set(e.pointerId, e);
    }
    
    if (this.activePointers.size >= 2) {
      this.isDrawing = false;
      this.isPanning = true;
      const pts = Array.from(this.activePointers.values());
      this.initialPinchDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      this.initialScale = this.viewScale;
      const midX = (pts[0].clientX + pts[1].clientX) / 2;
      const midY = (pts[0].clientY + pts[1].clientY) / 2;
      const rect = this.canvas.getBoundingClientRect();
      this.pinchPanStartX = (midX - rect.left) - this.panX;
      this.pinchPanStartY = (midY - rect.top) - this.panY;
      return;
    }
    
    this.canvas.setPointerCapture(e.pointerId);
    
    const pos = this.getPointerPos(e);
    const activeTool = this.isTempEraser ? 'eraser' : this.currentTool;
    
    if (activeTool === 'lasso' && this.selectedStrokes.length > 0) {
      if (this.isPointInSelectionBounds(pos)) {
        this.isDraggingSelection = true;
        this.dragStartPoint = pos;
        this.originalSelectionStrokes = JSON.parse(JSON.stringify(this.selectedStrokes));
        return;
      } else {
        this.clearSelection();
      }
    }

    this.isDrawing = true;
    this.isSnapped = false;
    this.points = [pos];

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      this.currentStroke = {
        tool: activeTool,
        color: activeTool === 'pen' ? this.penColor : this.highlighterColor,
        size: activeTool === 'pen' ? this.penSize : this.highlighterSize,
        opacity: activeTool === 'pen' ? this.penOpacity : this.highlighterOpacity,
        points: [...this.points],
        isShape: false
      };
      this.startHoldTimer();
    } else if (activeTool === 'lasso') {
      this.lassoPoints = [pos];
    } else if (activeTool === 'eraser') {
      this.eraseAt(pos);
    }
    
    this.render();
  }

  onPointerMove(e) {
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, e);
    }
    
    if (this.isPanning && this.activePointers.size >= 2) {
      const pts = Array.from(this.activePointers.values());
      const currentDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      const midX = (pts[0].clientX + pts[1].clientX) / 2;
      const midY = (pts[0].clientY + pts[1].clientY) / 2;
      const rect = this.canvas.getBoundingClientRect();
      
      let newScale = this.initialScale * (currentDist / (this.initialPinchDist || 1));
      newScale = Math.max(0.2, Math.min(newScale, 5.0));
      
      this.viewScale = newScale;
      this.panX = (midX - rect.left) - this.pinchPanStartX * (newScale / this.initialScale);
      this.panY = (midY - rect.top) - this.pinchPanStartY * (newScale / this.initialScale);
      
      this.updateZoomIndicator();
      this.render();
      return;
    }

    const pos = this.getPointerPos(e);

    if (this.isDraggingSelection) {
      const dx = pos.x - this.dragStartPoint.x;
      const dy = pos.y - this.dragStartPoint.y;
      
      this.selectedStrokes.forEach((s, idx) => {
        const orig = this.originalSelectionStrokes[idx];
        s.points = orig.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      });
      this.render();
      return;
    }

    if (!this.isDrawing) return;

    // Auto-expand canvas height if drawing near the bottom
    const containerHeight = this.canvasContainer.clientHeight;
    const physicalY = pos.y * this.viewScale + this.panY;
    if (physicalY > containerHeight - 50) {
      this.canvasContainer.style.minHeight = `${containerHeight + 300}px`;
      // Auto-scroll down if inside scrollable modal
      if (this.wrapper && this.wrapper.scrollHeight > this.wrapper.clientHeight) {
        this.wrapper.scrollTop += 20;
      }
    }

    const activeTool = this.isTempEraser ? 'eraser' : this.currentTool;

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      if (this.isSnapped && this.currentStroke) {
         this.currentStroke.points[this.currentStroke.points.length - 1] = pos;
      } else {
         const lastPt = this.points[this.points.length - 1];
         if (Math.hypot(pos.x - lastPt.x, pos.y - lastPt.y) > 3) {
            this.resetHoldTimer();
         }
         this.points.push(pos);
         this.currentStroke.points.push(pos);
      }
    } else if (activeTool === 'lasso') {
      this.lassoPoints.push(pos);
    } else if (activeTool === 'eraser') {
      this.eraseAt(pos);
    }
    
    this.render();
  }

  onPointerUp(e) {
    this.activePointers.delete(e.pointerId);
    if (this.isPanning && this.activePointers.size < 2) {
      this.isPanning = false;
      return;
    }

    this.clearHoldTimer();
    
    if (this.isDraggingSelection) {
      this.isDraggingSelection = false;
      this.saveState();
      return;
    }

    if (!this.isDrawing) return;
    this.isDrawing = false;

    const activeTool = this.isTempEraser ? 'eraser' : this.currentTool;

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      if (this.currentStroke && this.currentStroke.points.length > 1) {
        this.strokes.push(this.currentStroke);
        this.saveState();
      }
      this.currentStroke = null;
    } else if (activeTool === 'lasso') {
      this.applyLassoSelection();
      this.lassoPoints = [];
    }

    this.points = [];
    this.isTempEraser = false;
    this.render();
  }

  startHoldTimer() {
    this.clearHoldTimer();
    this.holdTimer = setTimeout(() => {
      if (this.isDrawing && this.points.length > 5) {
        // Snap to line
        this.isSnapped = true;
        const start = this.points[0];
        const end = this.points[this.points.length - 1];
        this.currentStroke.points = [start, end];
        this.currentStroke.isShape = true;
        this.currentStroke.shapeType = 'line';
        this.render();
      }
    }, 1000);
  }

  resetHoldTimer() {
    this.startHoldTimer();
  }

  clearHoldTimer() {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  eraseAt(pos) {
    const eraseRadius = 15;
    let erased = false;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const stroke = this.strokes[i];
      if (this.isPointNearStroke(pos, stroke, eraseRadius)) {
        this.strokes.splice(i, 1);
        erased = true;
        break; // Erase one at a time
      }
    }
    if (erased) {
      this.saveState();
      this.render();
    }
  }

  isPointNearStroke(pt, stroke, radius) {
    for (let i = 0; i < stroke.points.length - 1; i++) {
      const p1 = stroke.points[i];
      const p2 = stroke.points[i + 1];
      if (this.distToSegmentSquared(pt, p1, p2) < radius * radius) {
        return true;
      }
    }
    return false;
  }

  distToSegmentSquared(p, v, w) {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return (p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2;
  }

  applyLassoSelection() {
    this.selectedStrokes = [];
    if (this.lassoPoints.length < 3) return;

    this.strokes.forEach(stroke => {
      let insideCount = 0;
      stroke.points.forEach(p => {
        if (this.isPointInPolygon(p, this.lassoPoints)) insideCount++;
      });
      if (insideCount > stroke.points.length / 3 || insideCount > 5) {
        this.selectedStrokes.push(stroke);
      }
    });
  }

  clearSelection() {
    this.selectedStrokes = [];
    this.render();
  }

  isPointInPolygon(point, vs) {
    let x = point.x, y = point.y;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      let xi = vs[i].x, yi = vs[i].y;
      let xj = vs[j].x, yj = vs[j].y;
      let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  isPointInSelectionBounds(pt) {
    if (this.selectedStrokes.length === 0) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.selectedStrokes.forEach(s => {
      s.points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      });
    });
    const pad = 10;
    return pt.x >= minX - pad && pt.x <= maxX + pad && pt.y >= minY - pad && pt.y <= maxY + pad;
  }

  saveState() {
    this.undoStack.push(JSON.parse(JSON.stringify(this.strokes)));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    if (this.onChange) this.onChange(this.getData());
  }

  undo() {
    if (this.undoStack.length > 0) {
      this.redoStack.push(JSON.parse(JSON.stringify(this.strokes)));
      this.strokes = this.undoStack.pop();
      this.clearSelection();
      this.render();
      if (this.onChange) this.onChange(this.getData());
    }
  }

  redo() {
    if (this.redoStack.length > 0) {
      this.undoStack.push(JSON.parse(JSON.stringify(this.strokes)));
      this.strokes = this.redoStack.pop();
      this.clearSelection();
      this.render();
      if (this.onChange) this.onChange(this.getData());
    }
  }

  clearAll() {
    if (this.strokes.length > 0) {
      this.saveState();
      this.strokes = [];
      this.clearSelection();
      this.render();
      if (this.onChange) this.onChange(this.getData());
    }
  }

  
  async handlePdfImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      if (!window.pdfjsLib) throw new Error("PDF.js not loaded");
      
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      // Save PDF to FileDB
      const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
      this.pdfFileId = await FileDB.saveFile(blob, 'pdf', file.name);
      
      this.isMultiPage = true;
      this._pages = [];
      this.undoStack = [];
      this.redoStack = [];
      
      const scale = 2.0; // High resolution rendering
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale });
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        await page.render({ canvasContext: ctx, viewport }).promise;
        
        this._pages.push({
          type: 'pdf',
          pdfPageNum: i,
          width: viewport.width,
          height: viewport.height,
          bgCanvas: canvas,
          _strokes: []
        });
      }
      
      this.currentPageIndex = 0;
      this.updateSidebar();
      const expBtn = this.toolbar.querySelector("#btn-export-pdf"); if(expBtn) expBtn.style.display="inline-block";
      this.resetViewToPage();
    } catch (err) {
      console.error("PDF Import Error:", err);
      alert("PDF를 불러오는 중 오류가 발생했습니다.");
    }
  }

  async loadExistingPdf() {
    if (!this.pdfFileId || !window.pdfjsLib) return;
    try {
      const fileRecord = await FileDB.getFile(this.pdfFileId);
      if (!fileRecord || !fileRecord.blob) return;
      
      const arrayBuffer = await fileRecord.blob.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const scale = 2.0;
      
      for (let i = 1; i <= pdf.numPages; i++) {
        if (i - 1 < this._pages.length) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: ctx, viewport }).promise;
          this._pages[i-1].bgCanvas = canvas;
          this._pages[i-1].width = viewport.width;
          this._pages[i-1].height = viewport.height;
        }
      }
      this.updateSidebar();
      this.resetViewToPage();
    } catch(e) {
      console.error("Existing PDF Load Error", e);
    }
  }

  resetViewToPage() {
    const page = this._pages[this.currentPageIndex];
    if (page && page.width) {
      // Fit page to screen
      const scaleX = this.container.clientWidth / page.width;
      const scaleY = this.container.clientHeight / page.height;
      this.viewScale = Math.min(scaleX, scaleY) * 0.9; // 90% fit
      this.panX = (this.container.clientWidth - (page.width * this.viewScale)) / 2;
      this.panY = 20; // Slight top margin
    } else {
      this.viewScale = 1;
      this.panX = 0;
      this.panY = 0;
    }
    this.render();
  }

  switchPage(index) {
    if (index < 0 || index >= this._pages.length || index === this.currentPageIndex) return;
    this.currentPageIndex = index;
    this.undoStack = [];
    this.redoStack = [];
    this.updateSidebar();
    this.resetViewToPage();
  }

  updateSidebar() {
    const container = this.sidebar.querySelector('#drawing-thumbnails');
    container.innerHTML = '';
    
    this._pages.forEach((page, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'page-thumbnail' + (idx === this.currentPageIndex ? ' active' : '');
      thumb.draggable = true;
      
      if (page.bgCanvas) {
        // Create thumbnail sized canvas
        const tCanvas = document.createElement('canvas');
        tCanvas.width = 150;
        tCanvas.height = 150 * (page.bgCanvas.height / page.bgCanvas.width);
        const tCtx = tCanvas.getContext('2d');
        tCtx.drawImage(page.bgCanvas, 0, 0, tCanvas.width, tCanvas.height);
        
        // Draw strokes on thumbnail
        const pScale = tCanvas.width / page.bgCanvas.width;
        tCtx.scale(pScale, pScale);
        page._strokes.forEach(s => {
          tCtx.beginPath();
          tCtx.lineCap = 'round'; tCtx.lineJoin = 'round';
          tCtx.lineWidth = s.size; tCtx.strokeStyle = s.color; tCtx.globalAlpha = s.opacity || 1;
          s.points.forEach((pt, i) => {
            if (i===0) tCtx.moveTo(pt.x, pt.y); else tCtx.lineTo(pt.x, pt.y);
          });
          tCtx.stroke();
        });
        
        thumb.appendChild(tCanvas);
      } else {
        thumb.style.height = '150px';
        thumb.style.background = '#333';
      }
      
      const num = document.createElement('div');
      num.className = 'page-thumbnail-num';
      num.textContent = (idx + 1);
      thumb.appendChild(num);
      
      thumb.addEventListener('click', () => this.switchPage(idx));
      
      // Drag and drop
      thumb.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', idx);
        thumb.style.opacity = '0.5';
      });
      thumb.addEventListener('dragend', () => {
        thumb.style.opacity = '1';
        container.querySelectorAll('.page-thumbnail').forEach(el => el.classList.remove('drag-over'));
      });
      thumb.addEventListener('dragover', (e) => {
        e.preventDefault();
        thumb.classList.add('drag-over');
      });
      thumb.addEventListener('dragleave', () => {
        thumb.classList.remove('drag-over');
      });
      thumb.addEventListener('drop', (e) => {
        e.preventDefault();
        thumb.classList.remove('drag-over');
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        const toIdx = idx;
        if (fromIdx !== toIdx) {
          const moved = this._pages.splice(fromIdx, 1)[0];
          this._pages.splice(toIdx, 0, moved);
          if (this.currentPageIndex === fromIdx) this.currentPageIndex = toIdx;
          else if (fromIdx < this.currentPageIndex && toIdx >= this.currentPageIndex) this.currentPageIndex--;
          else if (fromIdx > this.currentPageIndex && toIdx <= this.currentPageIndex) this.currentPageIndex++;
          this.updateSidebar();
        }
      });
      
      container.appendChild(thumb);
    });
  }

  
  getData() {
    if (this.isMultiPage) {
      return {
        type: 'pdf_drawing',
        pdfFileId: this.pdfFileId,
        strokesPerPage: this._pages.map(p => p._strokes)
      };
    }
    return this.strokes;
  }


  fitContent() {
    if (!this.strokes || this.strokes.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasStrokes = false;
    this.strokes.forEach(s => {
      if (s.isBg) return;
      if (!s.points || s.points.length === 0) return;
      const size = s.size || 2;
      hasStrokes = true;
      s.points.forEach(p => {
        if (p.x - size < minX) minX = p.x - size;
        if (p.y - size < minY) minY = p.y - size;
        if (p.x + size > maxX) maxX = p.x + size;
        if (p.y + size > maxY) maxY = p.y + size;
      });
    });
    if (!hasStrokes) return;

    const padding = 20;
    const contentWidth = maxX - minX + padding * 2;
    const contentHeight = maxY - minY + padding * 2;
    if (contentWidth <= 0 || contentHeight <= 0) return;

    const rect = this.canvasContainer.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const scaleX = rect.width / contentWidth;
    const scaleY = rect.height / contentHeight;
    this.viewScale = Math.min(scaleX, scaleY, 1);

    const scaledWidth = (maxX - minX + padding * 2) * this.viewScale;
    const scaledHeight = (maxY - minY + padding * 2) * this.viewScale;
    this.panX = (rect.width - scaledWidth) / 2 - (minX - padding) * this.viewScale;
    this.panY = (rect.height - scaledHeight) / 2 - (minY - padding) * this.viewScale;
    this.updateZoomIndicator();
  }

  resize() {
    const rect = this.canvasContainer.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.scale(dpr, dpr);
    
    if (this.readOnly) {
      this.fitContent();
    }
    
    this.render();
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.save();
    
    // Apply pan and zoom
    this.ctx.translate(this.panX, this.panY);
    this.ctx.scale(this.viewScale, this.viewScale);

    const currentPage = this._pages[this.currentPageIndex];
    if (currentPage && currentPage.bgCanvas) {
      this.ctx.drawImage(currentPage.bgCanvas, 0, 0);
    }


    // Draw saved strokes
    this.strokes.forEach(stroke => this.drawStroke(stroke));

    // Draw current stroke
    if (this.currentStroke) {
      this.drawStroke(this.currentStroke);
    }

    // Draw Lasso path
    if (this.lassoPoints.length > 0) {
      this.ctx.beginPath();
      this.ctx.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);
      for (let i = 1; i < this.lassoPoints.length; i++) {
        this.ctx.lineTo(this.lassoPoints[i].x, this.lassoPoints[i].y);
      }
      this.ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
      this.ctx.lineWidth = 1 / this.viewScale;
      this.ctx.setLineDash([5 / this.viewScale, 5 / this.viewScale]);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    // Draw Selection Bounding Box
    if (this.selectedStrokes.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      this.selectedStrokes.forEach(s => {
        s.points.forEach(p => {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        });
      });
      const pad = 5;
      this.ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
      this.ctx.lineWidth = 1 / this.viewScale;
      this.ctx.setLineDash([4 / this.viewScale, 4 / this.viewScale]);
      this.ctx.strokeRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
      this.ctx.setLineDash([]);
      
      this.selectedStrokes.forEach(stroke => {
        this.ctx.save();
        this.ctx.globalAlpha = 0.3;
        this.ctx.shadowColor = '#3b82f6';
        this.ctx.shadowBlur = 10 / this.viewScale;
        this.drawStroke(stroke, true);
        this.ctx.restore();
      });
    }

    this.ctx.restore();
  }

  drawStroke(stroke, isHighlight = false) {
    if (stroke.isBg) return;
    if (stroke.points.length < 2) return;
    
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = stroke.size;
    this.ctx.strokeStyle = stroke.color;
    this.ctx.globalAlpha = stroke.opacity || 1;

    // Simulate highlighter blending
    if (stroke.tool === 'highlighter' && !isHighlight) {
       this.ctx.globalCompositeOperation = 'multiply'; // Works well on light backgrounds
    } else {
       this.ctx.globalCompositeOperation = 'source-over';
    }

    if (stroke.isShape) {
      this.ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      this.ctx.lineTo(stroke.points[1].x, stroke.points[1].y);
    } else {
      this.ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const xc = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
        const yc = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
        this.ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, xc, yc);
      }
      const last = stroke.points[stroke.points.length - 1];
      this.ctx.lineTo(last.x, last.y);
    }
    
    this.ctx.stroke();
    this.ctx.restore();
  }
}

window.NeonDrawingBoard = NeonDrawingBoard;
