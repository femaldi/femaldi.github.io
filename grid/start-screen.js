// --- CONFIGURATION ---
const MAX_LEVELS_TO_CHECK = 20; // How many level files to attempt to load

// --- START SCREEN SCENE ---
class StartScreenScene extends Phaser.Scene {
    constructor() {
        super('StartScreenScene');
        this.rainGroup = null;
    }

    preload() {
        // Pre-load all possible level files to find network nodes
        for (let i = 1; i <= MAX_LEVELS_TO_CHECK; i++) {
            this.load.json(`level${i}`, `levels/level${i}.json`);
        }
    }

    create() {
        this.createDigitalRain();
        this.createStartForm();
    }

    update() {
        this.updateDigitalRain();
    }

    createStartForm() {
        const level1Data = this.cache.json.get('level1');
        const defaultNode = level1Data ? level1Data.network_node : '7F.A4.1';

        const formHtml = `
            <div id="start-screen-container">
                <h1>DIGITAL OPERATOR</h1>
                <div class="form-group">
                    <label for="network-node-input">TARGET NETWORK NODE:</label>
                    <input type="text" id="network-node-input" value="${defaultNode}">
                </div>
                <button id="start-button">[ INITIATE CONNECTION ]</button>
                <div id="error-message" class="hidden"></div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', formHtml);

        const startButton = document.getElementById('start-button');
        const nodeInput = document.getElementById('network-node-input');

        startButton.addEventListener('click', () => {
            this.findAndStartLevel(nodeInput.value);
        });
        
        nodeInput.addEventListener('keyup', (event) => {
            if (event.key === 'Enter') {
                this.findAndStartLevel(nodeInput.value);
            }
        });
    }

    findAndStartLevel(targetNode) {
        let foundLevel = -1;
        for (let i = 1; i <= MAX_LEVELS_TO_CHECK; i++) {
            const levelKey = `level${i}`;
            if (this.cache.json.has(levelKey)) {
                const levelData = this.cache.json.get(levelKey);
                if (levelData.network_node && levelData.network_node.trim().toUpperCase() === targetNode.trim().toUpperCase()) {
                    foundLevel = i;
                    break;
                }
            }
        }

        if (foundLevel !== -1) {
            // Success! Hide the form and start the game.
            document.getElementById('start-screen-container').style.display = 'none';
            this.scene.start('GameScene', { startLevel: foundLevel });
        } else {
            // Failure. Show an error message.
            const errorMessageDiv = document.getElementById('error-message');
            errorMessageDiv.innerText = '> ERROR: NODE NOT FOUND IN SECTOR. CONNECTION REFUSED.';
            errorMessageDiv.classList.remove('hidden');
            setTimeout(() => {
                errorMessageDiv.classList.add('hidden');
            }, 3000);
        }
    }

    // Copied from GameScene for background effect
    createDigitalRain() {
        this.rainGroup = this.add.group();
        const rainChars = '01';
        const streamCount = 70;
        for (let i = 0; i < streamCount; i++) {
            const x = Phaser.Math.Between(0, this.game.config.width);
            const y = Phaser.Math.Between(-this.game.config.height, 0);
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
            if (char.y > this.game.config.height) {
                char.y = Phaser.Math.Between(-100, 0);
                char.x = Phaser.Math.Between(0, this.game.config.width);
            }
        });
    }
}