// --- WORKER SCRIPT: generation.worker.js ---

// 1. Dependencies (now includes lighting constants)
let WORLD_SEED = 0;
// Basic constants, must match index.html
const CHUNK_SIZE = 16;
const CHUNK_SIZE_SQ = 16 * 16;
const SECTOR_SIZE = 512;

const MAT = {
    EMPTY: 0, ROCK_WALL: 1, SAND: 2, WATER: 3, SOIL: 4, 
    WOOD: 10, FIRE: 11, GUNPOWDER: 12, GUNPOWDER_IGNITED: 13,
    OIL: 14, OIL_BURNING: 15,
    COAL:16, COAL_BURNING:17,
    ACID:18, GLASS:19, GLASS_WALL: 20,
    ADAMANTIUM: 21, COPPER: 22, SILVER: 23, GOLD: 24, PLATINUM: 25, RUNE_WALL: 26,
    SANDSTONE_WALL: 27, VOLCANIC_WALL: 28, LABYRINTH_WALL: 29, MAGIC_WALL: 30,
    // --- START OF NEW MATERIALS ---
    GROUND: 31, IRON: 32, RUSTED_IRON: 33, OBSIDIAN: 34,
    LAVA: 40, 
    STEAM: 50, SMOKE: 51, METHANE: 52, METHANE_BURNING: 53,
    // --- END OF NEW MATERIALS ---
};

// Rune definitions for set pieces, must match index.html
const DWARVEN_RUNES = {
    RUNE_HEIGHT: 9,
};
const MAX_LIGHT_LEVEL = 30;
const WALL_TYPES = new Set([MAT.ROCK_WALL, MAT.SANDSTONE_WALL, MAT.VOLCANIC_WALL, MAT.LABYRINTH_WALL, MAT.MAGIC_WALL]);

const PerlinNoise = {
    p: [],
    seed: function(s) {
        let random = (() => { let sd=s; return () => (sd=(sd*9301+49297)%233280)/233280; })();
        this.p = new Uint8Array(512); let perm = [];
        for (let i=0;i<256;i++) perm.push(i);
        for (let i=perm.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [perm[i],perm[j]]=[perm[j],perm[i]]; }
        for (let i=0;i<256;i++) this.p[i] = this.p[i+256] = perm[i];
    },
    fade: t => t*t*t*(t*(t*6-15)+10),
    lerp: (t,a,b) => a+t*(b-a),
    grad: function(h,x,y,z) {
        let u = h < 8 ? x : y;
        let v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    },
    noise: function(x, y, z = 0) {
        let X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
        x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
        let u = this.fade(x), v = this.fade(y), w = this.fade(z);
        let A = this.p[X] + Y, AA = this.p[A] + Z, AB = this.p[A + 1] + Z;
        let B = this.p[X + 1] + Y, BA = this.p[B] + Z, BB = this.p[B + 1] + Z;
        return this.lerp(w,
            this.lerp(v,
                this.lerp(u, this.grad(this.p[AA], x, y, z), this.grad(this.p[BA], x - 1, y, z)),
                this.lerp(u, this.grad(this.p[AB], x, y - 1, z), this.grad(this.p[BB], x - 1, y - 1, z))
            ),
            this.lerp(v,
                this.lerp(u, this.grad(this.p[AA + 1], x, y, z - 1), this.grad(this.p[BA + 1], x - 1, y, z - 1)),
                this.lerp(u, this.grad(this.p[AB + 1], x, y - 1, z - 1), this.grad(this.p[BB + 1], x - 1, y - 1, z - 1))
            )
        );
    }
};

// --- START OF NEW HELPER FUNCTION ---
/**
 * Returns the appropriate wall material for a given biome layer index.
 * @param {number} layer - The layer index (0-4).
 * @returns {number} The material ID for the wall.
 */
function getLayerMaterial(layer) {
    switch (layer) {
        case 0: return MAT.SANDSTONE_WALL;
        case 1: return MAT.ROCK_WALL;
        case 2: return MAT.VOLCANIC_WALL;
        case 3: return MAT.LABYRINTH_WALL;
        case 4: return MAT.MAGIC_WALL;
        default: return MAT.ROCK_WALL;
    }
}
// --- END OF NEW HELPER FUNCTION ---

// 2. Worker-local helpers
const getLocalIndex = (lx, ly) => ly * CHUNK_SIZE + lx;

/**
 * Converts 2D coordinates to a single unique numeric key.
 */
function coordToKey(x, y) {
    return x * 374761393 + y * 668265263;
}

/**
 * Gets a chunk from a given map, creating it if it doesn't exist.
 * This is a simplified version for the worker's needs.
 */
function getChunk(map, key, fillValue = 0) {
    if (!map.has(key)) {
        const newChunk = {
            key: key,
            data: new Uint8Array(CHUNK_SIZE_SQ).fill(fillValue),
            // cx, cy will be added by setGrid when the chunk is first modified
        };
        map.set(key, newChunk);
        return newChunk;
    }
    return map.get(key);
}

/**
 * Sets a pixel's material type within a specific map (e.g., the temporary terrainMap).
 * @param {number} x - The global world X coordinate.
 * @param {number} y - The global world Y coordinate.
 * @param {number} type - The material type to set.
 * @param {Map} map - The map (terrainMap or lightMap) to modify.
 */
function setGrid(x, y, type, map) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const key = coordToKey(cx, cy);
    
    const chunk = getChunk(map, key, MAT.EMPTY);

    // If this is the first time we're touching this chunk, store its coordinates.
    if (chunk.cx === undefined) {
        chunk.cx = cx;
        chunk.cy = cy;
    }

    const lx = x & (CHUNK_SIZE - 1);
    const ly = y & (CHUNK_SIZE - 1);
    const lIdx = ly * CHUNK_SIZE + lx;

    chunk.data[lIdx] = type;
}

const SetPieceGenerators = {
    AlchemistStation: {
        generate: function(worldX, worldY, bounds) {
            const localX = worldX - bounds.x;
            const localY = worldY - bounds.y;

            if (localX < 0 || localX >= bounds.width || localY < 0 || localY >= bounds.height) {
                return null;
            }

            // --- 1. Define Geometry and Constants ---
            const wallThickness = 12;
            const roomPadding = 40;
            const entranceHeight = 60;

            const room = {
                // Outer bounds of the wall
                outerX1: roomPadding,
                outerY1: 50,
                outerX2: bounds.width - roomPadding,
                outerY2: bounds.height, // Floor is part of the wall structure
                // Inner bounds (the empty space)
                innerX1: roomPadding + wallThickness,
                innerY1: 50 + wallThickness,
                innerX2: bounds.width - roomPadding - wallThickness,
                innerY2: bounds.height - wallThickness
            };
            const entranceTopY = room.innerY2 - entranceHeight;

            // --- 2. Draw Floor, Walls, and Entrances ---
            const isInsideOuterBox = (localX >= room.outerX1 && localX <= room.outerX2 && localY >= room.outerY1 && localY <= room.outerY2);
            const isInsideInnerBox = (localX >= room.innerX1 && localX <= room.innerX2 && localY >= room.innerY1 && localY <= room.innerY2);
            const isEntrance = (localY > entranceTopY && (localX < room.innerX1 || localX > room.innerX2));

            if (isInsideOuterBox && !isInsideInnerBox && !isEntrance) {
                return MAT.ADAMANTIUM; // This is a wall pixel
            }

            // --- 3. Draw Internal Structures (Slab and Cauldrons) ---
            if (isInsideInnerBox) {
                // If we are inside the room, check for structures.
                // The default for this area is MAT.EMPTY.

                // A. The Runic Slab
                const slabW = 70;
                const slabH = 15;
                const slabX = 130;
                const slabY = room.innerY2 - slabH + 1; // Sits on the floor

                if (localX >= slabX && localX < slabX + slabW && localY >= slabY && localY < slabY + slabH) {
                    const linePad = 2; // How far from the edges the lines are
                    const topLineY = slabY + linePad;
                    const botLineY = slabY + slabH - 1 - linePad;
                    
                    // Draw horizontal lines
                    if (localY === topLineY || localY === botLineY) {
                        return MAT.RUNE_WALL;
                    }
                    // Draw runic texture on the face
                    if (localY > topLineY && localY < botLineY) {
                         // Simple hash creates a pseudo-random pattern
                        let h = (localX * 374761393 + localY * 668265263);
                        h = (h^(h>>13))*1274126177;
                        if (((h^(h>>16))&0xff) > 220) {
                             return MAT.RUNE_WALL;
                        }
                    }
                    return MAT.ADAMANTIUM; // The rest of the slab is adamantium
                }

                // B. The Cauldrons
                const cauldronR = 32, cauldronT = 4, cauldronInnerR = cauldronR - cauldronT;
                const samplerR = 16, samplerT = 4, samplerInnerR = samplerR - samplerT;
                
                // Position the rim of the cauldrons just above the floor
                const cauldronRimY = room.innerY2 - 28; 
                const samplerRimY = room.innerY2 - 12;
                
                const leftCX = 260, rightCX = 390, samplerCX = 325;

                // Only draw the parts of the circle that are above the rimY and floor
                if (localY >= cauldronRimY && localY <= room.innerY2) {
                     if (Math.hypot(localX - leftCX, localY - cauldronRimY) <= cauldronR && Math.hypot(localX - leftCX, localY - cauldronRimY) > cauldronInnerR) return MAT.RUNE_WALL;
                     if (Math.hypot(localX - rightCX, localY - cauldronRimY) <= cauldronR && Math.hypot(localX - rightCX, localY - cauldronRimY) > cauldronInnerR) return MAT.RUNE_WALL;
                }
                if (localY >= samplerRimY && localY <= room.innerY2) {
                     if (Math.hypot(localX - samplerCX, localY - samplerRimY) <= samplerR && Math.hypot(localX - samplerCX, localY - samplerRimY) > samplerInnerR) return MAT.RUNE_WALL;
                }

                // If not part of any structure, the space inside the room is empty
                return MAT.EMPTY;
            }

            // If the pixel is not a wall and not inside the room, it's not part of the set piece.
            return null;
        }
    }
};

function bakeLightingForSector(sectorX, sectorY, terrainMap, borderContext) {
    const lightMap = new Map();

    // --- START OF FIX ---
    // Corrected helper functions that treat borderContext as a plain object.
    const getGrid = (x, y) => {
        const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE), key = coordToKey(cx, cy);
        if (terrainMap.has(key)) {
            const chunk = terrainMap.get(key);
            const lx = x - cx * CHUNK_SIZE, ly = y - cy * CHUNK_SIZE;
            return chunk.data[getLocalIndex(lx, ly)];
        }
        // Use bracket notation for the plain object
        const borderPixel = borderContext[coordToKey(x, y)];
        return borderPixel ? borderPixel.terrain : MAT.EMPTY;
    };
    const getLight = (map, x, y) => {
        const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE), key = coordToKey(cx, cy);
        if (map.has(key)) {
            const chunk = map.get(key);
            const lx = x - cx * CHUNK_SIZE, ly = y - cy * CHUNK_SIZE;
            return chunk.data[getLocalIndex(lx, ly)];
        }
        // Use bracket notation for the plain object
        const borderPixel = borderContext[coordToKey(x, y)];
        return borderPixel ? borderPixel.light : 0;
    };
    // --- END OF FIX ---

    const setLight = (map, x, y, value) => {
        const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE), key = coordToKey(cx, cy);
        let chunkPayload;
        if (!map.has(key)) {
            chunkPayload = { data: new Uint8Array(CHUNK_SIZE_SQ).fill(0), cx: cx, cy: cy };
            map.set(key, chunkPayload);
        } else {
            chunkPayload = map.get(key);
        }
        const lx = x - cx * CHUNK_SIZE, ly = y - cy * CHUNK_SIZE;
        chunkPayload.data[getLocalIndex(lx, ly)] = value;
    };

    const startX = sectorX * SECTOR_SIZE, startY = sectorY * SECTOR_SIZE, endX = startX + SECTOR_SIZE, endY = startY + SECTOR_SIZE;

    // The rest of the baking logic remains the same.
    // Step 1: Initial Seeding
    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            let initialLight = (getGrid(x, y) === MAT.EMPTY) ? MAX_LIGHT_LEVEL : 0;
            const DIRS_8 = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
            for (const dir of DIRS_8) {
                const nX = x + dir[0], nY = y + dir[1];
                const lightLoss = WALL_TYPES.has(getGrid(x, y)) ? 3 : 1;
                initialLight = Math.max(initialLight, getLight(lightMap, nX, nY) - lightLoss);
            }
            if(initialLight > 0) setLight(lightMap, x, y, initialLight);
        }
    }
    // Step 2: Pass 1 (Top-down)
    for (let y = startY; y < endY; y++) for (let x = startX; x < endX; x++) {
        const currentLight = getLight(lightMap, x, y);
        const lightLoss = WALL_TYPES.has(getGrid(x, y)) ? 3 : 1;
        const newLight = Math.max(currentLight, getLight(lightMap, x, y-1)-lightLoss, getLight(lightMap, x-1, y)-lightLoss);
        if (newLight > currentLight) setLight(lightMap, x, y, newLight);
    }
    // Step 3: Pass 2 (Bottom-up)
    for (let y = endY-1; y >= startY; y--) for (let x = endX-1; x >= startX; x--) {
        const currentLight = getLight(lightMap, x, y);
        const lightLoss = WALL_TYPES.has(getGrid(x, y)) ? 3 : 1;
        const newLight = Math.max(currentLight, getLight(lightMap, x, y+1)-lightLoss, getLight(lightMap, x+1, y)-lightLoss);
        if (newLight > currentLight) setLight(lightMap, x, y, newLight);
    }
    
    return lightMap;
}


// 4. Main message handler
self.onmessage = (event) => {
    // Destructure all possible properties from the event data at the top
    const { type, seed, sx, sy, borderContext, biomeInfo, setPieces } = event.data;

    if (type === 'init') {
        WORLD_SEED = seed; // Note: 'seed' is the correct property name from the event data
        //console.log("init:" + WORLD_SEED)
        PerlinNoise.seed(WORLD_SEED);
        self.postMessage({ type: 'init-ack' });
        return;
    }

    if (type === 'generate-and-bake') {
        // This map will be populated with the newly generated terrain data
        const terrainMap = new Map();
        //console.log("Generate and bake", event.data)
        const startX = sx * SECTOR_SIZE;
        const startY = sy * SECTOR_SIZE;

        // Main generation loop for every pixel in the sector
        for (let y = 0; y < SECTOR_SIZE; y++) {
            for (let x = 0; x < SECTOR_SIZE; x++) {
                const worldX = startX + x;
                const worldY = startY + y;
                
                let finalTerrainType = MAT.EMPTY;
                let setPieceRendered = false;

                // --- PRIORITY 1: Render Set Pieces ---
                // Check if any set pieces overlap with this pixel.
                if (setPieces && setPieces.length > 0) {
                    for (const piece of setPieces) {
                        const generator = SetPieceGenerators[piece.name];
                        if (generator) {
                            const pieceMaterial = generator.generate(worldX, worldY, piece.bounds);
                            // If the generator returns a material, use it and stop checking other pieces.
                            if (pieceMaterial !== null) {
                                finalTerrainType = pieceMaterial;
                                setPieceRendered = true;
                                break; 
                            }
                        }
                    }
                }

                // --- PRIORITY 2: Generate Biome Terrain ---
                // If no set piece rendered a pixel here, generate the underlying biome.
                if (!setPieceRendered) {
                    switch (biomeInfo.name) {
                        case "Caves":
                            finalTerrainType = generateCavesPixel(worldX, worldY, biomeInfo.params);
                            break;
                        
                        case "OceanOfRock":
                        default:
                            // The default biome for any area outside a defined region.
                            finalTerrainType = MAT.ROCK_WALL;
                            break;
                    }
                }
                
                // Set the final calculated material into our temporary terrain map.
                setGrid(worldX, worldY, finalTerrainType, terrainMap);
            }
        }
        
        // --- Post-Generation Processing ---

        // Use the newly generated terrain to bake the lighting information.
        const lightMap = bakeLightingForSector(sx, sy, terrainMap, borderContext);
        
        // Prepare terrain data for efficient transfer back to the main thread.
        const transferableChunks = [];
        const terrainBuffers = [];
        for (const [key, payload] of terrainMap.entries()) {
            transferableChunks.push([key, payload]);
            terrainBuffers.push(payload.data.buffer);
        }

        // Prepare light data for efficient transfer.
        const transferableLightChunks = [];
        const lightBuffers = [];
        for (const [key, payload] of lightMap.entries()) {
            transferableLightChunks.push([key, payload]);
            lightBuffers.push(payload.data.buffer);
        }

        // Send the complete result back to the main thread.
        self.postMessage({
            type: 'result',
            sx: sx,
            sy: sy,
            chunks: transferableChunks,
            lightChunks: transferableLightChunks,
        }, [...terrainBuffers, ...lightBuffers]); // Transfer all data buffers for performance
    }
};

/**
 * Generates a single terrain pixel for the Caves biome, now including thick, noisy barriers.
 * @param {number} x - The global world X coordinate.
 * @param {number} y - The global world Y coordinate.
 * @param {object} params - Biome-specific parameters, like the layer and biome bounds.
 * @returns {number} The material ID (e.g., MAT.EMPTY or a wall type).
 */
function generateCavesPixel(x, y, params) {
    const { layer, bounds } = params;
    const layerMaterial = getLayerMaterial(layer);

    // --- 1. Define Barrier Parameters ---
    const BARRIER_THICKNESS = 100;
    const CEILING_NOISE_FREQUENCY = 0.01;
    const CEILING_NOISE_AMPLITUDE = 25; // How much the ceiling height varies

    // --- 2. Check for and Generate Vertical Side Walls ---
    const biomeStartX = bounds.x1 * SECTOR_SIZE;
    // We add 1 to x2 because the bounds are inclusive sector indices
    const biomeEndX = (bounds.x2 + 1) * SECTOR_SIZE; 
    
    if (x < biomeStartX + BARRIER_THICKNESS || x > biomeEndX - BARRIER_THICKNESS) {
        return layerMaterial;
    }

    // --- 3. Check for and Generate Horizontal Layer Ceilings ---
    if (layer > 0) {
        const sectorsPerLayer = 5;
        const layerTopY = (bounds.y1 * SECTOR_SIZE) + (layer * sectorsPerLayer * SECTOR_SIZE);
        
        // Use Perlin noise to make the ceiling uneven
        const noiseOffset = PerlinNoise.noise(x * CEILING_NOISE_FREQUENCY, 42.5) * CEILING_NOISE_AMPLITUDE;
        const ceilingEffectiveY = layerTopY + noiseOffset;

        if (y > ceilingEffectiveY && y < ceilingEffectiveY + BARRIER_THICKNESS) {
            return layerMaterial;
        }
    }

    // --- 4. If not a barrier, generate the cave interior using fractal noise ---
    const config = {
        baseFrequency: 0.006,
        octaves: 2,
        lacunarity: 2.0,
        persistence: 0.5,
        warpFrequency: 0.005,
        warpStrength: 40.0,
        threshold: 0.49
    };

    const qx = PerlinNoise.noise(x * config.warpFrequency, y * config.warpFrequency, 100.5);
    const qy = PerlinNoise.noise(x * config.warpFrequency, y * config.warpFrequency, 100.5);
    const warpedX = x + (qx * config.warpStrength);
    const warpedY = y + (qy * config.warpStrength);

    let totalNoise = 0;
    let frequency = config.baseFrequency;
    let amplitude = 1.0;
    let maxAmplitude = 0;

    for (let i = 0; i < config.octaves; i++) {
        totalNoise += PerlinNoise.noise(warpedX * frequency, warpedY * frequency, 0) * amplitude;
        maxAmplitude += amplitude;
        amplitude *= config.persistence;
        frequency *= config.lacunarity;
    }

    const normalizedNoise = (totalNoise / maxAmplitude + 1) / 2;

    // Use the determined layer material if the pixel is solid
    return (normalizedNoise > config.threshold) ? MAT.EMPTY : layerMaterial;
}