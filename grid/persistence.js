const Progress = {
    // The key for storing data in localStorage
    STORAGE_KEY: 'digital_operator_progress',

    /**
     * Retrieves all progress data from localStorage.
     * @returns {object} The progress data object.
     */
    getData: function() {
        const data = localStorage.getItem(this.STORAGE_KEY);
        return data ? JSON.parse(data) : {};
    },

    /**
     * Saves the provided data object to localStorage.
     * @param {object} data The progress data to save.
     */
    saveData: function(data) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    },

    /**
     * Records a level completion and updates the best time if it's better.
     * @param {number} levelNumber - The 1-based level number that was completed.
     * @param {number} timeInTicks - The number of ticks it took to complete.
     */
    saveLevelCompletion: function(levelNumber, timeInTicks) {
        const allProgress = this.getData();
        const levelKey = `level_${levelNumber}`;
        const levelData = allProgress[levelKey] || { completed: false, bestTime: null };

        levelData.completed = true;

        if (levelData.bestTime === null || timeInTicks < levelData.bestTime) {
            console.log(`New best time for level ${levelNumber}: ${timeInTicks} ticks.`);
            levelData.bestTime = timeInTicks;
        }

        allProgress[levelKey] = levelData;
        this.saveData(allProgress);
    },

    /**
     * Gets the progress for a specific level.
     * @param {number} levelNumber - The 1-based level number.
     * @returns {object} An object with { completed, bestTime } or nulls.
     */
    getLevelProgress: function(levelNumber) {
        const allProgress = this.getData();
        const levelKey = `level_${levelNumber}`;
        return allProgress[levelKey] || { completed: false, bestTime: null };
    }
};