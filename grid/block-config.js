const BLOCK_TYPES = {
    // --- Special block for erasing ---
    erase: { id: null, name: 'Erase', char: '', color: '#ffffff', command_multiplier: 1 },

    // --- Gameplay blocks ---
    wall: {
        id: 'wall',
        name: 'Wall',
        char: '▓',
        color: '#00ff00',
        command_multiplier: 2 // Walls are expensive to modify
    },
    data: {
        id: 'data',
        name: 'Data Node',
        char: 'Φ',
        color: '#00ffff',
        command_multiplier: 5 // Data is critical and very expensive
    },
    door: {
        id: 'door',
        name: 'Door',
        char: 'D',
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