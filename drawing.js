class NeonDrawingBoard {
  constructor(container, options = {}) {
    this.container = container;
    this.onChange = options.onChange || null;
    this.readOnly = options.readOnly || false;

    // Load initial data
    this.strokes = options.initialData ? JSON.parse(JSON.stringify(options.initialData)) : [];
    const bgStroke = this.strokes.find(s => s.isBg);
    this.bgColor = bgStroke ? bgStroke.color : (localStorage.getItem('planeer_bg_color') || '#1e1e1e');
    this.undoStack = [];
    this.redoStack = [];

    // Settings
    this.currentTool = 'pen'; // pen, highlighter, eraser, lasso
    this.penColor = localStorage.getItem('planeer_pen_color') || '#ffffff';
    this.penSize = parseInt(localStorage.getItem('planeer_pen_size')) || 2;
    this.penOpacity = parseFloat(localStorage.getItem('planeer_pen_opacity')) || 1.0;
    this.highlighterColor = localStorage.getItem('planeer_hl_color') || '#facc15';
    this.highlighterSize = parseInt(localStorage.getItem('planeer_hl_size')) || 15;
    this.highlighterOpacity = parseFloat(localStorage.getItem('planeer_hl_opacity')) || 0.4;
    
    this.penPresets = JSON.parse(localStorage.getItem('planeer_pen_presets')) || ['#ffffff', '#ff4d4d', '#4da6ff', '#54ff4d', '#ffed4d'];
    this.hlPresets = JSON.parse(localStorage.getItem('planeer_hl_presets')) || ['#facc15', '#ff7b72', '#79c0ff', '#85e89d', '#ffed4d'];

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
    
    // Add floating eraser toggle
    if (!this.readOnly) {
      this.floatingEraserBtn = document.createElement('button');
      this.floatingEraserBtn.className = 'floating-eraser-toggle';
      this.floatingEraserBtn.innerHTML = '🧽';
      this.floatingEraserBtn.title = '지우개 빠른 전환';
      
      let prevTool = 'pen';
      
      // We use pointerdown instead of click for faster response on touch
      this.floatingEraserBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (this.currentTool === 'eraser') {
          // Switch back to previous tool
          this.currentTool = prevTool;
          this.floatingEraserBtn.classList.remove('active');
        } else {
          // Switch to eraser
          prevTool = this.currentTool;
          this.currentTool = 'eraser';
          this.floatingEraserBtn.classList.add('active');
        }
        
        // Sync toolbar UI
        const toolBtns = this.toolbar.querySelectorAll('.tool-btn');
        toolBtns.forEach(b => b.classList.remove('active'));
        const activeBtn = this.toolbar.querySelector(`.tool-btn[data-tool="${this.currentTool}"]`);
        if (activeBtn) activeBtn.classList.add('active');
        
        this.updateSettingsUI();
      });
      
      this.canvasContainer.appendChild(this.floatingEraserBtn);
    }
    
    this.wrapper.appendChild(this.canvasContainer);
    this.container.appendChild(this.wrapper);

    // Auto-expand if initial strokes go beyond default height
    let maxY = 0;
    this.strokes.forEach(stroke => {
      if (!stroke.points) return;
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
        <div class="bg-presets" style="display:flex; gap:4px; align-items:center;">
          <input type="color" id="custom-bg-color" class="color-picker" value="${this.bgColor}" style="width:28px; height:28px; border:none; cursor:pointer; padding:0; background:transparent;" title="클릭하여 배경색 변경">
        </div>
      </div>
      <div class="drawing-actions">
        <button class="action-btn" id="btn-save-image" title="이미지로 저장">💾</button>
        <button class="action-btn" id="btn-reset-view" title="1:1 화면 초기화">🔍</button>
        <span id="zoom-text" style="font-size:0.85rem; font-weight:bold; color:#818cf8; margin-left: 4px; margin-right: 8px; min-width: 40px; text-align: center;">100%</span>
        <button class="action-btn" id="btn-pen-mode" title="손가락 그리기 허용됨 (클릭하여 펜 전용 모드로 전환)">👆</button>
        <button class="action-btn" id="btn-undo" title="실행 취소">↩️</button>
        <button class="action-btn" id="btn-redo" title="다시 실행">↪️</button>
        <button class="action-btn" id="btn-clear" title="전체 지우기">🗑️</button>
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

    const bgPresetBtns = this.toolbar.querySelectorAll('.bg-preset-btn');
    const updateBgColor = (color) => {
      this.bgColor = color;
      this.canvasContainer.style.backgroundColor = this.bgColor;
      this.strokes = this.strokes.filter(s => !s.isBg);
      this.strokes.unshift({ isBg: true, color: this.bgColor });
      this.saveState();
      
      bgPresetBtns.forEach(b => {
        b.style.borderColor = (b.dataset.color === color) ? '#3b82f6' : (b.dataset.color === '#1e1e1e' ? '#555' : '#ccc');
      });
      const customPicker = this.toolbar.querySelector('#custom-bg-color');
      if (customPicker) customPicker.value = color;
    };

    bgPresetBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        updateBgColor(btn.dataset.color);
      });
    });

    const customBgColor = this.toolbar.querySelector('#custom-bg-color');
    if (customBgColor) {
      customBgColor.addEventListener('input', (e) => {
        updateBgColor(e.target.value);
      });
    }

    const btnResetView = this.toolbar.querySelector('#btn-reset-view');
    if (btnResetView) {
      btnResetView.addEventListener('click', (e) => {
        e.preventDefault();
        this.viewScale = 1;
        this.panX = 0;
        this.panY = 0;
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

  updateSettingsUI() {
    this.settingsContainer.innerHTML = '';
    
    const renderPresets = (presets, activeColor) => {
      return presets.map((color, idx) => {
        const isActive = color === activeColor;
        const border = isActive ? '2px solid #3b82f6' : '2px solid #555';
        return `<button class="preset-color" style="background:${color}; width:32px; height:32px; border-radius:50%; border:${border}; cursor:pointer; padding:0; box-shadow: 0 1px 3px rgba(0,0,0,0.3);" data-index="${idx}" data-color="${color}" title="클릭하여 색상 선택, 길게 눌러 변경"></button>`;
      }).join('');
    };

    if (this.currentTool === 'pen') {
      this.settingsContainer.innerHTML = `
        <div class="setting-group" style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding: 4px; width: 100%;">
          <div style="display:flex; gap:8px;">
            ${renderPresets(this.penPresets, this.penColor)}
            <input type="color" class="color-picker" id="hidden-preset-picker" style="opacity:0; position:absolute; width:0; height:0; pointer-events:none;">
            <input type="color" class="color-picker" value="${this.penColor}" id="pen-color" style="width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer; padding: 0; background: transparent; flex-shrink: 0;" title="연속 색상 지정 (자유 선택)">
          </div>
          <div style="display:flex; flex-direction:column; gap:2px; margin-left: auto; flex-shrink: 0;">
            <input type="range" class="size-slider" min="1" max="20" value="${this.penSize}" id="pen-size" title="굵기" style="width: 80px;">
            <input type="range" class="opacity-slider" min="0.1" max="1" step="0.1" value="${this.penOpacity}" id="pen-opacity" title="농도" style="width: 80px;">
          </div>
        </div>
      `;
    } else if (this.currentTool === 'highlighter') {
      this.settingsContainer.innerHTML = `
        <div class="setting-group" style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding: 4px; width: 100%;">
          <div style="display:flex; gap:8px;">
            ${renderPresets(this.hlPresets, this.highlighterColor)}
            <input type="color" class="color-picker" id="hidden-preset-picker" style="opacity:0; position:absolute; width:0; height:0; pointer-events:none;">
            <input type="color" class="color-picker" value="${this.highlighterColor}" id="hl-color" style="width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer; padding: 0; background: transparent; flex-shrink: 0;" title="연속 색상 지정 (자유 선택)">
          </div>
          <div style="display:flex; flex-direction:column; gap:2px; margin-left: auto; flex-shrink: 0;">
            <input type="range" class="size-slider" min="5" max="50" value="${this.highlighterSize}" id="hl-size" title="굵기" style="width: 80px;">
            <input type="range" class="opacity-slider" min="0.1" max="1" step="0.1" value="${this.highlighterOpacity}" id="hl-opacity" title="농도" style="width: 80px;">
          </div>
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
          const isActive = (isPen && this.penColor === color) || (!isPen && this.highlighterColor === color);
          
          if (isActive) {
            // If already active, open color picker to change it
            targetPresetIndex = parseInt(btn.dataset.index);
            hiddenPicker.value = color;
            hiddenPicker.click();
          } else {
            // If not active, just set it as active
            if (isPen) {
              this.penColor = color;
              localStorage.setItem('planeer_pen_color', color);
            } else {
              this.highlighterColor = color;
              localStorage.setItem('planeer_hl_color', color);
            }
            this.settingsContainer.querySelector(colorInputId).value = color;
            this.updateSettingsUI();
          }
        });
        
        // Keep right click / long press as a fallback
        btn.addEventListener('contextmenu', e => {
          e.preventDefault();
          targetPresetIndex = parseInt(btn.dataset.index);
          hiddenPicker.value = btn.dataset.color;
          hiddenPicker.click();
        });
      });

      this.settingsContainer.querySelector(colorInputId).addEventListener('input', e => {
        const val = e.target.value;
        if (isPen) {
          this.penColor = val;
          localStorage.setItem('planeer_pen_color', val);
        } else {
          this.highlighterColor = val;
          localStorage.setItem('planeer_hl_color', val);
        }
        
        this.settingsContainer.querySelectorAll('.preset-color').forEach(btn => {
          if (btn.dataset.color === val) {
            btn.style.border = '2px solid #3b82f6';
          } else {
            btn.style.border = '2px solid #555';
          }
        });
      });
      this.settingsContainer.querySelector(sizeInputId).addEventListener('input', e => {
        if (isPen) {
          this.penSize = parseInt(e.target.value);
          localStorage.setItem('planeer_pen_size', this.penSize);
        } else {
          this.highlighterSize = parseInt(e.target.value);
          localStorage.setItem('planeer_hl_size', this.highlighterSize);
        }
      });
      this.settingsContainer.querySelector(opacityInputId).addEventListener('input', e => {
        if (isPen) {
          this.penOpacity = parseFloat(e.target.value);
          localStorage.setItem('planeer_pen_opacity', this.penOpacity);
        } else {
          this.highlighterOpacity = parseFloat(e.target.value);
          localStorage.setItem('planeer_hl_opacity', this.highlighterOpacity);
        }
      });
    }
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.canvas.addEventListener('pointerout', this.onPointerUp.bind(this));
    this.canvas.addEventListener('pointercancel', this.onPointerUp.bind(this));
    this.canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      // Intercept S-Pen side button press which often fires contextmenu on Android
      this.isTempEraser = true;
      if (this.isDrawing && this.currentStroke) {
        this.currentStroke = null;
        this.points = [];
      } else if (!this.isDrawing) {
        this.isDrawing = true;
        this.points = [];
        const pos = this.getPointerPos(e);
        this.eraseAt(pos);
      }
    });
  }

  getPointerPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) - this.panX) / this.viewScale,
      y: ((e.clientY - rect.top) - this.panY) / this.viewScale
    };
  }

  onPointerDown(e) {
    if (this.readOnly) return;
    this.clearHoldTimer();
    
    const isEraserButton = e.pointerType === 'eraser' || e.button === 2 || e.button === 5 || e.button === 1 || (e.buttons & 2) || (e.buttons & 32) || (e.buttons & 4) || e.altKey || e.ctrlKey || e.shiftKey || e.metaKey;
    if (e.pointerType === 'mouse' && e.button !== 0 && !isEraserButton) return;
    
    // Preserve hover state for S-Pen because Android touch layer often masks the button press during pointerdown
    if (e.pointerType === 'pen' && this.isTempEraser) {
      // Keep this.isTempEraser as true
    } else {
      this.isTempEraser = isEraserButton;
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
    }

    // Dynamically check if eraser button is pressed during move
    const isEraserButton = e.pointerType === 'eraser' || e.button === 2 || e.button === 5 || e.button === 1 || (e.buttons & 2) || (e.buttons & 32) || (e.buttons & 4) || e.altKey || e.ctrlKey || e.shiftKey || e.metaKey;
    if (isEraserButton) {
      this.isTempEraser = true;
    } else if (e.pointerType === 'mouse') { 
      // Only reset for mouse, since S-Pen often drops the button state during move
      this.isTempEraser = false;
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
    } else if (activeTool === 'lasso') {
      this.applyLassoSelection();
      this.lassoPoints = [];
    }

    this.currentStroke = null;
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

  getData() {
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
    if (this.toolbar) {
      const zoomText = this.toolbar.querySelector('#zoom-text');
      if (zoomText) zoomText.innerText = Math.round(this.viewScale * 100) + '%';
    }

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.save();
    // Apply pan and zoom
    this.ctx.translate(this.panX, this.panY);
    this.ctx.scale(this.viewScale, this.viewScale);

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
