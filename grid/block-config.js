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
        command_multiplier: 15,
        renderPriority: 1 // Data is critical and very expensive
    },
    door: {
        id: 'door',
        name: 'Door',
        char: '|',
        color: '#ffff00',
        command_multiplier: 1,
        renderPriority: 1, // Doors are standard
        isStateful: true
    },
    secured_door: {
        id: 'secured_door',
        name: 'Secured Door',
        char: '||',
        color: '#ffff00', // Same color as door, sprite is different
        command_multiplier: 12, // Higher cost
        renderPriority: 1,
        isStateful: true // NEW: Also has a state
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
        command_multiplier: 6,
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
        isStateful: true, // NEW: Arrows can be disabled
        parameters: {
            direction: {
                label: 'Direction',
                options: ['up', 'down', 'left', 'right'],
                default: 'right'
            },
            // NEW: Parameter for initial state
            initial_state: {
                label: 'Initial State',
                options: ['enabled', 'disabled'],
                default: 'enabled'
            }
        },
        getDisplayChar: function(params) {
            // NEW: Show a different char if disabled
            if (params.initial_state === 'disabled') {
                return 'x';
            }
            switch (params.direction) {
                case 'up': return '/\\';
                case 'down': return '\\/';
                case 'left': return '<';
                case 'right': '>';
                default: return '>';
            }
        }
    },
    // --- NEW: Button Block ---
    button: {
        id: 'button',
        name: 'Button',
        char: 'B',
        color: '#ffff00', // Yellow like doors/arrows
        renderPriority: 4,
        command_multiplier: 2,
        isMobile: false,
        parameters: {
            // This parameter is special and will be handled by custom editor UI
            linked_positions: {
                label: 'Linked Positions',
                type: 'positions_array', // Custom type for editor logic
                default: []
            }
        },
        getDisplayChar: function(params) {
            return 'B';
        }
    }
};