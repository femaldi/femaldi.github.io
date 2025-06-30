const COMMAND_TYPES = {
    delete: {
        id: 'delete',
        name: 'DELETE',
        shortName: 'DEL', // New property for the buffer bar
        targetCount: 1,
        description: 'Select 1 tile to delete.',
        cost: 2
    },
    copy: {
        id: 'copy',
        name: 'COPY',
        shortName: 'CPY', // New property for the buffer bar
        targetCount: 2,
        description: 'Select source, then destination.',
        cost: 2
    }
};