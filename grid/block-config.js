const BLOCK_TYPES = {
    // --- Special block for erasing ---
    erase: { id: null, name: 'Erase', char: '', color: '#ffffff', command_multiplier: 1, renderPriority: 0 },

    // --- Gameplay blocks ---
    wall: {
        id: 'wall',
        name: 'Wall',
        char: '+',
        color: '#00ff00',
        command_multiplier: 2,
        renderPriority: 1 // Walls are expensive to modify
    },
    hard_wall: {
        id: 'hard_wall',
        name: 'Hard Wall',
        char: '++', // A more solid block character
        color: '#00aa00', // A darker green
        command_multiplier: 8,
        renderPriority: 2 // Very expensive
    },
    data: {
        id: 'data',
        name: 'Data Node',
        char: 'D',
        color: '#00ffff',
        command_multiplier: 8,
        renderPriority: 1 // Data is critical and very expensive
    },
    door: {
        id: 'door',
        name: 'Door',
        char: '|',
        color: '#ffff00',
        command_multiplier: 1,
        renderPriority: 1 // Doors are standard
    },
    player: {
        id: 'player',
        name: 'Player Start',
        char: 'P',
        color: '#ff00ff',
        command_multiplier: 1,
        renderPriority: -99 // Can't be targeted anyway
    },
    execution_point: {
        id: 'execution_point',
        name: 'Execution Point',
        char: 'X',
        color: '#ff8800',
        command_multiplier: 1,
        renderPriority: 1 // Execution points are stable
    }
};

// --- NEW: Configuration for blocks with extra parameters ---
const DYNAMIC_BLOCK_TYPES = {
    sentinel: {
        id: 'sentinel',
        name: 'Sentinel',
        char: 'S',          // Base character for the palette
        color: '#e040fb',   // A distinct purple/magenta color
        renderPriority: 10,
        command_multiplier: 3,
        isMobile: true,
        // Defines the parameters this block type can have
        parameters: {
            direction: {
                label: 'Direction',
                options: ['horizontal', 'vertical'],
                default: 'horizontal'
            }
        },
        // Function to get the display character based on parameters
        getDisplayChar: function(params) {
            if (params.direction === 'horizontal') {
                return 'S\u2194'; // S with left-right arrow
            }
            return 'S\u2195'; // S with up-down arrow
        }
    },
    arrow: {
        id: 'arrow',
        name: 'Arrow',
        char: '→', // Default character for the palette
        color: '#ffffff', // A neutral white/light grey color
        renderPriority: 5,
        command_multiplier: 1,
        isMobile: false,
        parameters: {
            direction: {
                label: 'Direction',
                options: ['up', 'down', 'left', 'right'],
                default: 'right'
            }
        },
        getDisplayChar: function(params) {
            switch (params.direction) {
                case 'up': return '/\\';
                case 'down': return '\\/';
                case 'left': return '<';
                case 'right': return '>';
                default: return '?';
            }
        }
    }
};