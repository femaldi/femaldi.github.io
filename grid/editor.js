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
        this.selectedBlockId = 'wall'; // Start with 'wall' selected
        this.paletteHighlight = null;
    }
    
    preload() {
        this.load.script('block-config', 'block-config.js');
    }

    create() {
        this.initializeGridData();
        this.drawGrid();
        this.drawPalette();
        this.setupInput();
    }

    // --- SETUP METHODS ---

    initializeGridData() {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            this.gridData[y] = [];
            this.gridObjects[y] = [];
            for (let x = 0; x < GRID_WIDTH; x++) {
                this.gridData[y][x] = null;
                this.gridObjects[y][x] = null;
            }
        }
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
                    '', { fontSize: '24px', fontFamily: 'Courier' }
                ).setOrigin(0.5);
                
                this.gridObjects[y][x] = blockChar;
            }
        }
    }
    
    drawPalette() {
        const paletteX = GRID_WIDTH * TILE_SIZE + 20;
        let paletteY = 20;

        this.paletteHighlight = this.add.rectangle(paletteX - 10, 0, PALETTE_WIDTH - 20, 40, 0x00ff00, 0.3).setOrigin(0);

        for (const key in BLOCK_TYPES) {
            const block = BLOCK_TYPES[key];
            const currentButtonY = paletteY; 

            const buttonRect = this.add.rectangle(paletteX - 10, currentButtonY - 5, PALETTE_WIDTH - 20, 40)
                .setStrokeStyle(1, 0x00ff00)
                .setOrigin(0)
                .setInteractive({ useHandCursor: true });

            const buttonText = this.add.text(paletteX, currentButtonY, `[${block.char || ' '}] ${block.name}`, { color: block.color, fontSize: '16px' });
            
            if (block.id === this.selectedBlockId) {
                this.paletteHighlight.y = currentButtonY - 5;
            }

            buttonRect.on('pointerdown', () => {
                this.selectedBlockId = block.id;
                this.paletteHighlight.y = currentButtonY - 5;
            });

            paletteY += 50;
        }

        // --- Save & Load Buttons ---
        const saveButtonY = this.game.config.height - 60;
        const loadButtonY = saveButtonY - 50; // Position Load button above Save

        // --- NEW: Load Button ---
        const loadButton = this.add.rectangle(paletteX - 10, loadButtonY - 5, PALETTE_WIDTH - 20, 40, 0x00ff00)
            .setOrigin(0)
            .setInteractive({ useHandCursor: true });
        
        this.add.text(paletteX + 35, loadButtonY + 5, 'LOAD LEVEL', { color: '#000000', fontSize: '16px' });
        loadButton.on('pointerdown', () => this.initiateLoad());
        
        // --- Save Button ---
        const saveButton = this.add.rectangle(paletteX - 10, saveButtonY - 5, PALETTE_WIDTH - 20, 40, 0x00ff00)
            .setOrigin(0)
            .setInteractive({ useHandCursor: true });
        
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

    // --- EDITOR LOGIC ---

    handleGridClick(pointer) {
        const gridX = Math.floor(pointer.x / TILE_SIZE);
        const gridY = Math.floor(pointer.y / TILE_SIZE);

        if (gridX >= 0 && gridX < GRID_WIDTH && gridY >= 0 && gridY < GRID_HEIGHT) {
            this.placeBlock(gridX, gridY);
        }
    }
    
    placeBlock(x, y) {
        this.gridData[y][x] = this.selectedBlockId;
        const blockObject = this.gridObjects[y][x];
        const blockType = Object.values(BLOCK_TYPES).find(b => b.id === this.selectedBlockId);
        
        if (blockType) {
            blockObject.setText(blockType.char);
            blockObject.setColor(blockType.color);
        }
    }

    saveLevelData() {
        const levelData = {
            width: GRID_WIDTH,
            height: GRID_HEIGHT,
            reset_timer: 32,
            buffer_size: 5,
            tiles: this.gridData
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
    
    // --- NEW: File Loading Methods ---

    /**
     * Creates a hidden file input element and clicks it to open the file dialog.
     */
    initiateLoad() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.style.display = 'none';

        fileInput.onchange = event => {
            const file = event.target.files[0];
            if (!file) {
                console.log("No file selected.");
                return;
            }
            this.processLoadedFile(file);
        };

        document.body.appendChild(fileInput);
        fileInput.click();
        document.body.removeChild(fileInput);
    }
    
    /**
     * Reads the selected file and calls the function to apply its data.
     * @param {File} file The file selected by the user.
     */
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
            alert("Incompatible level file. Make sure it's a 16x16 level created with this editor.");
            return;
        }

        console.log("Applying loaded level data...");
        this.gridData = levelData.tiles;

        // Update the visual grid based on the new data
        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                const blockId = this.gridData[y][x];
                const blockObject = this.gridObjects[y][x];
                
                if (blockId === null) {
                    blockObject.setText(''); // Clear the text for empty tiles
                } else {
                    const blockType = Object.values(BLOCK_TYPES).find(b => b.id === blockId);
                    if (blockType) {
                        blockObject.setText(blockType.char);
                        blockObject.setColor(blockType.color);
                    } else {
                        // Handle unknown block types gracefully
                        blockObject.setText('?'); 
                        blockObject.setColor('#ff0000');
                    }
                }
            }
        }
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