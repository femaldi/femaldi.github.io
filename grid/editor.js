// --- CONFIGURATION ---
const TILE_SIZE = 32;
const GRID_WIDTH = 24;
const GRID_HEIGHT = 24;
const PALETTE_WIDTH = 200; // Extra width for the UI palette

// --- EDITOR SCENE ---
class EditorScene extends Phaser.Scene {
    constructor() {
        super('EditorScene');
        this.gridData = []; // 2D array holding the level data (block IDs)
        this.gridObjects = []; // 2D array holding the Phaser Text objects for visuals
        this.dynamicBlocks = []; // --- NEW: Array to hold dynamic block objects
        this.selectedBlock = { id: 'wall', isDynamic: false }; // --- MODIFIED: Start with wall selected
        this.paletteHighlight = null;
        this.parameterEditor = null; // --- NEW: To hold the parameter editor UI
        this.networkNode = null;
        this.buffer_size = null;
        this.reset_timer = null;
    }
    
    preload() {
    
    }

    create() {
        this.initializeGridData();
        this.drawGrid();
        this.drawPalette();
        this.setupInput();
    }

    // --- SETUP METHODS ---

    initializeGridData() {
        this.dynamicBlocks = []; // Clear dynamic blocks on creation
        this.networkNode = null;
        this.buffer_size = null;
        this.reset_timer = null;
        for (let y = 0; y < GRID_HEIGHT; y++) {
            this.gridData[y] = [];
            this.gridObjects[y] = []; // It creates a new array for gridObjects...
            for (let x = 0; x < GRID_WIDTH; x++) {
                this.gridData[y][x] = null;
                this.gridObjects[y][x] = null; // ... and fills it with `null`!
            }
        }
    }

    generateNetworkNode() {
        const hex1 = Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, '0');
        const hex2 = Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, '0');
        const digit = Math.floor(Math.random() * 10);
        return `${hex1}.${hex2}.${digit}`;
    }

    drawGrid() {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                const tx = x * TILE_SIZE;
                const ty = y * TILE_SIZE;

                this.add.rectangle(tx, ty, TILE_SIZE, TILE_SIZE)
                    .setStrokeStyle(1, 0x008800)
                    .setOrigin(0, 0);
                
                const blockChar = this.add.text(
                    tx + TILE_SIZE / 2,
                    ty + TILE_SIZE / 2,
                    '', { fontSize: '24px', fontFamily: 'Courier', align: 'center' }
                ).setOrigin(0.5);
                
                this.gridObjects[y][x] = blockChar;
            }
        }
    }
    
    drawPalette() {
        const paletteX = GRID_WIDTH * TILE_SIZE + 20;
        let paletteY = 20;

        this.paletteHighlight = this.add.rectangle(paletteX - 10, 0, PALETTE_WIDTH - 20, 40, 0x00ff00, 0.3).setOrigin(0);

        // --- Draw Static Blocks ---
        for (const key in BLOCK_TYPES) {
            const block = BLOCK_TYPES[key];
            const currentButtonY = paletteY;

            const buttonRect = this.add.rectangle(paletteX - 10, currentButtonY - 5, PALETTE_WIDTH - 20, 40)
                .setStrokeStyle(1, 0x00ff00)
                .setOrigin(0)
                .setInteractive({ useHandCursor: true });

            const buttonText = this.add.text(paletteX, currentButtonY, `[${block.char || ' '}] ${block.name}`, { color: block.color, fontSize: '16px' });
            
            if (block.id === this.selectedBlock.id && !this.selectedBlock.isDynamic) {
                this.paletteHighlight.y = currentButtonY - 5;
            }

            buttonRect.on('pointerdown', () => {
                this.selectedBlock = { id: block.id, isDynamic: false };
                this.paletteHighlight.y = currentButtonY - 5;
                this.closeParameterEditor();
            });

            paletteY += 50;
        }

        // --- NEW: Draw Dynamic Blocks ---
        paletteY += 20; // Add some space
        this.add.line(paletteX - 10, paletteY - 10, paletteX + PALETTE_WIDTH - 30, paletteY - 10, 0x00ff00).setOrigin(0);

        for (const key in DYNAMIC_BLOCK_TYPES) {
            const block = DYNAMIC_BLOCK_TYPES[key];
            const currentButtonY = paletteY; 

            const buttonRect = this.add.rectangle(paletteX - 10, currentButtonY - 5, PALETTE_WIDTH - 20, 40)
                .setStrokeStyle(1, block.color) // Use block's color for border
                .setOrigin(0)
                .setInteractive({ useHandCursor: true });

            const buttonText = this.add.text(paletteX, currentButtonY, `[${block.char}] ${block.name}`, { color: block.color, fontSize: '16px' });
            
            if (block.id === this.selectedBlock.id && this.selectedBlock.isDynamic) {
                this.paletteHighlight.y = currentButtonY - 5;
            }

            buttonRect.on('pointerdown', () => {
                this.selectedBlock = { id: block.id, isDynamic: true };
                this.paletteHighlight.y = currentButtonY - 5;
                this.closeParameterEditor();
            });
            paletteY += 50;
        }


        // --- Save & Load Buttons ---
        const saveButtonY = this.game.config.height - 60;
        const loadButtonY = saveButtonY - 50;

        const loadButton = this.add.rectangle(paletteX - 10, loadButtonY - 5, PALETTE_WIDTH - 20, 40, 0x00ff00)
            .setOrigin(0).setInteractive({ useHandCursor: true });
        this.add.text(paletteX + 35, loadButtonY + 5, 'LOAD LEVEL', { color: '#000000', fontSize: '16px' });
        loadButton.on('pointerdown', () => this.initiateLoad());
        
        const saveButton = this.add.rectangle(paletteX - 10, saveButtonY - 5, PALETTE_WIDTH - 20, 40, 0x00ff00)
            .setOrigin(0).setInteractive({ useHandCursor: true });
        this.add.text(paletteX + 35, saveButtonY + 5, 'SAVE LEVEL', { color: '#000000', fontSize: '16px' });
        saveButton.on('pointerdown', () => this.saveLevelData());
    }
    
    setupInput() {
        this.input.on('pointerdown', (pointer) => {
            if (pointer.x < GRID_WIDTH * TILE_SIZE) this.handleGridClick(pointer);
        });

        this.input.on('pointermove', (pointer) => {
            if (pointer.isDown && pointer.x < GRID_WIDTH * TILE_SIZE) this.handleGridClick(pointer);
        });
    }

    // --- EDITOR LOGIC (REFACTORED) ---

    handleGridClick(pointer) {
        if (this.parameterEditor && this.parameterEditor.active) {
            const bg = this.parameterEditor.getChildren()[0];
            if (!bg.getBounds().contains(pointer.x, pointer.y)) {
                this.closeParameterEditor();
            }
            return;
        }

        const gridX = Math.floor(pointer.x / TILE_SIZE);
        const gridY = Math.floor(pointer.y / TILE_SIZE);

        if (gridX < 0 || gridX >= GRID_WIDTH || gridY < 0 || gridY >= GRID_HEIGHT) return;
        
        const existingDynamicBlock = this.findDynamicBlockAt(gridX, gridY);
        if (existingDynamicBlock && this.selectedBlock.id === 'erase') {
             this.clearTile(gridX, gridY);
        } else if (existingDynamicBlock) {
            this.showParameterEditor(existingDynamicBlock, pointer);
        } else {
            if (this.selectedBlock.isDynamic) {
                this.placeDynamicBlock(gridX, gridY);
            } else {
                this.placeStaticBlock(gridX, gridY);
            }
        }
    }
    
    placeStaticBlock(x, y) {
        this.clearTile(x, y);
        this.gridData[y][x] = this.selectedBlock.id;
        this.updateGridVisual(x, y);
    }

    placeDynamicBlock(x, y) {
        this.clearTile(x, y);
        const blockType = DYNAMIC_BLOCK_TYPES[this.selectedBlock.id];
        if (!blockType) return;

        const newBlock = {
            type: blockType.id,
            position: [x, y],
            parameters: {}
        };
        for(const key in blockType.parameters) {
            newBlock.parameters[key] = blockType.parameters[key].default;
        }

        this.dynamicBlocks.push(newBlock);
        this.updateGridVisual(x, y);
    }
    
    updateGridVisual(x, y) {
        const visualObject = this.gridObjects[y][x];
        const dynamicBlock = this.findDynamicBlockAt(x, y);
        
        if (dynamicBlock) {
            const blockType = DYNAMIC_BLOCK_TYPES[dynamicBlock.type];
            visualObject.setText(blockType.getDisplayChar(dynamicBlock.parameters));
            visualObject.setColor(blockType.color);
        } else {
            const staticBlockId = this.gridData[y][x];
            const blockType = BLOCK_TYPES[staticBlockId] || BLOCK_TYPES.erase;
            visualObject.setText(blockType.char);
            visualObject.setColor(blockType.color);
        }
    }

    findDynamicBlockAt(x, y) {
        return this.dynamicBlocks.find(b => b.position[0] === x && b.position[1] === y);
    }

    clearTile(x, y) {
        this.gridData[y][x] = null;
        const index = this.dynamicBlocks.findIndex(b => b.position[0] === x && b.position[1] === y);
        if (index > -1) {
            this.dynamicBlocks.splice(index, 1);
        }
        this.updateGridVisual(x, y);
    }

    saveLevelData() {
        const levelData = {
            width: GRID_WIDTH,
            height: GRID_HEIGHT,
            reset_timer: this.reset_timer || 32,
            buffer_size: this.buffer_size || 5,
            tiles: this.gridData,
            network_node: this.networkNode || this.generateNetworkNode(),
            dynamic_blocks: this.dynamicBlocks
        };
        const jsonString = JSON.stringify(levelData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `level-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log("Level data saved!");
    }
    
    initiateLoad() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.style.display = 'none';
        fileInput.onchange = event => {
            const file = event.target.files[0];
            if (file) this.processLoadedFile(file);
        };
        document.body.appendChild(fileInput);
        fileInput.click();
        document.body.removeChild(fileInput);
    }
    
    processLoadedFile(file) {
        const reader = new FileReader();
        reader.onload = event => {
            try {
                const levelData = JSON.parse(event.target.result);
                this.applyLevelData(levelData);
            } catch (e) {
                console.error("Error parsing JSON file:", e);
                alert("Failed to load level. The file is not valid JSON.");
            }
        };
        reader.readAsText(file);
    }
    
    /**
     * Validates the loaded data and updates the grid.
     * @param {object} levelData The parsed level data from the JSON file.
     */
    applyLevelData(levelData) {
        // Basic validation
        if (!levelData.tiles || levelData.width !== GRID_WIDTH || levelData.height !== GRID_HEIGHT) {
            console.error("Invalid or incompatible level file format.");
            alert("Incompatible level file. Make sure it's a 24x24 level.");
            return;
        }

        console.log("Applying loaded level data...");
        
        // --- THIS IS THE FIX ---
        // Do NOT call initializeGridData() as it nulls our visual objects.
        // Instead, just reset the data arrays before loading new data.
        this.dynamicBlocks = [];
        this.gridData = [];
        
        // Load data from file
        this.gridData = levelData.tiles;
        this.networkNode = levelData.network_node || null;
        this.buffer_size = levelData.buffer_size || null;
        this.reset_timer = levelData.reset_timer || null;
        if (levelData.dynamic_blocks && Array.isArray(levelData.dynamic_blocks)) {
            this.dynamicBlocks = levelData.dynamic_blocks;
        }

        // Redraw the entire grid based on new data.
        // This works now because this.gridObjects still holds the text objects.
        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                this.updateGridVisual(x, y);
            }
        }
    }
    
    closeParameterEditor() {
        if (this.parameterEditor) {
            this.parameterEditor.destroy(true);
            this.parameterEditor = null;
        }
    }

    showParameterEditor(block, pointer) {
        this.closeParameterEditor();

        const blockType = DYNAMIC_BLOCK_TYPES[block.type];
        if (!blockType) return;

        this.parameterEditor = this.add.group();

        const options = blockType.parameters.direction.options;
        const startX = pointer.x + 10;
        const startY = pointer.y + 10;
        const boxWidth = 150;
        const boxHeight = 20 + options.length * 30 + 10;

        const bg = this.add.rectangle(startX, startY, boxWidth, boxHeight, 0x000000, 0.9).setOrigin(0).setStrokeStyle(1, blockType.color);
        this.parameterEditor.add(bg);

        let currentY = startY + 10;
        
        options.forEach(option => {
            const optionText = this.add.text(startX + 10, currentY, `Set: ${option}`, { fontSize: '16px' })
                .setInteractive({ useHandCursor: true });
            
            if (block.parameters.direction === option) {
                optionText.setColor('#ffff00');
            }

            optionText.on('pointerdown', (pointer) => {
                block.parameters.direction = option;
                this.updateGridVisual(block.position[0], block.position[1]);
                this.closeParameterEditor();
            });

            this.parameterEditor.add(optionText);
            currentY += 30;
        });
    }
}


// --- PHASER GAME CONFIGURATION ---
const config = {
    type: Phaser.AUTO,
    width: TILE_SIZE * GRID_WIDTH + PALETTE_WIDTH,
    height: TILE_SIZE * GRID_HEIGHT,
    parent: 'editor-container',
    backgroundColor: '#000000',
    scene: [EditorScene]
};

const editor = new Phaser.Game(config);