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
        this.dynamicBlocks = []; // Array to hold dynamic block objects
        this.selectedBlock = { id: 'wall', isDynamic: false };
        this.paletteHighlight = null;
        this.parameterEditor = null; // To hold the parameter editor UI
        this.networkNode = null;
        this.buffer_size = null;
        this.reset_timer = null;
        // --- NEW: Editor state for special modes ---
        this.editorMode = 'NORMAL'; // 'NORMAL' or 'LINKING'
        this.linkingButton = null; // The button we are currently linking
        this.linkVisuals = []; // Array for temporary line objects
        this.finishLinkButton = null; // The button to exit linking mode
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
            this.gridObjects[y] = [];
            for (let x = 0; x < GRID_WIDTH; x++) {
                this.gridData[y][x] = null;
                this.gridObjects[y][x] = null;
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
                 if (this.editorMode === 'LINKING') this.stopLinkingMode();
            });

            paletteY += 50;
        }

        // --- Draw Dynamic Blocks ---
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
                 if (this.editorMode === 'LINKING') this.stopLinkingMode();
            });
            paletteY += 50;
        }


        // --- Save & Load Buttons ---
        const saveButtonY = this.game.config.height - 60;
        const loadButtonY = saveButtonY - 50;
        const finishLinkButtonY = loadButtonY - 50;

        // --- NEW: Finish Linking Button ---
        this.finishLinkButton = this.add.group();
        const finishBtnRect = this.add.rectangle(paletteX - 10, finishLinkButtonY - 5, PALETTE_WIDTH - 20, 40, 0x00ff00)
             .setOrigin(0).setInteractive({ useHandCursor: true });
        const finishBtnText = this.add.text(paletteX + 15, finishLinkButtonY + 5, 'FINISH LINKING', { color: '#000000', fontSize: '16px' });
        finishBtnRect.on('pointerdown', () => this.stopLinkingMode());
        this.finishLinkButton.add(finishBtnRect);
        this.finishLinkButton.add(finishBtnText);
        this.finishLinkButton.setVisible(false); // Initially hidden

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

        // --- NEW: Handle special "LINKING" mode ---
        if (this.editorMode === 'LINKING') {
            this.handleLinkingClick(gridX, gridY);
            return;
        }

        const selectedToolId = this.selectedBlock.id;
        const isSelectedToolDynamic = this.selectedBlock.isDynamic;

        // --- Rule 1: ERASE tool is selected. ---
        if (selectedToolId === 'erase') {
            // Erase is a special case. It *can* target a specific dynamic block if there are multiple.
            const existingBlocks = this.findDynamicBlocksAt(gridX, gridY);
            if (existingBlocks.length > 1) {
                // If there are multiple, prompt which one to erase.
                this.showEraseSelectorModal(existingBlocks, pointer);
            } else {
                // If there's 0 or 1, just wipe the whole tile.
                this.clearTile(gridX, gridY);
            }
            return;
        }
        
        // --- Rule 2: A STATIC tool (wall, etc.) is selected. ---
        if (!isSelectedToolDynamic) {
            this.placeStaticBlock(gridX, gridY);
            return;
        }

        // --- Rule 3: A DYNAMIC tool (sentinel, arrow) is selected. ---
        if (isSelectedToolDynamic) {
            const existingDynamicBlocks = this.findDynamicBlocksAt(gridX, gridY);
            // Find a block on the tile that MATCHES the selected tool.
            const blockToEdit = existingDynamicBlocks.find(b => b.type === selectedToolId);

            if (blockToEdit) {
                // A block of the selected tool's type exists. Edit its parameters.
                this.showParameterEditor(blockToEdit, pointer);
            } else {
                // No block of the selected tool's type exists. Place a new one.
                this.placeDynamicBlock(gridX, gridY);
            }
        }
    }

    showEraseSelectorModal(blocks, pointer) {
        this.closeParameterEditor(); 

        this.parameterEditor = this.add.group();
        const startX = pointer.x + 10;
        const startY = pointer.y + 10;
        const boxWidth = 180;
        const boxHeight = 20 + blocks.length * 40 + 10;

        const bg = this.add.rectangle(startX, startY, boxWidth, boxHeight, 0x000000, 0.9).setOrigin(0).setStrokeStyle(1, '#ff0000');
        this.parameterEditor.add(bg);

        let currentY = startY + 10;

        blocks.forEach(block => {
            const blockType = DYNAMIC_BLOCK_TYPES[block.type];
            const optionText = this.add.text(startX + 10, currentY, `Erase: ${blockType.name}`, { fontSize: '16px', color: blockType.color })
                .setInteractive({ useHandCursor: true });
            
            optionText.on('pointerdown', () => {
                const index = this.dynamicBlocks.findIndex(b => b === block);
                if (index > -1) {
                    this.dynamicBlocks.splice(index, 1);
                }
                this.updateGridVisual(block.position[0], block.position[1]);
                this.closeParameterEditor();
            });

            this.parameterEditor.add(optionText);
            currentY += 40;
        });
    }
    
    placeStaticBlock(x, y) {
        this.clearTile(x, y);
        this.gridData[y][x] = this.selectedBlock.id;
        this.updateGridVisual(x, y);
    }

    placeDynamicBlock(x, y) {
        const blockType = DYNAMIC_BLOCK_TYPES[this.selectedBlock.id];
        if (!blockType) return;
        
        const existingBlocks = this.findDynamicBlocksAt(x, y);
        if (existingBlocks.some(b => b.type === blockType.id)) {
            const blockToEdit = existingBlocks.find(b => b.type === blockType.id);
            this.showParameterEditor(blockToEdit, {x: x * TILE_SIZE, y: y * TILE_SIZE});
            return;
        }
        
        if (this.gridData[y][x] !== null) {
            this.gridData[y][x] = null;
        }

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
        this.showParameterEditor(newBlock, {x: x * TILE_SIZE, y: y * TILE_SIZE});
    }
    
    updateGridVisual(x, y) {
        const visualObject = this.gridObjects[y][x];
        const dynamicBlocksOnTile = this.findDynamicBlocksAt(x, y);
        
        visualObject.setAlpha(1.0); // Reset alpha

        if (dynamicBlocksOnTile.length > 0) {
            let topBlock = dynamicBlocksOnTile.reduce((prev, current) => {
                const prevPrio = DYNAMIC_BLOCK_TYPES[prev.type].renderPriority || 0;
                const currPrio = DYNAMIC_BLOCK_TYPES[current.type].renderPriority || 0;
                return (prevPrio > currPrio) ? prev : current;
            });
            
            const blockType = DYNAMIC_BLOCK_TYPES[topBlock.type];
            visualObject.setText(blockType.getDisplayChar(topBlock.parameters));
            visualObject.setColor(blockType.color);

            if (blockType.isStateful && topBlock.parameters.initial_state === 'disabled') {
                visualObject.setAlpha(0.4);
            }
        } else {
            const staticBlockId = this.gridData[y][x];
            const blockType = BLOCK_TYPES[staticBlockId] || BLOCK_TYPES.erase;
            visualObject.setText(blockType.char);
            visualObject.setColor(blockType.color);
        }
    }

    findDynamicBlocksAt(x, y) {
        return this.dynamicBlocks.filter(b => b.position[0] === x && b.position[1] === y);
    }

    clearTile(x, y) {
        this.gridData[y][x] = null;
        this.dynamicBlocks = this.dynamicBlocks.filter(b => b.position[0] !== x || b.position[1] !== y);
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
    
    applyLevelData(levelData) {
        if (!levelData.tiles || levelData.width !== GRID_WIDTH || levelData.height !== GRID_HEIGHT) {
            console.error("Invalid or incompatible level file format.");
            alert("Incompatible level file. Make sure it's a 24x24 level.");
            return;
        }
        console.log("Applying loaded level data...");
        
        this.dynamicBlocks = [];
        this.gridData = [];
        
        this.gridData = levelData.tiles;
        this.networkNode = levelData.network_node || null;
        this.buffer_size = levelData.buffer_size || null;
        this.reset_timer = levelData.reset_timer || null;
        
        if (levelData.dynamic_blocks && Array.isArray(levelData.dynamic_blocks)) {
            // Ensure all dynamic blocks have a parameters object and all default values
            levelData.dynamic_blocks.forEach(block => {
                const blockType = DYNAMIC_BLOCK_TYPES[block.type];
                if (!blockType) return; // Skip if it's an unknown type

                // Ensure parameters object exists
                if (!block.parameters) {
                    block.parameters = {};
                }

                // Loop through the DEFINED parameters in the config
                for (const paramKey in blockType.parameters) {
                    // If the loaded block is MISSING a defined parameter, add it with its default value
                    if (block.parameters[paramKey] === undefined) {
                        block.parameters[paramKey] = blockType.parameters[paramKey].default;
                    }
                }
            });
            this.dynamicBlocks = levelData.dynamic_blocks;
        }

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
        if (!blockType || !blockType.parameters) return;

        // --- NEW: Special handling for buttons and their linking UI ---
        if (block.type === 'button') {
            this.startLinkingMode(block);
            return; // Exit here, don't show the generic modal
        }

        this.parameterEditor = this.add.group();

        const paramEntries = Object.entries(blockType.parameters);
        const boxWidth = 180;
        const boxHeight = 20 + paramEntries.reduce((acc, [, p]) => acc + (p.options.length * 30 + 15), 0);
        const startX = pointer.x + 10;
        const startY = pointer.y + 10;
        
        const bg = this.add.rectangle(startX, startY, boxWidth, boxHeight, 0x000000, 0.9).setOrigin(0).setStrokeStyle(1, blockType.color);
        this.parameterEditor.add(bg);

        let currentY = startY + 10;
        
        paramEntries.forEach(([paramKey, paramConfig]) => {
            if (!paramConfig.options) return; // Skip non-selectable params like button links

            const labelText = this.add.text(startX + 10, currentY, `${paramConfig.label}:`, { fontSize: '14px', fontStyle: 'italic', color: '#aaaaaa' });
            this.parameterEditor.add(labelText);
            currentY += 20;

            paramConfig.options.forEach(option => {
                const optionText = this.add.text(startX + 20, currentY, `> ${option}`, { fontSize: '16px' })
                    .setInteractive({ useHandCursor: true });
                
                if (block.parameters[paramKey] === option) {
                    optionText.setColor('#ffff00');
                }

                optionText.on('pointerdown', () => {
                    block.parameters[paramKey] = option;
                    this.updateGridVisual(block.position[0], block.position[1]);
                    this.closeParameterEditor();
                });

                this.parameterEditor.add(optionText);
                currentY += 30;
            });
            currentY += 5; // spacing between parameter groups
        });
    }

    // --- NEW: Functions to manage Button Linking mode ---
    
    startLinkingMode(buttonBlock) {
        this.closeParameterEditor();
        this.editorMode = 'LINKING';
        this.linkingButton = buttonBlock;
        this.finishLinkButton.setVisible(true);
        console.log(`Started linking for button at ${buttonBlock.position}`);
        this.drawLinksForButton(buttonBlock);
    }

    stopLinkingMode() {
        this.editorMode = 'NORMAL';
        this.linkingButton = null;
        this.finishLinkButton.setVisible(false);
        this.clearLinkVisuals();
        console.log('Stopped linking mode.');
    }

    handleLinkingClick(gridX, gridY) {
        if (!this.linkingButton) return;
        
        const buttonPos = this.linkingButton.position;
        if (gridX === buttonPos[0] && gridY === buttonPos[1]) {
            return; // Can't link a button to itself
        }
        
        const staticBlockId = this.gridData[gridY][gridX];
        const dynamicBlockOnTile = this.findDynamicBlocksAt(gridX, gridY).find(b => DYNAMIC_BLOCK_TYPES[b.type]?.isStateful);
        const staticBlockType = BLOCK_TYPES[staticBlockId];

        if (!dynamicBlockOnTile && !(staticBlockType && staticBlockType.isStateful)) {
            console.log("Cannot link: target is not a stateful block (door, arrow, etc).");
            return;
        }

        const links = this.linkingButton.parameters.linked_positions;
        const linkIndex = links.findIndex(pos => pos[0] === gridX && pos[1] === gridY);

        if (linkIndex > -1) {
            links.splice(linkIndex, 1);
        } else {
            links.push([gridX, gridY]);
        }
        
        this.drawLinksForButton(this.linkingButton);
    }
    
    clearLinkVisuals() {
        this.linkVisuals.forEach(v => v.destroy());
        this.linkVisuals = [];
    }

    drawLinksForButton(buttonBlock) {
        this.clearLinkVisuals();
        const startX = buttonBlock.position[0] * TILE_SIZE + TILE_SIZE / 2;
        const startY = buttonBlock.position[1] * TILE_SIZE + TILE_SIZE / 2;

        if (!buttonBlock.parameters.linked_positions) {
             buttonBlock.parameters.linked_positions = [];
        }

        buttonBlock.parameters.linked_positions.forEach(pos => {
            const endX = pos[0] * TILE_SIZE + TILE_SIZE / 2;
            const endY = pos[1] * TILE_SIZE + TILE_SIZE / 2;
            
            const line = this.add.line(0, 0, startX, startY, endX, endY, 0xffff00, 0.7).setOrigin(0).setLineWidth(2).setDepth(100);
            this.linkVisuals.push(line);
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