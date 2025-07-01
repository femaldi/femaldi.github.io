const COMMAND_TYPES = {
    delete: {
        id: 'delete',
        name: 'DELETE',
        shortName: 'DEL',
        targetCount: 1,
        description: 'Select 1 tile to delete.',
        cost: 2,
        level_enabled: 1,
        system_reset: true
    },
    copy: {
        id: 'copy',
        name: 'COPY',
        shortName: 'CPY',
        targetCount: 2,
        description: 'Select source, then destination.',
        cost: 2,
        level_enabled: 1,
        system_reset: true
    },
    // --- CONSOLIDATED WAIT COMMAND ---
    wait: {
        id: 'wait',
        name: 'WAIT',
        shortName: 'WT', // Base short name
        targetCount: 0,
        description: 'Pauses execution for a set number of ticks.',
        level_enabled: 2,
        system_reset: false,
        // New property for selectable options
        options: [
            { duration: 2,  cost: 1 },
            { duration: 4,  cost: 2 },
            { duration: 8,  cost: 3 },
            { duration: 16, cost: 4 }
        ]
    }
    // The individual wait2, wait4, etc. commands are now removed.
};