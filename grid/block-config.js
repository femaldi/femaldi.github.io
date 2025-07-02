const BLOCK_TYPES = {
    // --- Special block for erasing ---
    erase: { id: null, name: 'Erase', char: '', color: '#ffffff', command_multiplier: 1 },

    // --- Gameplay blocks ---
    wall: {
        id: 'wall',
        name: 'Wall',
        char: '+',
        color: '#00ff00',
        command_multiplier: 2 // Walls are expensive to modify
    },
    data: {
        id: 'data',
        name: 'Data Node',
        char: 'D',
        color: '#00ffff',
        command_multiplier: 8 // Data is critical and very expensive
    },
    door: {
        id: 'door',
        name: 'Door',
        char: '|',
        color: '#ffff00',
        command_multiplier: 1 // Doors are standard
    },
    player: {
        id: 'player',
        name: 'Player Start',
        char: 'P',
        color: '#ff00ff',
        command_multiplier: 1 // Can't be targeted anyway
    },
    execution_point: {
        id: 'execution_point',
        name: 'Execution Point',
        char: 'X',
        color: '#ff8800',
        command_multiplier: 1 // Execution points are stable
    }
};

// --- NEW: Configuration for blocks with extra parameters ---
const DYNAMIC_BLOCK_TYPES = {
    sentinel: {
        id: 'sentinel',
        name: 'Sentinel',
        char: 'S',          // Base character for the palette
        color: '#e040fb',   // A distinct purple/magenta color
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
    }
};