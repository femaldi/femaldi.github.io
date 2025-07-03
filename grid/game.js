// --- CONFIGURATION ---
// const TILE_SIZE = 32;
// const GRID_WIDTH = 24;
// const GRID_HEIGHT = 24;
const UI_WIDTH = 250;
const PLAYER_BUFFER_SIZE = 5;
const FONT_STYLE = {
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: '16px',
    color: '#00ff00',
    align: 'center'
};

// --- GAME SCENE ---
class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        // Player & Level
        this.player = null;
        this.playerGridPos = null;
        this.levelLayout = [];
        this.originalLevelLayout = [];
        this.dynamicBlockData = []; // --- NEW
        this.levelObjects = [];
        this.currentLevel = 1;
        this.networkNode = 'UNKNOWN';
        this.scanlineGroup = null;

        // --- NEW: Dynamic Objects ---
        this.sentinels = [];
        this.arrows = [];

        // Input & State
        this.cursors = null;
        this.gameState = 'MOVEMENT';

        // Execution & Buffer
        this.executionQueue = [];
        this.spentCommands = [];
        this.currentTargetingCommand = null;
        this.currentExecutingCommand = null;
        this.targetHighlights = [];
        this.bufferSize = PLAYER_BUFFER_SIZE;
        this.currentBufferUsed = 0;
        this.waitTicksRemaining = 0;

        // Reset Timer
        this.levelResetTimerDuration = -1;
        this.resetTimerTicksRemaining = -1;

        // UI
        this.ticks = 0;
        this.tickText = null;
        this.rainGroup = null;
        this.uiPanel = null;
        this.statusText = null;

        // Hover UI
        this.hoverHighlight = null;
        this.costTooltip = null;
    }

    init(data) {
        // If a startLevel is passed from the previous scene, use it.
        // Otherwise, it will use the default '1' from the constructor.
        if (data && data.startLevel) {
            this.currentLevel = data.startLevel;
        }
        console.log(`Initializing GameScene for level: ${this.currentLevel}`);
    }

    preload() {
        this.createBlockTextures();
        const levelKey = `level${this.currentLevel}`;
        this.load.json(levelKey, `levels/level${this.currentLevel}.json`);
        this.load.on('loaderror', (file) => {
            if (file.key === levelKey) this.handleNoMoreLevels();
        });
    }

    create() {
        this.ticks = 0;
        this.currentBufferUsed = 0;
        this.executionQueue = [];
        this.spentCommands = [];
        this.sentinels = []; // Clear sentinels on create
        this.arrows = [];
        this.waitTicksRemaining = 0;
        this.setGameState('MOVEMENT');
        const levelData = this.cache.json.get(`level${this.currentLevel}`);
        this.levelLayout = JSON.parse(JSON.stringify(levelData.tiles));
        this.originalLevelLayout = JSON.parse(JSON.stringify(levelData.tiles));
        this.dynamicBlockData = levelData.dynamic_blocks || []; // --- NEW
        this.networkNode = levelData.network_node || 'XX.XX.X'; // Fallback for older levels
        this.levelResetTimerDuration = levelData.reset_timer || -1;
        this.resetTimerTicksRemaining = -1;
        this.bufferSize = levelData.buffer_size || PLAYER_BUFFER_SIZE;
        this.drawGridLines();
        this.rebuildLevelVisuals();
        this.createPlayer();
        this.createDynamicBlocks(); // --- NEW
        this.createDigitalRain();
        this.setupInput();
        this.createUIPanel();
        this.hoverHighlight = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, 0xffffff, 0.2).setOrigin(0).setVisible(false).setDepth(20);
        this.costTooltip = this.add.text(0, 0, '', {
            fontFamily: 'Courier',
            fontSize: '14px',
            backgroundColor: '#000000',
            padding: {
                x: 4,
                y: 2
            }
        }).setDepth(30).setVisible(false);
        this.updateTickCounter();
        this.updateBufferUI();
        this.updateQueueUI();
        this.time.delayedCall(250, this.checkForUnlocks, [], this);
    }

    checkForUnlocks() {
        if (this.currentLevel <= 1) {
            return;
        }

        const newlyUnlocked = [];
        for (const key in COMMAND_TYPES) {
            const cmd = COMMAND_TYPES[key];
            if (cmd.level_enabled === this.currentLevel) {
                newlyUnlocked.push(cmd);
            }
        }

        if (newlyUnlocked.length > 0) {
            this.showUnlockModal(newlyUnlocked);
        }
    }

    showUnlockModal(unlockedCommands) {
        this.setGameState('PAUSED'); // Pause the game
        
        const container = document.getElementById('main-container');
        
        // Create Overlay
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        // Create Modal Box
        const modal = document.createElement('div');
        modal.className = 'unlock-modal';

        let listHtml = '<ul>';
        unlockedCommands.forEach(cmd => {
            listHtml += `
                <li>
                    <span class="cmd-name">${cmd.name}</span>
                    <span class="cmd-desc">${cmd.description}</span>
                    <span class="cmd-cost">Cost: ${cmd.cost}</span>
                </li>
            `;
        });
        listHtml += '</ul>';

        modal.innerHTML = `
            <h4>NEW COMMANDS AVAILABLE</h4>
            ${listHtml}
            <div id="unlock-ok-button" class="modal-button">[ OK ]</div>
        `;
        
        overlay.appendChild(modal);
        container.appendChild(overlay);

        // Add dismiss listener
        document.getElementById('unlock-ok-button').addEventListener('click', () => {
            container.removeChild(overlay);
            this.setGameState('MOVEMENT'); // Unpause the game
        }, { once: true }); // Use 'once' to auto-remove the listener after it fires
    }

    update() {
        this.updateDigitalRain();
    }
    
    createDynamicBlocks() {
        // Clear existing sprites before creating new ones
        this.sentinels.forEach(s => s.sprite.destroy());
        this.sentinels = [];
        this.arrows.forEach(a => a.sprite.destroy());
        this.arrows = [];

        this.dynamicBlockData.forEach(blockData => {
            if (blockData.type === 'sentinel') {
                this.createSentinel(blockData);
            } else if (blockData.type === 'arrow') {
                this.createArrow(blockData);
            }
        });
    }

    createSentinel(data) {
        const [x, y] = data.position;
        const sprite = this.add.image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, 'game-sprites', 'sentinel');
        sprite.setDisplaySize(TILE_SIZE * 0.9, TILE_SIZE * 0.9).setDepth(9);

        let velocity;
        if (data.parameters.direction === 'vertical') {
            sprite.setRotation(Phaser.Math.DegToRad(90));
            velocity = { dx: 0, dy: 1 };
        } else {
            velocity = { dx: 1, dy: 0 };
        }
        
        this.sentinels.push({
            sprite: sprite,
            gridPos: { x, y },
            velocity: velocity,
            initialData: data
        });
    }

    createArrow(data) {
        const [x, y] = data.position;
        const dir = data.parameters.direction;
        const sprite = this.add.image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, 'game-sprites', `arrow_${dir}`);
        sprite.setDisplaySize(TILE_SIZE, TILE_SIZE).setDepth(1);

        this.arrows.push({
            sprite: sprite,
            gridPos: { x, y },
            direction: dir, // Keep this for convenience in movePlayer logic
            initialData: data // This was the missing piece
        });
    }
    
    findArrowAt(x, y) {
        return this.arrows.find(a => a.gridPos.x === x && a.gridPos.y === y);
    }

    updateSentinels() {
        if (this.sentinels.length === 0) return;

        this.sentinels.forEach(sentinel => {
            let move = { ...sentinel.velocity }; // Start with normal velocity

            // --- NEW: Check for arrow influence ---
            const arrow = this.findArrowAt(sentinel.gridPos.x, sentinel.gridPos.y);
            if (arrow) {
                switch(arrow.direction) {
                    case 'up': move = { dx: 0, dy: -1 }; break;
                    case 'down': move = { dx: 0, dy: 1 }; break;
                    case 'left': move = { dx: -1, dy: 0 }; break;
                    case 'right': move = { dx: 1, dy: 0 }; break;
                }
                // Update sentinel's persistent velocity and visual rotation
                sentinel.velocity = { ...move };
                sentinel.sprite.setRotation(move.dx !== 0 ? 0 : Phaser.Math.DegToRad(90));
            }
            
            const nextX = sentinel.gridPos.x + move.dx;
            const nextY = sentinel.gridPos.y + move.dy;

            if (this.isCollidable(nextX, nextY)) {
                sentinel.velocity.dx *= -1;
                sentinel.velocity.dy *= -1;
            } else {
                sentinel.gridPos.x = nextX;
                sentinel.gridPos.y = nextY;
                this.tweens.add({
                    targets: sentinel.sprite,
                    x: sentinel.gridPos.x * TILE_SIZE + TILE_SIZE / 2,
                    y: sentinel.gridPos.y * TILE_SIZE + TILE_SIZE / 2,
                    duration: 150,
                    ease: 'Power2'
                });
            }
        });
    }

    playerCaught() {
        if (this.gameState === 'PAUSED' || this.gameState === 'FINISHED') return;
        this.setGameState('PAUSED');
        this.statusText.setText('> SECURITY ALERT. OPERATOR COMPROMISED.');
        this.cameras.main.flash(500, 255, 0, 0); // Flash red
        
        this.tweens.add({
            targets: this.player,
            scale: 0,
            angle: 360,
            duration: 400,
            onComplete: () => {
                // Flash red on death
                this.cameras.main.flash(500, 255, 0, 0); 
                this.time.delayedCall(500, () => this.resetLevel(true));
            }
        });
    }

    isCollidable(x, y) {
        if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) {
            return true; // Grid boundaries are collidable
        }
        const tileId = this.levelLayout[y][x];
        return tileId === 'wall' || tileId === 'door' || tileId === 'hard_wall';
    }
    
    // --- End of New Sentinel Logic ---

    setGameState(newState) {
        console.log(`State change: ${this.gameState} -> ${newState}`);
        this.gameState = newState;

        const gameCanvas = this.sys.game.canvas;
        if (newState === 'TARGETING') {
            gameCanvas.classList.add('targeting-cursor');
        } else {
            // Remove the class for any other state
            gameCanvas.classList.remove('targeting-cursor');
        }

        const undoButton = document.getElementById('undo-button');
        if (undoButton) {
            if (this.gameState === 'MOVEMENT' && this.executionQueue.length > 0) {
                undoButton.classList.remove('disabled');
            } else {
                undoButton.classList.add('disabled');
            }
        }
    }

    setupInput() {
        const escapeKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
        escapeKey.on('down', () => {
            if (this.gameState === 'TARGETING') {
                this.endTargeting();
            }
        });

        this.cursors = this.input.keyboard.createCursorKeys();
        const spacebar = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        spacebar.on('down', () => {
            if (this.gameState === 'MOVEMENT' || this.gameState === 'EXECUTING') {
                this.movePlayer(0, 0);
            }
        });

        this.input.keyboard.on('keydown', event => {
            let dx = 0;
            let dy = 0;
            if (event.code === 'ArrowUp') dy = -1;
            else if (event.code === 'ArrowDown') dy = 1;
            else if (event.code === 'ArrowLeft') dx = -1;
            else if (event.code === 'ArrowRight') dx = 1;
            else return;

            if (this.gameState === 'MOVEMENT' || this.gameState === 'EXECUTING') {
                this.movePlayer(dx, dy);
            }
        });

        this.input.on('pointerdown', (pointer) => {
            if (this.gameState !== 'TARGETING' || pointer.x >= GRID_WIDTH * TILE_SIZE) return;
            this.handleTargetingClick(pointer);
        });

        this.input.on('pointermove', (pointer) => {
            if (this.gameState === 'TARGETING') {
                this.handleTargetingHover(pointer);
            } else {
                this.hoverHighlight.setVisible(false);
                this.costTooltip.setVisible(false);
            }
        });
    }

    findTopBlockAt(x, y) {
        let topBlock = null;
        let topPriority = -1;

        // Check dynamic blocks first
        const dynamicBlocksOnTile = [...this.arrows, ...this.sentinels].filter(b => b.gridPos.x === x && b.gridPos.y === y);
        
        dynamicBlocksOnTile.forEach(block => {
            const blockType = DYNAMIC_BLOCK_TYPES[block.initialData.type];
            if (blockType && blockType.renderPriority > topPriority) {
                topPriority = blockType.renderPriority;
                topBlock = {
                    id: block.initialData.type,
                    kind: 'dynamic',
                    object: block // Reference to the live object
                };
            }
        });

        // Check static block if no dynamic block has higher priority
        const staticId = this.levelLayout[y] ? this.levelLayout[y][x] : null;
        if (staticId) {
            const staticType = BLOCK_TYPES[staticId];
            if (staticType && staticType.renderPriority > topPriority) {
                topPriority = staticType.renderPriority;
                topBlock = {
                    id: staticId,
                    kind: 'static',
                    object: this.levelObjects[y][x] // Reference to the sprite
                };
            }
        }
        
        return topBlock;
    }

    // --- NEW: Game-side helper to clear a tile before copying ---
    clearTileForCopy(x, y) {
        // Clear static block
        if (this.levelObjects[y] && this.levelObjects[y][x]) {
            this.levelObjects[y][x].destroy();
            this.levelObjects[y][x] = null;
        }
        this.levelLayout[y][x] = null;
        
        // Clear all dynamic blocks
        const allDynamic = [...this.arrows, ...this.sentinels];
        allDynamic.forEach(block => {
            if (block.gridPos.x === x && block.gridPos.y === y) {
                block.sprite.destroy();
            }
        });
        this.arrows = this.arrows.filter(a => a.gridPos.x !== x || a.gridPos.y !== y);
        this.sentinels = this.sentinels.filter(s => s.gridPos.x !== x || s.gridPos.y !== y);
    }

    calculateFinalCost(commandType, targetGridX, targetGridY) {
        const topBlock = this.findTopBlockAt(targetGridX, targetGridY);
        let multiplier = BLOCK_TYPES.erase.command_multiplier; // Default for empty tile

        if (topBlock) {
            if (topBlock.kind === 'dynamic') {
                multiplier = DYNAMIC_BLOCK_TYPES[topBlock.id].command_multiplier;
            } else { // static
                multiplier = BLOCK_TYPES[topBlock.id].command_multiplier;
            }
        }
        return commandType.cost * multiplier;
    }

    handleTargetingHover(pointer) {
        const gridX = Math.floor(pointer.x / TILE_SIZE);
        const gridY = Math.floor(pointer.y / TILE_SIZE);
        if (gridX < 0 || gridX >= GRID_WIDTH || gridY < 0 || gridY >= GRID_HEIGHT) {
            this.hoverHighlight.setVisible(false);
            this.costTooltip.setVisible(false);
            return;
        }
        this.hoverHighlight.setPosition(gridX * TILE_SIZE, gridY * TILE_SIZE).setVisible(true);
        const commandType = COMMAND_TYPES[this.currentTargetingCommand.id];
        const costOfThisClick = this.calculateFinalCost(commandType, gridX, gridY);
        const remainingBuffer = this.bufferSize - this.currentBufferUsed;
        const alreadyAccumulatedCost = this.currentTargetingCommand.finalCost;
        const canAfford = (alreadyAccumulatedCost + costOfThisClick) <= remainingBuffer;
        this.costTooltip.setText(`Cost: ${costOfThisClick}`);
        this.costTooltip.setPosition(pointer.x + 15, pointer.y + 15).setVisible(true);
        this.costTooltip.setColor(canAfford ? '#00ff00' : '#ff0000');
    }

    startTargeting(commandType) {
        if (this.gameState !== 'MOVEMENT') return;

        // --- NEW: Check if the command has options ---
        if (commandType.options && commandType.options.length > 0) {
            this.showWaitModal(commandType);
            return;
        }

        // --- MODIFIED: Handle no-target commands without options ---
        if (commandType.targetCount === 0) {
            if (commandType.cost > (this.bufferSize - this.currentBufferUsed)) {
                 this.statusText.setText(`> INSUFFICIENT BUFFER (Cost: ${commandType.cost})`);
                 this.time.delayedCall(2000, () => {
                    if (this.gameState === 'MOVEMENT') this.statusText.setText('> Awaiting input...');
                 });
                 return;
            }
            // This part is now less likely to be used but good to keep for future simple commands
            const newCommand = {
                id: commandType.id,
                name: commandType.name,
                shortName: commandType.shortName,
                targets: [],
                finalCost: commandType.cost,
                system_reset: commandType.system_reset,
                wait_duration: commandType.wait_duration || 0
            };
            this.executionQueue.push(newCommand);
            this.currentBufferUsed += newCommand.finalCost;
            this.updateQueueUI();
            this.updateBufferUI();
            this.statusText.setText(`> ${commandType.name} added to queue.`);
            return;
        }
        
        // --- Original targeting logic for other commands ---
        const minPossibleCost = commandType.cost;
        if (minPossibleCost > (this.bufferSize - this.currentBufferUsed)) {
            this.statusText.setText(`> INSUFFICIENT BUFFER (Min Cost: ${minPossibleCost})`);
            this.time.delayedCall(2000, () => {
                if (this.gameState === 'MOVEMENT') this.statusText.setText('> Awaiting input...');
            });
            return;
        }
        this.setGameState('TARGETING');
        this.currentTargetingCommand = {
            id: commandType.id,
            name: commandType.name,
            shortName: commandType.shortName,
            targetCount: commandType.targetCount,
            targets: [],
            finalCost: 0,
            system_reset: commandType.system_reset
            // wait_duration is no longer needed here as it's handled by the modal
        };
        this.statusText.setText(`> TARGETING: ${commandType.description}`);
    }

    // --- NEW: Modal for selecting WAIT duration ---
    showWaitModal(commandType) {
        this.setGameState('PAUSED'); // Pause the game while player chooses

        const container = document.getElementById('main-container');
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        const modal = document.createElement('div');
        modal.className = 'unlock-modal'; // We can reuse the same modal style

        let optionsHtml = '<ul>';
        commandType.options.forEach(opt => {
            const canAfford = (this.currentBufferUsed + opt.cost) <= this.bufferSize;
            const disabledClass = canAfford ? '' : 'disabled';
            const costColor = canAfford ? '#fff' : '#ff5555';
            optionsHtml += `
                <li class="wait-option ${disabledClass}" data-duration="${opt.duration}" data-cost="${opt.cost}">
                    <span class="cmd-name">WAIT for ${opt.duration} ticks</span>
                    <span class="cmd-cost" style="color: ${costColor}">Cost: ${opt.cost}</span>
                </li>
            `;
        });
        optionsHtml += '</ul>';

        modal.innerHTML = `
            <h4>SELECT WAIT DURATION</h4>
            ${optionsHtml}
            <div id="wait-cancel-button" class="modal-button">[ CANCEL ]</div>
        `;

        overlay.appendChild(modal);
        container.appendChild(overlay);

        const dismiss = () => {
            container.removeChild(overlay);
            this.setGameState('MOVEMENT');
        };

        // Add listeners for each option
        modal.querySelectorAll('.wait-option').forEach(optionElement => {
            optionElement.addEventListener('click', () => {
                const canAfford = !optionElement.classList.contains('disabled');
                if (!canAfford) return; // Do nothing if they can't afford it

                const duration = parseInt(optionElement.dataset.duration, 10);
                const cost = parseInt(optionElement.dataset.cost, 10);
                
                // Construct and add the command
                const newCommand = {
                    id: commandType.id,
                    name: `${commandType.name} (${duration})`,
                    shortName: `${commandType.shortName}${duration}`,
                    targets: [],
                    finalCost: cost,
                    system_reset: commandType.system_reset,
                    wait_duration: duration
                };

                this.executionQueue.push(newCommand);
                this.currentBufferUsed += newCommand.finalCost;
                this.updateQueueUI();
                this.updateBufferUI();
                this.statusText.setText(`> ${newCommand.name} added to queue.`);
                
                dismiss();
            });
        });

        // Add cancel button listener
        document.getElementById('wait-cancel-button').addEventListener('click', dismiss);
    }

    // --- MODIFIED: The validation logic is now more nuanced ---
    validateCommandTargets(command) {
        let targetsToValidate = command.targets;

        // For COPY, we only validate the destination, which is the last target.
        if (command.id === 'copy' && command.targets.length > 1) {
            targetsToValidate = [command.targets[command.targets.length - 1]];
        }

        for (const target of targetsToValidate) {
            const originalBlockType = DYNAMIC_BLOCK_TYPES[target.originalId] || BLOCK_TYPES[target.originalId];
            const currentTopBlock = this.findTopBlockAt(target.x, target.y);
            const currentBlockType = currentTopBlock ? (DYNAMIC_BLOCK_TYPES[currentTopBlock.id] || BLOCK_TYPES[currentTopBlock.id]) : null;
            const currentId = currentTopBlock ? currentTopBlock.id : null;

            const needsStrictValidation = (originalBlockType && originalBlockType.isMobile) || (currentBlockType && currentBlockType.isMobile);

            if (needsStrictValidation) {
                if (currentId !== target.originalId) {
                    console.log(`STRICT validation failed for ${command.name} DESTINATION. Mobile entity involved.`);
                    return false;
                }
            }
        }
        return true;
    }

    handleTargetingClick(pointer) {
        const gridX = Math.floor(pointer.x / TILE_SIZE);
        const gridY = Math.floor(pointer.y / TILE_SIZE);
        const commandType = COMMAND_TYPES[this.currentTargetingCommand.id];
        const costOfThisClick = this.calculateFinalCost(commandType, gridX, gridY);
        const remainingBuffer = this.bufferSize - this.currentBufferUsed;
        const alreadyAccumulatedCost = this.currentTargetingCommand.finalCost;
        if ((alreadyAccumulatedCost + costOfThisClick) > remainingBuffer) {
            this.statusText.setText(`> CANNOT AFFORD TARGET (Total Cost: ${alreadyAccumulatedCost + costOfThisClick})`);
            this.costTooltip.setVisible(false);
            this.time.delayedCall(2000, () => this.statusText.setText(`> TARGETING: ${commandType.description}`));
            return;
        }
        
        // --- NEW: Store what was on the tile at targeting time ---
        const topBlock = this.findTopBlockAt(gridX, gridY);
        const originalTargetId = topBlock ? topBlock.id : null; // null for empty space

        // --- NEW: Snapshot the source object if this is a COPY command's first target ---
        let sourceSnapshot = null;
        if (commandType.id === 'copy' && this.currentTargetingCommand.targets.length === 0) {
            if (topBlock && topBlock.kind === 'dynamic') {
                // For dynamic blocks, we need a deep copy of their initial data
                sourceSnapshot = {
                    kind: 'dynamic',
                    initialData: JSON.parse(JSON.stringify(topBlock.object.initialData))
                };
            } else {
                // For static blocks, we just need the ID
                sourceSnapshot = {
                    kind: 'static',
                    id: originalTargetId
                };
            }
            // Store this snapshot on the command object itself
            this.currentTargetingCommand.sourceSnapshot = sourceSnapshot;
        }

        this.currentTargetingCommand.targets.push({
            x: gridX,
            y: gridY,
            originalId: originalTargetId // Store the original ID
        });

        this.currentTargetingCommand.finalCost += costOfThisClick;
        const highlight = this.add.rectangle(gridX * TILE_SIZE, gridY * TILE_SIZE, TILE_SIZE, TILE_SIZE).setStrokeStyle(3, 0xff00ff).setOrigin(0);
        this.targetHighlights.push(highlight);
        if (this.currentTargetingCommand.targets.length >= this.currentTargetingCommand.targetCount) {
            this.addCommandToQueue();
        }
    }

    addCommandToQueue() {
        this.executionQueue.push(this.currentTargetingCommand);
        this.currentBufferUsed += this.currentTargetingCommand.finalCost;
        this.updateQueueUI();
        this.updateBufferUI();
        this.endTargeting();
    }

    endTargeting() {
        this.currentTargetingCommand = null;
        this.targetHighlights.forEach(h => h.destroy());
        this.targetHighlights = [];
        this.hoverHighlight.setVisible(false);
        this.costTooltip.setVisible(false);
        this.statusText.setText('> Awaiting input...');
        this.setGameState('MOVEMENT');
    }

    undoLastCommand() {
        if (this.gameState !== 'MOVEMENT' || this.executionQueue.length === 0) {
            return;
        }
        const removedCommand = this.executionQueue.pop();
        if (removedCommand) {
            this.currentBufferUsed -= removedCommand.finalCost;
            if (this.currentBufferUsed < 0) this.currentBufferUsed = 0;
            this.updateQueueUI();
            this.updateBufferUI();
            this.setGameState(this.gameState);
            this.statusText.setText('> Last command removed from queue.');
        }
    }

    initiateExecutionMode() {
        if (this.executionQueue.length === 0) {
            this.statusText.setText('> Queue is empty. Nothing to execute.');
            this.time.delayedCall(1500, () => this.statusText.setText('> Awaiting input...'));
            return;
        }
        this.setGameState('EXECUTING');
        this.statusText.setText(`> EXECUTION MODE. Move to process queue (${this.executionQueue.length} left).`);
    }

    updateFutureCommandSnapshots(x, y) {
        // Find the new state of the tile that was just changed.
        const newTopBlock = this.findTopBlockAt(x, y);

        this.executionQueue.forEach(futureCmd => {
            // We only care about future COPY commands whose source is the modified tile.
            if (futureCmd.id === 'copy' && futureCmd.targets[0].x === x && futureCmd.targets[0].y === y) {
                console.log(`Updating future COPY command's source snapshot for tile (${x},${y}).`);

                let newSnapshot = null;
                if (newTopBlock) {
                    if (newTopBlock.kind === 'dynamic') {
                        newSnapshot = {
                            kind: 'dynamic',
                            initialData: JSON.parse(JSON.stringify(newTopBlock.object.initialData))
                        };
                    } else { // static
                        newSnapshot = {
                            kind: 'static',
                            id: newTopBlock.id
                        };
                    }
                } // If newTopBlock is null, the snapshot will correctly be null (for an empty tile).

                futureCmd.sourceSnapshot = newSnapshot;
            }
        });
    }

    processNextCommandInQueue() {
        if (this.executionQueue.length === 0) return;
        this.currentExecutingCommand = this.executionQueue.shift();
        const command = this.currentExecutingCommand;
        
        if (!this.validateCommandTargets(command)) {
            const lastTarget = command.targets[command.targets.length - 1];
            if (lastTarget) {
                this.showExecutionEffect(lastTarget.x, lastTarget.y, false);
            }
            this.statusText.setText(`> CMD ${command.name} FAILED: Target state changed.`);
            
            this.spentCommands.push(this.currentExecutingCommand);
            this.currentExecutingCommand = null;
            this.updateQueueUI();
            this.updateBufferUI();
            
            if (this.executionQueue.length === 0 && this.waitTicksRemaining <= 0) {
                 this.setGameState('MOVEMENT');
                 this.statusText.setText('> Execution complete. Awaiting input.');
            }
            return;
        }
        
        let success = false;
        switch (command.id) {
            case 'delete':
                success = this.executeDelete(command);
                break;
            case 'copy':
                success = this.executeCopy(command);
                break;
            case 'wait':
                this.waitTicksRemaining = command.wait_duration - 1;
                this.statusText.setText(`> WAITING... ${command.wait_duration} ticks remaining.`);
                success = true;
                break;
        }

        if (command.targets.length > 0) {
            const targetPos = command.targets[command.targets.length - 1];
            this.showExecutionEffect(targetPos.x, targetPos.y, success);
        }

        // --- NEW LOGIC: Update future commands if this one succeeded ---
        if (success) {
            let modifiedTile;
            if (command.id === 'copy') {
                modifiedTile = command.targets[1]; // The destination tile was modified.
            } else if (command.id === 'delete') {
                modifiedTile = command.targets[0]; // The target tile was modified (emptied).
            }

            if (modifiedTile) {
                this.updateFutureCommandSnapshots(modifiedTile.x, modifiedTile.y);
            }
        }

        if (command.system_reset && this.levelResetTimerDuration > 0 && this.resetTimerTicksRemaining <= 0) {
            this.resetTimerTicksRemaining = this.levelResetTimerDuration;
            this.statusText.setText(`> SYSTEM INSTABILITY. RESET IN ${this.resetTimerTicksRemaining} TICKS.`);
        }

        this.spentCommands.push(this.currentExecutingCommand);
        this.currentExecutingCommand = null;
        this.updateQueueUI();
        this.updateBufferUI();
        
        if (this.executionQueue.length === 0 && this.waitTicksRemaining <= 0) {
            this.setGameState('MOVEMENT');
            this.statusText.setText('> Execution complete. Awaiting input.');
        } else if (this.resetTimerTicksRemaining <= 0 && this.waitTicksRemaining <= 0) {
             this.statusText.setText(`> EXECUTION MODE. Move to process queue (${this.executionQueue.length} left).`);
        }
    }

    executeDelete(command) {
        const target = command.targets[0];
        const { x, y } = target;

        if (this.playerGridPos.x === x && this.playerGridPos.y === y) return false;

        const topBlock = this.findTopBlockAt(x, y);
        if (!topBlock) return false; // Nothing to delete

        if (topBlock.kind === 'dynamic') {
            topBlock.object.sprite.destroy();
            // Remove from the correct live array
            if (topBlock.id === 'arrow') {
                this.arrows = this.arrows.filter(a => a !== topBlock.object);
            } else if (topBlock.id === 'sentinel') {
                this.sentinels = this.sentinels.filter(s => s !== topBlock.object);
            }
        } else { // static
            if (topBlock.object) {
                topBlock.object.destroy();
            }
            this.levelObjects[y][x] = null;
            this.levelLayout[y][x] = null;
        }
        return true;
    }

    executeCopy(command) {
        const targetPos = command.targets[1];

        if (this.playerGridPos.x === targetPos.x && this.playerGridPos.y === targetPos.y) return false;

        // Use the snapshot taken at the time of targeting.
        const sourceSnapshot = command.sourceSnapshot;

        // Clear the destination tile completely before copying.
        this.clearTileForCopy(targetPos.x, targetPos.y);

        if (!sourceSnapshot || !sourceSnapshot.kind) { // Source was an empty tile
            return true; // The clear was successful, we're done.
        }

        if (sourceSnapshot.kind === 'dynamic') {
            const newBlockData = sourceSnapshot.initialData;
            newBlockData.position = [targetPos.x, targetPos.y];
            
            if (newBlockData.type === 'arrow') this.createArrow(newBlockData);
            else if (newBlockData.type === 'sentinel') this.createSentinel(newBlockData);
        } else { // static
            const sourceId = sourceSnapshot.id;
            this.levelLayout[targetPos.y][targetPos.x] = sourceId;
            const tx = targetPos.x * TILE_SIZE + TILE_SIZE / 2;
            const ty = targetPos.y * TILE_SIZE + TILE_SIZE / 2;
            const newSprite = this.add.image(tx, ty, 'game-sprites', sourceId);
            newSprite.setDisplaySize(TILE_SIZE, TILE_SIZE);
            if (!this.levelObjects[targetPos.y]) this.levelObjects[targetPos.y] = [];
            this.levelObjects[targetPos.y][targetPos.x] = newSprite;
        }

        return true;
    }

    movePlayer(dx, dy) {
        // 1. Check for arrow influence first. This is the highest priority.
        let final_dx = dx;
        let final_dy = dy;
        const arrow = this.findArrowAt(this.playerGridPos.x, this.playerGridPos.y);

        if (arrow) {
            // Arrow is present, so we override any player input.
            switch(arrow.direction) {
                case 'up':    { final_dx = 0;  final_dy = -1; break; }
                case 'down':  { final_dx = 0;  final_dy =  1; break; }
                case 'left':  { final_dx = -1; final_dy =  0; break; }
                case 'right': { final_dx = 1;  final_dy =  0; break; }
            }
        }

        // 2. Capture the state of all moving entities BEFORE they move.
        const playerOldPos = { x: this.playerGridPos.x, y: this.playerGridPos.y };
        const sentinelsOldPos = this.sentinels.map(s => ({ x: s.gridPos.x, y: s.gridPos.y }));
        
        // 3. Animate the player's "thinking" trail.
        const trail = this.add.image(playerOldPos.x * TILE_SIZE + TILE_SIZE / 2, playerOldPos.y * TILE_SIZE + TILE_SIZE / 2, 'game-sprites', 'trail');
        trail.setDisplaySize(TILE_SIZE * 0.75, TILE_SIZE * 0.75).setDepth(this.player.depth - 1);
        this.tweens.add({ targets: trail, alpha: 0, scale: 0, duration: 500, onComplete: () => trail.destroy() });

        // 4. Update the player's grid position if it's a valid move.
        const targetX = this.playerGridPos.x + final_dx;
        const targetY = this.playerGridPos.y + final_dy;

        if (final_dx !== 0 || final_dy !== 0) { 
            if (this.isCollidable(targetX, targetY)) return;
            this.playerGridPos.x = targetX;
            this.playerGridPos.y = targetY;
        }

        // 5. Update the sentinels' positions.
        this.updateSentinels();

        // 6. Perform the comprehensive collision check.
        let collisionDetected = false;
        for (let i = 0; i < this.sentinels.length; i++) {
            const sentinel = this.sentinels[i];
            const sentinelOldPos = sentinelsOldPos[i];
            
            // Condition 1: Head-on collision
            if (this.playerGridPos.x === sentinel.gridPos.x && this.playerGridPos.y === sentinel.gridPos.y) {
                collisionDetected = true;
                break;
            }

            // --- THIS IS THE FIX ---
            // Condition 2: Cross-over collision (with corrected variable name)
            if (this.playerGridPos.x === sentinelOldPos.x && this.playerGridPos.y === sentinelOldPos.y &&
                playerOldPos.x === sentinel.gridPos.x && playerOldPos.y === sentinel.gridPos.y) {
                collisionDetected = true;
                break;
            }
        }
        
        // 7. Animate player movement.
        this.tweens.add({
            targets: this.player,
            x: this.playerGridPos.x * TILE_SIZE + TILE_SIZE / 2,
            y: this.playerGridPos.y * TILE_SIZE + TILE_SIZE / 2,
            duration: 150,
            ease: 'Power2'
        });

        // 8. Handle the outcome.
        if (collisionDetected) {
            this.playerCaught();
            return;
        }

        // 9. Proceed with the rest of the tick's logic.
        this.ticks++;
        this.updateTickCounter();

        const currentTileId = this.levelLayout[this.playerGridPos.y][this.playerGridPos.x];
        if (currentTileId === 'data') {
            this.levelComplete();
            return;
        }

        if (this.resetTimerTicksRemaining > 0) {
            this.resetTimerTicksRemaining--;
            if (this.resetTimerTicksRemaining === 0) {
                this.resetLevel(false); 
                return;
            } else {
                this.statusText.setText(`> SYSTEM INSTABILITY. RESET IN ${this.resetTimerTicksRemaining} TICKS.`);
            }
        }
        
        if (this.gameState === 'EXECUTING') {
            if (this.waitTicksRemaining > 0) {
                this.waitTicksRemaining--;
                this.statusText.setText(`> WAITING... ${this.waitTicksRemaining + 1} ticks remaining.`);
            } else {
                this.processNextCommandInQueue();
            }
        }
        
        if (currentTileId === 'execution_point' && this.gameState === 'MOVEMENT') {
            this.initiateExecutionMode();
        }
    }

// This is the complete function to be placed inside the GameScene class in game.js

    resetLevel(fullReset = false) {
        if (fullReset) {
            this.statusText.setText('> SECURITY ALERT. OPERATOR COMPROMISED. SYSTEM RESTARTING...');
            this.setGameState('PAUSED');
        } else {
             this.statusText.setText('> KERNEL PANIC. SYSTEM RESETTING...');
             this.setGameState('PAUSED');
        }

        const afterFadeOut = () => {
            // --- Unconditional Resets ---
            this.levelLayout = JSON.parse(JSON.stringify(this.originalLevelLayout));
            this.resetTimerTicksRemaining = -1;
            this.waitTicksRemaining = 0;

            // Reset all dynamic objects
            this.sentinels.forEach(s => s.sprite.destroy());
            this.sentinels = [];
            this.arrows.forEach(a => a.sprite.destroy());
            this.arrows = [];
            this.createDynamicBlocks();

            // Rebuild static tile visuals
            this.rebuildLevelVisuals();
            
            // --- Conditional Logic based on reset type ---
            if (fullReset) {
                // For a hard reset, clear commands and reset the player to the start.
                this.executionQueue = [];
                this.currentExecutingCommand = null;
                this.currentBufferUsed = 0;
                this.spentCommands = [];

                let startPos = this.findPlayerStart();
                this.playerGridPos.x = startPos.x;
                this.playerGridPos.y = startPos.y;
                this.player.setPosition(this.playerGridPos.x * TILE_SIZE + TILE_SIZE / 2, this.playerGridPos.y * TILE_SIZE + TILE_SIZE / 2);
                this.player.setAngle(0); 
                this.player.setDisplaySize(TILE_SIZE * 0.8, TILE_SIZE * 0.8);

            } else {
                // For a soft reset, check the validity of the player's preserved position.
                const playerTile = this.levelLayout[this.playerGridPos.y][this.playerGridPos.x];
                if (playerTile === 'data') {
                    console.log("Player landed on Data node after soft reset. Player wins.");
                    this.statusText.setText('> UNEXPECTED DATA ACQUISITION. CONNECTION TERMINATING...');
                    this.levelComplete();
                    return; 
                }

                let isPlayerInInvalidSpot = false;
                if (this.isCollidable(this.playerGridPos.x, this.playerGridPos.y)) {
                    isPlayerInInvalidSpot = true;
                } else {
                    for (const sentinel of this.sentinels) {
                        if (sentinel.gridPos.x === this.playerGridPos.x && sentinel.gridPos.y === this.playerGridPos.y) {
                            isPlayerInInvalidSpot = true;
                            break;
                        }
                    }
                }

                if (isPlayerInInvalidSpot) {
                    console.log("Player stranded in invalid position after soft reset. Triggering hard reset.");
                    this.statusText.setText('> FATAL ERROR: Operator crushed during system reconstitution.');
                    this.playerCaught();
                    return;
                }
            }

            // Update UI in both cases
            this.updateQueueUI();
            this.updateBufferUI();

            // Fade the camera back in over the new, slower duration.
            // Note: We use an arrow function here, which automatically preserves 'this', so no context argument is needed.
            this.cameras.main.fadeIn(1000, 0, 0, 0, (camera, progress) => {
                if (progress === 1) {
                    this.clearScanlineWipe();
                    this.statusText.setText('> Awaiting input...');
                    this.setGameState('MOVEMENT');
                }
            });
        };

        // --- Trigger the correct visual effect ---
        if (fullReset) {
            this.time.delayedCall(100, afterFadeOut, [], this);
        } else {
            this.triggerScanlineWipe();
            this.cameras.main.once('camerafadeoutcomplete', () => {
                afterFadeOut();
            });
            this.cameras.main.fadeOut(1000);
        }
    }

    rebuildLevelVisuals() {
        if (this.levelObjects) {
            for (let y = 0; y < this.levelObjects.length; y++) {
                if (this.levelObjects[y]) {
                    for (let x = 0; x < this.levelObjects[y].length; x++) {
                        if (this.levelObjects[y][x]) {
                            this.levelObjects[y][x].destroy();
                        }
                    }
                }
            }
        }
        this.levelObjects = [];
        this.buildLevelFromLayout();
    }

    buildLevelFromLayout() {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            this.levelObjects[y] = [];
            for (let x = 0; x < GRID_WIDTH; x++) {
                const blockId = this.levelLayout[y][x];
                if (blockId && blockId !== 'player') {
                    const tx = x * TILE_SIZE + TILE_SIZE / 2;
                    const ty = y * TILE_SIZE + TILE_SIZE / 2;
                    const blockSprite = this.add.image(tx, ty, 'game-sprites', blockId);
                    blockSprite.setDisplaySize(TILE_SIZE, TILE_SIZE);
                    this.levelObjects[y][x] = blockSprite;
                } else {
                    this.levelObjects[y][x] = null;
                }
            }
        }
    }

    createUIPanel() {
        this.uiPanel = document.getElementById('ui-panel');
        let html = `<h3>INDEX</h3><div class="ui-section"><a href="#" id="reset-button">[RESTART LEVEL]</a></div>`;
        html += `<div class="ui-section"><a id="tutorial-button" target="_blank" href="tutorial.html">[OPERATOR MANUAL]</a></div>`;
        html += `<h3>COMMANDS</h3><div id="command-list" class="ui-section">`;
        
        for (const key in COMMAND_TYPES) {
            const cmd = COMMAND_TYPES[key];
            if (cmd.level_enabled <= this.currentLevel) {
                // --- MODIFIED: Display base cost, or a range if there are options ---
                let costText = `Cost: ${cmd.cost}`;
                if (cmd.options) {
                    const costs = cmd.options.map(o => o.cost);
                    costText = `Cost: ${Math.min(...costs)}-${Math.max(...costs)}`;
                }
                html += `<a href="#" class="command-button" data-command-id="${cmd.id}">[${cmd.name}] (${costText})</a>`;
            }
        }

        html += `</div><h3>BUFFER</h3><div id="buffer-display" class="ui-section"><span id="buffer-text"></span><div id="buffer-bar"></div></div>`;
        html += `<div class="queue-header"><h3>EXECUTION QUEUE</h3><a href="#" id="undo-button" class="disabled">[UNDO]</a></div><div id="queue-list" class="ui-section">...</div>`;
        html += `<h3>STATUS</h3><div id="status-display" class="ui-section">> Awaiting input...</div>`;
        this.uiPanel.innerHTML = html;

        // Add robust event listeners
        document.querySelectorAll('.command-button').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                
                // If we are currently targeting something, cancel it first.
                if (this.gameState === 'TARGETING') {
                    this.endTargeting();
                }
                
                // Now, if we are in MOVEMENT mode, we can start a new command.
                if (this.gameState === 'MOVEMENT') {
                    const cmdId = e.target.getAttribute('data-command-id');
                    this.startTargeting(COMMAND_TYPES[cmdId]);
                }
            });
        });

        document.getElementById('undo-button').addEventListener('click', (e) => {
            e.preventDefault();
            this.undoLastCommand();
        });
        document.getElementById('reset-button').addEventListener('click', (e) => {
            e.preventDefault();
            this.resetLevel(true);
        });
        const statusDiv = document.getElementById('status-display');
        this.statusText = {
            setText: (text) => {
                statusDiv.innerHTML = text;
            }
        };
    }

    updateBufferUI() {
        const bufferDisplayText = document.getElementById('buffer-text');
        const bufferBar = document.getElementById('buffer-bar');
        if (!bufferDisplayText || !bufferBar) return;
        bufferDisplayText.innerText = `${this.currentBufferUsed} / ${this.bufferSize}`;
        bufferBar.innerHTML = '';

        let totalCostInBar = 0;

        this.spentCommands.forEach(command => {
            const slot = document.createElement('div');
            slot.className = 'buffer-slot spent';
            slot.style.flex = command.finalCost;
            slot.innerText = command.shortName;
            bufferBar.appendChild(slot);
            totalCostInBar += command.finalCost;
        });

        if (this.currentExecutingCommand) {
            const slot = document.createElement('div');
            slot.className = 'buffer-slot executing';
            slot.style.flex = this.currentExecutingCommand.finalCost;
            slot.innerText = this.currentExecutingCommand.shortName;
            bufferBar.appendChild(slot);
            totalCostInBar += this.currentExecutingCommand.finalCost;
        }

        this.executionQueue.forEach(commandInQueue => {
            const slot = document.createElement('div');
            slot.className = 'buffer-slot filled';
            slot.style.flex = commandInQueue.finalCost;
            slot.innerText = commandInQueue.shortName;
            bufferBar.appendChild(slot);
            totalCostInBar += commandInQueue.finalCost;
        });

        const remainingSpace = this.bufferSize - totalCostInBar;
        if (remainingSpace > 0) {
            const emptySlot = document.createElement('div');
            emptySlot.className = 'buffer-slot';
            emptySlot.style.flex = remainingSpace;
            emptySlot.innerHTML = 'X';
            bufferBar.appendChild(emptySlot);
        }
    }

    updateQueueUI() {
        const queueList = document.getElementById('queue-list');
        let html = '';
        if (this.currentExecutingCommand) {
            let targetStr = this.currentExecutingCommand.targets.map(t => `[${t.x},${t.y}]`).join('->');
            html += `<div style="color: #008800;">EXEC: ${this.currentExecutingCommand.name} ${targetStr}</div>`;
        }
        this.executionQueue.forEach((cmd, index) => {
            let targetStr = cmd.targets.map(t => `[${t.x},${t.y}]`).join('->');
            html += `<div>${index}: ${cmd.name} ${targetStr}</div>`;
        });
        if (html === '') {
            html = '...';
        }
        queueList.innerHTML = html;
        this.setGameState(this.gameState);
    }

    showExecutionEffect(x, y, success) {
        // --- MODIFIED: Use a different color for fizzle/failure ---
        const color = success ? 0x00ff00 : 0x888888; // Green for success, Grey for failure
        const effect = this.add.rectangle(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE, color, 0.7).setOrigin(0);
        this.tweens.add({
            targets: effect,
            alpha: 0,
            duration: 400,
            onComplete: () => {
                effect.destroy();
            }
        });
    }

    updateTickCounter() {
        const hudElement = document.getElementById('game-hud');
        if (hudElement) {
            let footerString = `OPERATOR v1.0 | NETWORK_NODE: ${this.networkNode}`;
            
            // Conditionally add the reset timer info
            if (this.levelResetTimerDuration > 0) {
                footerString += ` | SYSTEM_RESET: ${this.levelResetTimerDuration}`;
            }

            footerString += ` | TICKS: ${this.ticks}`;
            
            hudElement.innerText = footerString;
        }
    }

    createBlockTextures() {
        const SPRITE_KEY = 'game-sprites';
        if (this.textures.exists(SPRITE_KEY)) {
            return;
        }

        const TILE_W = 64;
        const TILE_H = 64;
        const ATLAS_WIDTH = TILE_W * 12;
        const ATLAS_HEIGHT = TILE_H;

        // The main canvas for our atlas will be a RenderTexture.
        const rt = this.make.renderTexture({ width: ATLAS_WIDTH, height: ATLAS_HEIGHT }, false);

        // --- PHASE 1: Draw all vector graphics onto the RenderTexture ---

        const drawVectorTile = (tileIndex, drawCallback) => {
            const gfx = this.make.graphics({ add: false });
            drawCallback(gfx, TILE_W, TILE_H);
            rt.draw(gfx, TILE_W * tileIndex, 0);
            gfx.destroy();
        };

        // Draw all non-rotated vector tiles
        drawVectorTile(0, (gfx) => { /* Wall */
             gfx.fillStyle(0x008800); gfx.fillRect(0, 0, TILE_W, TILE_H);
             gfx.lineStyle(4, 0x00ff00); gfx.strokeRect(2, 2, TILE_W - 4, TILE_H - 4);
             gfx.lineBetween(0, TILE_H / 2, TILE_W, TILE_H / 2);
             gfx.lineBetween(TILE_W / 2, 0, TILE_W / 2, TILE_H);
        });
        drawVectorTile(1, (gfx, w, h) => { /* Data */
            gfx.lineStyle(4, 0x00ffff); gfx.strokeCircle(w / 2, h / 2, w / 2 - 4);
            gfx.fillStyle(0x00ffff, 0.3); gfx.fillCircle(w / 2, h / 2, w / 2 - 4);
            gfx.fillStyle(0x00ffff); gfx.fillCircle(w / 2, h / 2, w / 4);
        });
        drawVectorTile(2, (gfx, w, h) => { /* Door */
            gfx.lineStyle(4, 0xffff00); gfx.strokeRect(2, 2, w - 4, h - 4);
            gfx.fillStyle(0xffff00, 0.2); gfx.fillRect(2, 2, w - 4, h - 4);
            gfx.lineStyle(6, 0xffff00); gfx.lineBetween(w / 2, 10, w / 2, h - 10);
        });
        drawVectorTile(3, (gfx, w, h) => { /* Player */
            const centerX = w / 2; const centerY = h / 2;
            gfx.lineStyle(6, 0x00ffff, 0.5); gfx.beginPath(); gfx.moveTo(centerX - 24, centerY - 16); gfx.lineTo(centerX - 16, centerY - 16); gfx.lineTo(centerX - 16, centerY - 24); gfx.moveTo(centerX + 24, centerY - 16); gfx.lineTo(centerX + 16, centerY - 16); gfx.lineTo(centerX + 16, centerY - 24); gfx.moveTo(centerX - 24, centerY + 16); gfx.lineTo(centerX - 16, centerY + 16); gfx.lineTo(centerX - 16, centerY + 24); gfx.moveTo(centerX + 24, centerY + 16); gfx.lineTo(centerX + 16, centerY + 16); gfx.lineTo(centerX + 16, centerY + 24); gfx.strokePath();
            gfx.fillStyle(0xffffff); gfx.beginPath(); gfx.moveTo(centerX, centerY - 18); gfx.lineTo(centerX + 18, centerY); gfx.lineTo(centerX, centerY + 18); gfx.lineTo(centerX - 18, centerY); gfx.closePath(); gfx.fillPath();
            gfx.fillStyle(0xcccccc); gfx.fillCircle(centerX, centerY, 6);
        });
        drawVectorTile(4, (gfx, w, h) => { /* Exec Point */
             gfx.fillStyle(0xff8800, 0.2); gfx.fillRect(0, 0, w, h);
             gfx.lineStyle(4, 0xff8800); gfx.strokeRect(2, 2, w - 4, h - 4);
             gfx.lineStyle(6, 0xff8800); gfx.moveTo(16, 16); gfx.lineTo(48, 48); gfx.moveTo(16, 48); gfx.lineTo(48, 16); gfx.strokePath();
        });
        drawVectorTile(5, (gfx) => { /* Trail */
            gfx.fillStyle(0x00ffff); gfx.fillRect(16, 16, 32, 32);
        });
        drawVectorTile(6, (gfx, w, h) => { /* Sentinel */
            const centerX = w / 2; const centerY = h / 2; const mainRadius = 20; const arrowSize = 8;
            gfx.fillStyle(0xff0000, 0.3); gfx.fillCircle(centerX, centerY, mainRadius + 4);
            gfx.lineStyle(4, 0xff0000); gfx.strokeCircle(centerX, centerY, mainRadius);
            gfx.beginPath();
            gfx.moveTo(centerX - mainRadius - 2, centerY - arrowSize); gfx.lineTo(centerX - mainRadius - 2 - arrowSize, centerY); gfx.lineTo(centerX - mainRadius - 2, centerY + arrowSize);
            gfx.moveTo(centerX + mainRadius + 2, centerY - arrowSize); gfx.lineTo(centerX + mainRadius + 2 + arrowSize, centerY);
            gfx.lineTo(centerX + mainRadius + 2, centerY + arrowSize);
            gfx.strokePath();
            gfx.fillStyle(0x880000); gfx.fillCircle(centerX, centerY, mainRadius / 2);
        });
        drawVectorTile(7, (gfx, w, h) => { /* Hard Wall */
            gfx.fillStyle(0x005500); gfx.fillRect(0, 0, TILE_W, TILE_H);
            gfx.lineStyle(4, 0x00bb00); gfx.strokeRect(2, 2, TILE_W - 4, TILE_H - 4);
            gfx.lineBetween(0, TILE_H / 2, TILE_W, TILE_H / 2);
            gfx.lineBetween(TILE_W / 2, 0, TILE_W / 2, TILE_H);
        });

        // 1. Create the base 'up' arrow graphic with two heads.
        const tempArrowKey = '__ARROW_BASE';
        const arrowBaseGfx = this.make.graphics({ add: false });

        // Define parameters for a single arrow shape
        const headWidth = 14; 
        const headHeight = 14;
        const shaftWidth = 6;
        const shaftHeight = 22;
        const centerOffset = 10; // How far each arrow's center is from the tile's center

        // Define the center X positions for each of the two arrows
        const leftArrowCenterX = TILE_W / 2 - centerOffset;
        const rightArrowCenterX = TILE_W / 2 + centerOffset;

        // Set the fill color to yellow
        arrowBaseGfx.fillStyle(0xffff00, 0.8);

        // Helper function to draw one complete arrow pointing up
        const drawSingleUpArrow = (gfx, centerX) => {
            const headTipY = 14;
            const headBaseY = headTipY + headHeight;
            const shaftTopY = headBaseY - 2; // -2 for a slight overlap with the head
            
            // Draw the shaft
            gfx.fillRect(centerX - shaftWidth / 2, shaftTopY, shaftWidth, shaftHeight);

            // Draw the head (a simple triangle)
            gfx.beginPath();
            gfx.moveTo(centerX, headTipY);
            gfx.lineTo(centerX - headWidth / 2, headBaseY);
            gfx.lineTo(centerX + headWidth / 2, headBaseY);
            gfx.closePath();
            gfx.fillPath();
        };

        // Draw the two arrows using the helper
        drawSingleUpArrow(arrowBaseGfx, leftArrowCenterX);
        drawSingleUpArrow(arrowBaseGfx, rightArrowCenterX);

        arrowBaseGfx.generateTexture(tempArrowKey, TILE_W, TILE_H);
        arrowBaseGfx.destroy();

        // 2. Create a reusable Image GameObject and set its origin to the center. THIS IS CRITICAL.
        const tempArrowImage = this.make.image({ key: tempArrowKey, add: false });
        tempArrowImage.setOrigin(0.5, 0.5);

        // 3. Draw the Image to the main atlas, rotating it for each frame.
        // The x/y coordinates provided to rt.draw() are where the image's ORIGIN will be placed.
        
        // UP (tile 8)
        tempArrowImage.setAngle(0);
        rt.draw(tempArrowImage, TILE_W * 8 + (TILE_W / 2), TILE_H / 2);

        // DOWN (tile 9)
        tempArrowImage.setAngle(180);
        rt.draw(tempArrowImage, TILE_W * 9 + (TILE_W / 2), TILE_H / 2);

        // LEFT (tile 10)
        tempArrowImage.setAngle(-90);
        rt.draw(tempArrowImage, TILE_W * 10 + (TILE_W / 2), TILE_H / 2);

        // RIGHT (tile 11)
        tempArrowImage.setAngle(90);
        rt.draw(tempArrowImage, TILE_W * 11 + (TILE_W / 2), TILE_H / 2);

        // --- PHASE 3: Finalize the atlas and define frames ---
        rt.saveTexture(SPRITE_KEY);
        
        const finalTexture = this.textures.get(SPRITE_KEY);
        finalTexture.add('wall', 0, TILE_W * 0, 0, TILE_W, TILE_H);
        finalTexture.add('data', 0, TILE_W * 1, 0, TILE_W, TILE_H);
        finalTexture.add('door', 0, TILE_W * 2, 0, TILE_W, TILE_H);
        finalTexture.add('player', 0, TILE_W * 3, 0, TILE_W, TILE_H);
        finalTexture.add('execution_point', 0, TILE_W * 4, 0, TILE_W, TILE_H);
        finalTexture.add('trail', 0, TILE_W * 5, 0, TILE_W, TILE_H);
        finalTexture.add('sentinel', 0, TILE_W * 6, 0, TILE_W, TILE_H);
        finalTexture.add('hard_wall', 0, TILE_W * 7, 0, TILE_W, TILE_H);
        finalTexture.add('arrow_up', 0, TILE_W * 8, 0, TILE_W, TILE_H);
        finalTexture.add('arrow_down', 0, TILE_W * 9, 0, TILE_W, TILE_H);
        finalTexture.add('arrow_left', 0, TILE_W * 10, 0, TILE_W, TILE_H);
        finalTexture.add('arrow_right', 0, TILE_W * 11, 0, TILE_W, TILE_H);

        // --- PHASE 4: Clean up all temporary assets ---
        rt.destroy();
        tempArrowImage.destroy();
        this.textures.remove(tempArrowKey);
    }

    createPlayer() {
        let startPos = this.findPlayerStart();
        if (!startPos) {
            console.error(`Player start position not found in level${this.currentLevel}.json!`);
            this.add.text(this.game.config.width / 2, this.game.config.height / 2, 'LEVEL ERROR:\nNo player start found.', { ...FONT_STYLE,
                color: '#ff0000',
                align: 'center'
            }).setOrigin(0.5);
            this.setGameState('FINISHED');
            return;
        }
        this.playerGridPos = new Phaser.Math.Vector2(startPos.x, startPos.y);
        const playerXPos = this.playerGridPos.x * TILE_SIZE + TILE_SIZE / 2;
        const playerYPos = this.playerGridPos.y * TILE_SIZE + TILE_SIZE / 2;
        this.player = this.add.image(playerXPos, playerYPos, 'game-sprites', 'player');
        this.player.setDisplaySize(TILE_SIZE * 0.8, TILE_SIZE * 0.8);
        this.player.setDepth(10);
    }

    findPlayerStart() {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                if (this.levelLayout[y][x] === 'player') {
                    return {
                        x,
                        y
                    };
                }
            }
        }
        return null;
    }

    levelComplete() {
        // --- NEW: Clean up sentinels on win ---
        this.sentinels.forEach(s => s.sprite.destroy());
        this.sentinels = [];
        this.arrows.forEach(a => a.sprite.destroy());
        this.arrows = [];

        this.tweens.add({
            targets: this.player,
            scaleX: 2,
            scaleY: 2,
            alpha: 0,
            duration: 500,
            ease: 'Power2'
        });
        this.setGameState('FINISHED');
        this.cameras.main.fadeOut(1000, 0, 0, 0, (camera, progress) => {
            if (progress === 1) {
                this.currentLevel++;
                this.scene.start('GameScene', { startLevel: this.currentLevel });
            }
        });
    }

    handleNoMoreLevels() {
        this.add.text(this.game.config.width / 2, this.game.config.height / 2, 'YOU HAVE INFILTRATED THE SYSTEM.\n\n-- CONNECTION TERMINATED --', { ...FONT_STYLE,
            fontSize: '24px',
            align: 'center',
            lineSpacing: 15
        }).setOrigin(0.5);
        if (this.player) this.player.setVisible(false);
        this.setGameState('FINISHED');
    }

    drawGridLines() {
        for (let y = 0; y < GRID_HEIGHT; y++) {
            for (let x = 0; x < GRID_WIDTH; x++) {
                this.add.rectangle(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE).setStrokeStyle(1, 0x008800).setOrigin(0, 0);
            }
        }
    }

    triggerScanlineWipe() {
        if (this.scanlineGroup) {
            this.clearScanlineWipe();
        }
        this.scanlineGroup = this.add.group();

        const lineSpacing = 16;
        const numLines = this.game.config.height / lineSpacing;
        const chars = '01          '; // More spaces for a sparser look

        for (let i = 0; i < numLines; i++) {
            const y = i * lineSpacing;
            const direction = Phaser.Math.RND.pick([-1, 1]); // -1 for right-to-left, 1 for left-to-right
            const speed = Phaser.Math.Between(800, 1500); // pixels per second
            
            // Create a long string of random characters
            let lineText = '';
            for (let j = 0; j < 100; j++) {
                lineText += Phaser.Math.RND.pick(chars.split(''));
            }

            const text = this.add.text(0, y, lineText, {
                fontFamily: FONT_STYLE.fontFamily,
                fontSize: '14px',
                color: '#00ff00',
                alpha: 1.0
            }).setDepth(100); // High depth to render on top of game objects

            // Set initial position off-screen
            text.x = (direction === 1) ? -text.width : this.game.config.width;

            this.scanlineGroup.add(text);

            // Tween the text across the screen
            this.tweens.add({
                targets: text,
                x: (direction === 1) ? this.game.config.width : -text.width,
                duration: (this.game.config.width + text.width) * 1000 / speed,
                delay: Phaser.Math.Between(0, 300) // Stagger the start times
            });
        }
    }

    clearScanlineWipe() {
        if (this.scanlineGroup) {
            this.scanlineGroup.destroy(true); // true to destroy all children
            this.scanlineGroup = null;
        }
    }

    createDigitalRain() {
        this.rainGroup = this.add.group();
        const rainChars = '01';
        const streamCount = 70;
        for (let i = 0; i < streamCount; i++) {
            const x = Phaser.Math.Between(0, this.game.config.width);
            const y = Phaser.Math.Between(-this.game.config.height, 0);
            const char = Phaser.Math.RND.pick(rainChars.split(''));
            const text = this.add.text(x, y, char, {
                fontFamily: FONT_STYLE.fontFamily,
                fontSize: '20px',
                color: '#00ff00'
            });
            text.setAlpha(0.25);
            text.setData('velocity', Phaser.Math.Between(2, 5));
            this.rainGroup.add(text);
        }
    }

    updateDigitalRain() {
        this.rainGroup.children.iterate(char => {
            if (!char) return;
            char.y += char.getData('velocity');
            if (char.y > this.game.config.height) {
                char.y = Phaser.Math.Between(-100, 0);
                char.x = Phaser.Math.Between(0, this.game.config.width);
            }
        });
    }
}

// --- PHASER GAME CONFIGURATION ---
// const config = {
//     type: Phaser.AUTO,
//     width: TILE_SIZE * GRID_WIDTH,
//     height: TILE_SIZE * GRID_HEIGHT,
//     parent: 'game-container',
//     backgroundColor: '#001a00',
//     scene: [GameScene]
// };

// const game = new Phaser.Game(config);