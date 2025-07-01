// --- CONFIGURATION ---
const TILE_SIZE = 32;
const GRID_WIDTH = 24;
const GRID_HEIGHT = 24;
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
        this.levelObjects = [];
        this.currentLevel = 1;

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
        this.setGameState('MOVEMENT');
        const levelData = this.cache.json.get(`level${this.currentLevel}`);
        this.levelLayout = JSON.parse(JSON.stringify(levelData.tiles));
        this.originalLevelLayout = JSON.parse(JSON.stringify(levelData.tiles));
        this.levelResetTimerDuration = levelData.reset_timer || -1;
        this.resetTimerTicksRemaining = -1;
        this.bufferSize = levelData.buffer_size || PLAYER_BUFFER_SIZE;
        this.drawGridLines();
        this.rebuildLevelVisuals();
        this.createPlayer();
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
    }

    update() {
        this.updateDigitalRain();
    }

    setGameState(newState) {
        console.log(`State change: ${this.gameState} -> ${newState}`);
        this.gameState = newState;
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

    calculateFinalCost(commandType, targetGridX, targetGridY) {
        const blockId = this.levelLayout[targetGridY][targetGridX];
        let blockType = Object.values(BLOCK_TYPES).find(b => b.id === blockId);
        if (!blockType) {
            blockType = BLOCK_TYPES.erase;
        }
        return commandType.cost * blockType.command_multiplier;
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
            finalCost: 0
        };
        this.statusText.setText(`> TARGETING: ${commandType.description}`);
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
        this.currentTargetingCommand.targets.push({
            x: gridX,
            y: gridY
        });
        this.currentTargetingCommand.finalCost += costOfThisClick;
        const highlight = this.add.rectangle(gridX * TILE_SIZE, gridY * TILE_SIZE, TILE_SIZE, TILE_SIZE).setStrokeStyle(3, 0xff00ff).setOrigin(0);
        this.targetHighlights.push(highlight);
        if (this.currentTargetingCommand.targets.length >= this.currentTargetingCommand.targetCount) {
            this.addCommandToQueue();
        }
    }

    addCommandToQueue() {
        //this.spentCommands = [];
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
        if (this.levelResetTimerDuration > 0 && this.resetTimerTicksRemaining <= 0) {
            this.resetTimerTicksRemaining = this.levelResetTimerDuration;
            this.statusText.setText(`> SYSTEM INSTABILITY. RESET IN ${this.resetTimerTicksRemaining} TICKS.`);
        } else {
            this.statusText.setText(`> EXECUTION MODE. Move to process queue (${this.executionQueue.length} left).`);
        }
    }

    processNextCommandInQueue() {
        if (this.executionQueue.length === 0) return;
        this.currentExecutingCommand = this.executionQueue[0];
        const command = this.executionQueue.shift();
        let success = false;
        switch (command.id) {
            case 'delete':
                success = this.executeDelete(command);
                break;
            case 'copy':
                success = this.executeCopy(command);
                break;
        }
        const targetPos = command.targets[command.targets.length - 1];
        this.showExecutionEffect(targetPos.x, targetPos.y, success);
        this.spentCommands.push(this.currentExecutingCommand);
        this.currentExecutingCommand = null;
        this.updateQueueUI();
        this.updateBufferUI();
        if (this.executionQueue.length === 0) {
            this.setGameState('MOVEMENT');
            this.statusText.setText('> Execution complete. Awaiting input.');
        } else {
            if (this.resetTimerTicksRemaining <= 0) {
                this.statusText.setText(`> EXECUTION MODE. Move to process queue (${this.executionQueue.length} left).`);
            }
        }
    }

    executeDelete(command) {
        const target = command.targets[0];
        const {
            x,
            y
        } = target;
        if (this.playerGridPos.x === x && this.playerGridPos.y === y) return false;
        if (this.levelObjects[y] && this.levelObjects[y][x]) {
            this.levelObjects[y][x].destroy();
            this.levelObjects[y][x] = null;
        }
        this.levelLayout[y][x] = null;
        return true;
    }

    executeCopy(command) {
        const source = command.targets[0];
        const target = command.targets[1];
        if (this.playerGridPos.x === target.x && this.playerGridPos.y === target.y) return false;
        const sourceId = this.levelLayout[source.y][source.x];
        if (this.levelObjects[target.y] && this.levelObjects[target.y][target.x]) {
            this.levelObjects[target.y][target.x].destroy();
        }
        this.levelLayout[target.y][target.x] = sourceId;
        if (sourceId) {
            const tx = target.x * TILE_SIZE + TILE_SIZE / 2;
            const ty = target.y * TILE_SIZE + TILE_SIZE / 2;
            const newSprite = this.add.image(tx, ty, 'game-sprites', sourceId);
            newSprite.setDisplaySize(TILE_SIZE, TILE_SIZE);
            if (!this.levelObjects[target.y]) this.levelObjects[target.y] = [];
            this.levelObjects[target.y][target.x] = newSprite;
        }
        return true;
    }

        movePlayer(dx, dy) {
        // --- THIS FUNCTION CONTAINS THE TRAIL EFFECT LOGIC ---
        const oldX = this.playerGridPos.x * TILE_SIZE + TILE_SIZE / 2;
        const oldY = this.playerGridPos.y * TILE_SIZE + TILE_SIZE / 2;

        if (dx === 0 && dy === 0) {
            // "Wait" action. Create a ghost at the current spot.
            const trail = this.add.image(oldX, oldY, 'game-sprites', 'trail');
            trail.setDisplaySize(TILE_SIZE * 0.75, TILE_SIZE * 0.75).setDepth(this.player.depth - 1);
            this.tweens.add({ targets: trail, alpha: 0, scale: 0, duration: 500, onComplete: () => trail.destroy() });
        } else {
            // Directional move
            const targetX = this.playerGridPos.x + dx;
            const targetY = this.playerGridPos.y + dy;
            if (targetX < 0 || targetX >= GRID_WIDTH || targetY < 0 || targetY >= GRID_HEIGHT) return;
            const targetTileId = this.levelLayout[targetY][targetX];
            if (targetTileId === 'wall' || targetTileId === 'door') return;

            // Create a ghost at the old position before moving
            const trail = this.add.image(oldX, oldY, 'game-sprites', 'trail');
            trail.setDisplaySize(TILE_SIZE * 0.75, TILE_SIZE * 0.75).setDepth(this.player.depth - 1);
            this.tweens.add({ targets: trail, alpha: 0, scale: 0, duration: 500, onComplete: () => trail.destroy() });
            
            this.playerGridPos.x = targetX;
            this.playerGridPos.y = targetY;
            this.tweens.add({
                targets: this.player,
                x: targetX * TILE_SIZE + TILE_SIZE / 2,
                y: targetY * TILE_SIZE + TILE_SIZE / 2,
                duration: 150,
                ease: 'Power2'
            });
        }

        this.ticks++;
        this.updateTickCounter();
        if (this.resetTimerTicksRemaining > 0) {
            this.resetTimerTicksRemaining--;
            if (this.resetTimerTicksRemaining === 0) {
                this.resetLevel();
                return;
            } else {
                this.statusText.setText(`> SYSTEM INSTABILITY. RESET IN ${this.resetTimerTicksRemaining} TICKS.`);
            }
        }
        if (this.gameState === 'EXECUTING') {
            this.processNextCommandInQueue();
        }
        const currentTileId = this.levelLayout[this.playerGridPos.y][this.playerGridPos.x];
        if (currentTileId === 'data') {
            this.levelComplete();
        }
        if (currentTileId === 'execution_point' && this.gameState === 'MOVEMENT') {
            this.initiateExecutionMode();
        }
    }

    resetLevel() {
        this.statusText.setText('> KERNEL PANIC. SYSTEM RESETTING...');
        this.setGameState('PAUSED');
        this.cameras.main.flash(500, 255, 0, 0);
        this.levelLayout = JSON.parse(JSON.stringify(this.originalLevelLayout));
        this.executionQueue = [];
        this.currentExecutingCommand = null;
        this.resetTimerTicksRemaining = -1;
        this.rebuildLevelVisuals();
        this.updateQueueUI();
        this.updateBufferUI();
        this.time.delayedCall(600, () => {
            this.statusText.setText('> Awaiting input...');
            this.setGameState('MOVEMENT');
        });
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
            html += `<a href="#" class="command-button" data-command-id="${cmd.id}">[${cmd.name}] (Cost: ${cmd.cost})</a>`;
        }
        html += `</div><h3>BUFFER</h3><div id="buffer-display" class="ui-section"><span id="buffer-text"></span><div id="buffer-bar"></div></div>`;
        html += `<div class="queue-header"><h3>EXECUTION QUEUE</h3><a href="#" id="undo-button" class="disabled">[UNDO]</a></div><div id="queue-list" class="ui-section">...</div>`;
        html += `<h3>STATUS</h3><div id="status-display" class="ui-section">> Awaiting input...</div>`;
        this.uiPanel.innerHTML = html;
        document.querySelectorAll('.command-button').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                if (this.gameState !== 'MOVEMENT') return;
                const cmdId = e.target.getAttribute('data-command-id');
                this.startTargeting(COMMAND_TYPES[cmdId]);
            });
        });
        document.getElementById('undo-button').addEventListener('click', (e) => {
            e.preventDefault();
            this.undoLastCommand();
        });
        // --- NEW: Reset button listener ---
        document.getElementById('reset-button').addEventListener('click', (e) => {
            e.preventDefault();
            this.scene.restart();
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
            emptySlot.innerHTML = ' ';
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
        const color = success ? 0x00ff00 : 0xff0000;
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
        if (!hudElement) {
            const newHud = document.createElement('div');
            newHud.id = 'game-hud';
            newHud.style.position = 'absolute';
            newHud.style.bottom = '10px';
            newHud.style.left = '10px';
            newHud.style.color = '#00ff00';
            newHud.style.fontFamily = 'Courier New';
            document.querySelector('#main-container').prepend(newHud);
            this.tickText = {
                setText: text => newHud.innerText = text
            };
        }
        this.tickText.setText(`OPERATOR v1.0 | NETWORK_NODE: 7F.A4.1 | TICKS: ${this.ticks}`);
    }

    createBlockTextures() {
        const gfx = this.make.graphics({ add: false });
        const SPRITE_KEY = 'game-sprites';
        const TILE_W = 64;
        const TILE_H = 64;
        
        // --- Unchanged: Wall, Data, Door ---
        gfx.fillStyle(0x008800); gfx.fillRect(TILE_W * 0, 0, TILE_W, TILE_H);
        gfx.lineStyle(4, 0x00ff00); gfx.strokeRect(TILE_W * 0 + 2, 2, TILE_W - 4, TILE_H - 4);
        gfx.lineBetween(TILE_W * 0, TILE_H / 2, TILE_W * 1, TILE_H / 2); gfx.lineBetween(TILE_W / 2, 0, TILE_W / 2, TILE_H);
        const dataX = TILE_W * 1; gfx.lineStyle(4, 0x00ffff); gfx.strokeCircle(dataX + TILE_W / 2, TILE_H / 2, TILE_W / 2 - 4); gfx.fillStyle(0x00ffff, 0.3); gfx.fillCircle(dataX + TILE_W / 2, TILE_H / 2, TILE_W / 2 - 4); gfx.fillStyle(0x00ffff); gfx.fillCircle(dataX + TILE_W / 2, TILE_H / 2, TILE_W / 4);
        const doorX = TILE_W * 2; gfx.lineStyle(4, 0xffff00); gfx.strokeRect(doorX + 2, 2, TILE_W - 4, TILE_H - 4); gfx.fillStyle(0xffff00, 0.2); gfx.fillRect(doorX + 2, 2, TILE_W - 4, TILE_H - 4); gfx.lineStyle(6, 0xffff00); gfx.lineBetween(doorX + TILE_W / 2, 10, doorX + TILE_W / 2, TILE_H - 10);
        
        // --- NEW PLAYER SPRITE ---
        const playerX = TILE_W * 3;
        const centerX = playerX + TILE_W / 2;
        const centerY = TILE_H / 2;
        
        // Layer 1: Outer glowing brackets (cyan)
        gfx.lineStyle(6, 0x00ffff, 0.5);
        gfx.beginPath();
        gfx.moveTo(centerX - 24, centerY - 16);
        gfx.lineTo(centerX - 16, centerY - 16);
        gfx.lineTo(centerX - 16, centerY - 24);
        gfx.moveTo(centerX + 24, centerY - 16);
        gfx.lineTo(centerX + 16, centerY - 16);
        gfx.lineTo(centerX + 16, centerY - 24);
        gfx.moveTo(centerX - 24, centerY + 16);
        gfx.lineTo(centerX - 16, centerY + 16);
        gfx.lineTo(centerX - 16, centerY + 24);
        gfx.moveTo(centerX + 24, centerY + 16);
        gfx.lineTo(centerX + 16, centerY + 16);
        gfx.lineTo(centerX + 16, centerY + 24);
        gfx.strokePath();

        // Layer 2: Inner diamond shape (white)
        gfx.fillStyle(0xffffff);
        gfx.beginPath();
        gfx.moveTo(centerX, centerY - 18);       // Top point
        gfx.lineTo(centerX + 18, centerY);       // Right point
        gfx.lineTo(centerX, centerY + 18);       // Bottom point
        gfx.lineTo(centerX - 18, centerY);       // Left point
        gfx.closePath();
        gfx.fillPath();
        
        // Layer 3: Inner core (darker fill)
        gfx.fillStyle(0xcccccc);
        gfx.fillCircle(centerX, centerY, 6);


        // --- Unchanged: Execution Point ---
        const execX = TILE_W * 4; gfx.fillStyle(0xff8800, 0.2); gfx.fillRect(execX, 0, TILE_W, TILE_H); gfx.lineStyle(4, 0xff8800); gfx.strokeRect(execX + 2, 2, TILE_W - 4, TILE_H - 4); gfx.lineStyle(6, 0xff8800); gfx.moveTo(execX + 16, 16); gfx.lineTo(execX + 48, 48); gfx.moveTo(execX + 16, 48); gfx.lineTo(execX + 48, 16); gfx.strokePath();
        
        const trailX = TILE_W * 5;
        gfx.fillStyle(0x00ffff); // Match the player's cyan brackets
        gfx.fillRect(trailX + 16, 16, 32, 32); // Draw a 32x32 square in the center of the 64x64 tile area

        // Generate the final texture atlas (now 6 tiles wide)
        gfx.generateTexture(SPRITE_KEY, TILE_W * 6, TILE_H);
        gfx.destroy();

        // Add the new frame definition
        this.textures.get(SPRITE_KEY).add('wall', 0, TILE_W * 0, 0, TILE_W, TILE_H);
        this.textures.get(SPRITE_KEY).add('data', 0, TILE_W * 1, 0, TILE_W, TILE_H);
        this.textures.get(SPRITE_KEY).add('door', 0, TILE_W * 2, 0, TILE_W, TILE_H);
        this.textures.get(SPRITE_KEY).add('player', 0, TILE_W * 3, 0, TILE_W, TILE_H);
        this.textures.get(SPRITE_KEY).add('execution_point', 0, TILE_W * 4, 0, TILE_W, TILE_H);
        this.textures.get(SPRITE_KEY).add('trail', 0, TILE_W * 5, 0, TILE_W, TILE_H); // <-- NEW
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
                this.scene.restart();
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
const config = {
    type: Phaser.AUTO,
    width: TILE_SIZE * GRID_WIDTH,
    height: TILE_SIZE * GRID_HEIGHT,
    parent: 'game-container',
    backgroundColor: '#001a00',
    scene: [GameScene]
};

const game = new Phaser.Game(config);