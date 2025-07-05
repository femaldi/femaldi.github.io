class StartScreenScene extends Phaser.Scene {
    constructor() {
        super('StartScreenScene');
        this.levelIndexData = [];
        this.selectedLevelIndex = -1;
        this.rainGroup = null;
    }

    preload() {
        this.load.json('levels_index', 'levels_index.json');
    }

    create() {
        const levelIndex = this.cache.json.get('levels_index');
        this.levelIndexData = levelIndex;
        
        this.createDigitalRain(); // Create rain effect on the canvas
        
        levelIndex.forEach((levelInfo, index) => {
            this.load.json(`level_data_${index}`, levelInfo.levelContent);
        });
        
        this.load.once('complete', this.buildUI, this);
        this.load.start();
    }

    update() {
        if (this.rainGroup) {
            this.updateDigitalRain();
        }
    }

    // This is the complete function to be placed inside the StartScreenScene class.

    buildUI() {
        const oldScreen = document.getElementById('start-screen-container');
        if (oldScreen) oldScreen.remove();

        const startScreenHtml = `
            <div id="start-screen-container">
                <div id="level-select-panel">
                    <!-- THIS IS THE FIX: The title and subtitle are added back in -->
                    <h1 class="main-title">Digital Vibes</h1>
                    <h2 class="sub-title">SELECT TARGET NODE</h2>
                    
                    <div id="level-grid"></div>
                    
                    <div id="details-panel" style="display: none;">
                        <div id="details-content"></div>
                    </div>

                    <button id="start-button" class="disabled">[ INITIATE CONNECTION ]</button>
                    <a href="tutorial.html" target="_blank" id="start-screen-tutorial-link">[ OPERATOR MANUAL ]</a>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', startScreenHtml);

        const levelGrid = document.getElementById('level-grid');
        const totalGridSlots = 64;

        for (let i = 0; i < totalGridSlots; i++) {
            const button = document.createElement('button');
            button.classList.add('level-button');
            const levelNum = i + 1;
            
            if (i < this.levelIndexData.length) {
                button.dataset.levelIndex = i;
                button.innerText = String(levelNum).padStart(2, '0');
                const progress = Progress.getLevelProgress(levelNum);
                if (progress.completed) {
                    button.classList.add('completed');
                }
                button.addEventListener('click', () => this.selectLevel(i));
            } else {
                button.classList.add('disabled');
                button.innerText = 'X';
                button.disabled = true;
            }
            levelGrid.appendChild(button);
        }

        document.getElementById('start-button').addEventListener('click', () => {
            this.startGame();
        });

        if (this.levelIndexData.length > 0) {
            this.selectLevel(0);
        }
    }

    selectLevel(levelIndex) {
        if (this.selectedLevelIndex !== -1) {
            const oldButton = document.querySelector(`[data-level-index='${this.selectedLevelIndex}']`);
            if (oldButton) oldButton.classList.remove('selected');
        }

        this.selectedLevelIndex = levelIndex;
        const newButton = document.querySelector(`[data-level-index='${this.selectedLevelIndex}']`);
        newButton.classList.add('selected');

        document.getElementById('details-panel').style.display = 'block';
        this.updateDetailsPanel(levelIndex);
        document.getElementById('start-button').classList.remove('disabled');
    }

    updateDetailsPanel(levelIndex) {
        const levelNum = levelIndex + 1;
        const levelData = this.cache.json.get(`level_data_${levelIndex}`);
        const progress = Progress.getLevelProgress(levelNum);

        const detailsContent = document.getElementById('details-content');
        detailsContent.innerHTML = `
            <div class="detail-item">NODE: <span>${levelData.network_node || 'N/A'}</span></div>
            <div class="detail-item">STATUS: <span>${progress.completed ? 'COMPLETED' : 'INCOMPLETE'}</span></div>
            <div class="detail-item">BEST TIME: <span>${progress.bestTime !== null ? `${progress.bestTime} ticks` : 'N/A'}</span></div>
            <hr>
            <div class="detail-item">RESET TIMER: <span>${levelData.reset_timer || 'N/A'}</span></div>
            <div class="detail-item">BUFFER SIZE: <span>${levelData.buffer_size || 'N/A'}</span></div>
        `;
    }

    startGame() {
        if (this.selectedLevelIndex === -1) return;

        document.getElementById('start-screen-container').remove();
        document.getElementById('app-container').style.display = 'flex';
        this.scene.start('GameScene', { startLevel: this.selectedLevelIndex + 1 });
    }

    // --- MODIFIED: Rain is now constrained to the sides ---
    createDigitalRain() {
        const screenWidth = this.cameras.main.width;
        const screenHeight = this.cameras.main.height;

        // Define a clear zone in the middle (70% of the screen width)
        const sideWidth = screenWidth * 0.15; // 15% on each side
        const leftZoneEnd = sideWidth;
        const rightZoneStart = screenWidth - sideWidth;

        this.rainGroup = this.add.group();
        const rainChars = '01';
        const streamCount = 50; // Slightly reduced density

        for (let i = 0; i < streamCount; i++) {
            let x;
            // 50% chance to be on the left, 50% on the right
            if (Phaser.Math.RND.frac() < 0.5) {
                x = Phaser.Math.Between(0, leftZoneEnd);
            } else {
                x = Phaser.Math.Between(rightZoneStart, screenWidth);
            }

            const y = Phaser.Math.Between(-screenHeight, 0);
            const char = Phaser.Math.RND.pick(rainChars.split(''));
            const text = this.add.text(x, y, char, {
                fontFamily: '"Courier New", Courier, monospace',
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
            if (char.y > this.cameras.main.height) {
                char.y = Phaser.Math.Between(-100, 0);
            }
        });
    }
}