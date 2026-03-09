// --- WORKER SCRIPT: generation.worker.js ---
// This worker generates game world sectors. It uses a layered approach:
// 1. Scaled Wang Tiles generate a blocky base structure.
// 2. A smoothing pass is applied to bevel corners and create a natural look.
// 3. Hand-crafted Set Pieces are stamped on top by clearing their area.

// ====================================================================================
// SECTION 1: CORE DEPENDENCIES & CONSTANTS
// ====================================================================================

let WORLD_SEED = 0;

const CHUNK_SIZE = 16;
const CHUNK_SIZE_SQ = 16 * 16;
const SECTOR_SIZE = 512;
const MAX_LIGHT_LEVEL = 30;

const WANG_TILE_SCALE = 15;

// Hardcoded MAT object from the main game
const MAT = {
    EMPTY: 0,
    ROCK_WALL: 1,
    SAND: 2,
    WATER: 3,
    SOIL: 4,
    WOOD: 10,
    FIRE: 11,
    GUNPOWDER: 12,
    GUNPOWDER_IGNITED: 13,
    OIL: 14,
    OIL_BURNING: 15,
    COAL: 16,
    COAL_BURNING: 17,
    ACID: 18,
    GLASS: 19,
    GLASS_WALL: 20,
    ADAMANTIUM: 21,
    COPPER: 22,
    SILVER: 23,
    GOLD: 24,
    PLATINUM: 25,
    RUNE_WALL: 26,
    SANDSTONE_WALL: 27,
    VOLCANIC_WALL: 28,
    LABYRINTH_WALL: 29,
    MAGIC_WALL: 30,
    GROUND: 31,
    IRON: 32,
    RUSTED_IRON: 33,
    OBSIDIAN: 34,
    LAVA: 40,
    STEAM: 50,
    SMOKE: 51,
    METHANE: 52,
    METHANE_BURNING: 53,
    SEALANT: 98,
    RIGID_BODY_STUB: 99,
};

const WALL_TYPES = new Set([
    MAT.ROCK_WALL, MAT.SANDSTONE_WALL, MAT.VOLCANIC_WALL,
    MAT.LABYRINTH_WALL, MAT.MAGIC_WALL
]);

const LAYER_WALL_MATERIALS = [
    MAT.SANDSTONE_WALL, // Layer 0
    MAT.ROCK_WALL,      // Layer 1 (Default)
    MAT.VOLCANIC_WALL,  // Layer 2
    MAT.LABYRINTH_WALL, // Layer 3
    MAT.MAGIC_WALL      // Layer 4
];

// Perlin Noise object, used for backgrounds
const PerlinNoise = {
    p: [],
    seed: function(s) {
        let random = (() => {
            let sd = s;
            return () => (sd = (sd * 9301 + 49297) % 233280) / 233280;
        })();
        this.p = new Uint8Array(512);
        let perm = [];
        for (let i = 0; i < 256; i++) perm.push(i);
        for (let i = perm.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [perm[i], perm[j]] = [perm[j], perm[i]];
        }
        for (let i = 0; i < 256; i++) this.p[i] = this.p[i + 256] = perm[i];
    },
    fade: t => t * t * t * (t * (t * 6 - 15) + 10),
    lerp: (t, a, b) => a + t * (b - a),
    grad: function(h, x, y, z) {
        let u = h < 8 ? x : y,
            v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    },
    noise: function(x, y, z = 0) {
        let X = Math.floor(x) & 255,
            Y = Math.floor(y) & 255,
            Z = Math.floor(z) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);
        let u = this.fade(x),
            v = this.fade(y),
            w = this.fade(z);
        let A = this.p[X] + Y,
            AA = this.p[A] + Z,
            AB = this.p[A + 1] + Z,
            B = this.p[X + 1] + Y,
            BA = this.p[B] + Z,
            BB = this.p[B + 1] + Z;
        return this.lerp(w, this.lerp(v, this.lerp(u, this.grad(this.p[AA], x, y, z), this.grad(this.p[BA], x - 1, y, z)), this.lerp(u, this.grad(this.p[AB], x, y - 1, z), this.grad(this.p[BB], x - 1, y - 1, z))), this.lerp(v, this.lerp(u, this.grad(this.p[AA + 1], x, y, z - 1), this.grad(this.p[BA + 1], x - 1, y, z - 1)), this.lerp(u, this.grad(this.p[AB + 1], x, y - 1, z - 1), this.grad(this.p[BB + 1], x - 1, y - 1, z - 1))));
    }
};

// Helper functions for coordinates and chunk data
let currentSectorSX, currentSectorSY;
const getLocalIndex = (lx, ly) => ly * CHUNK_SIZE + lx;

function coordToKey(x, y) {
    return x * 374761393 + y * 668265263;
}

function getChunk(map, key, fillValue = 0) {
    if (!map.has(key)) {
        const newChunk = {
            key: key,
            data: new Uint8Array(CHUNK_SIZE_SQ).fill(fillValue)
        };
        map.set(key, newChunk);
        return newChunk;
    }
    return map.get(key);
}

function setGrid(x, y, type, map) {
    const pixelSectorX = Math.floor(x / SECTOR_SIZE);
    const pixelSectorY = Math.floor(y / SECTOR_SIZE);
    if (pixelSectorX !== currentSectorSX || pixelSectorY !== currentSectorSY) {
        return;
    }
    const cx = Math.floor(x / CHUNK_SIZE),
        cy = Math.floor(y / CHUNK_SIZE),
        key = coordToKey(cx, cy),
        chunk = getChunk(map, key, MAT.EMPTY);
    if (chunk.cx === undefined) {
        chunk.cx = cx;
        chunk.cy = cy;
    }
    const lx = x & (CHUNK_SIZE - 1),
        ly = y & (CHUNK_SIZE - 1);
    chunk.data[getLocalIndex(lx, ly)] = type;
}

// ====================================================================================
// SECTION 2: WANG TILE GENERATOR LOGIC
// ====================================================================================

function cyrb128(str) {
    let h1 = 1779033703,
        h2 = 3144134277,
        h3 = 1013904242,
        h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
        k = str.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

function sfc32(a, b, c, d) {
    return function() {
        a >>>= 0;
        b >>>= 0;
        c >>>= 0;
        d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ b >>> 9;
        b = c + (c << 3) | 0;
        c = (c << 21 | c >>> 11);
        d = d + 1 | 0;
        t = t + d | 0;
        c = c + t | 0;
        return (t >>> 0) / 4294967296;
    }
}

function prng_create(seed) {
    return function(x, y) {
        const coordSeed = `${seed},${x},${y}`;
        const seedArr = cyrb128(coordSeed);
        const rng = sfc32(seedArr[0], seedArr[1], seedArr[2], seedArr[3]);
        return rng();
    }
}

function rgbToHex(val) {
    let hex = Number(val).toString(16);
    return hex.length < 2 ? '0' + hex : hex;
}

function fullColorHex(r, g, b) {
    return rgbToHex(r) + rgbToHex(g) + rgbToHex(b);
}
const TILESET = 'inside.png';
let COLOR_TO_MAT_MAP = new Map();
function rgbArrayToHex(rgb) {
    return ((1 << 24) + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]).toString(16).slice(1);
}

function initializeColorMap(colorsObject) {
    COLOR_TO_MAT_MAP.clear();
    for (const matId in colorsObject) {
        const key = parseInt(matId, 10);
        const rgbArray = colorsObject[key];
        const hexString = rgbArrayToHex(rgbArray);
        COLOR_TO_MAT_MAP.set(hexString, key);
    }
    
    // Add the special overrides for the tileset mapping.
    // This ensures these two colors always map to these specific materials.
    COLOR_TO_MAT_MAP.set('000000', MAT.EMPTY);
    // 'ffffff' will be handled dynamically based on biome layer.
    
    console.log("[WORKER] Color map initialized from main thread data.");
}
// const COLOR_TO_MAT_MAP = new Map([
//     ['000000', MAT.EMPTY],
//     ['ffffff', MAT.ROCK_WALL],
//     ['855e34', MAT.GROUND],
//     ['7a7a7a', MAT.IRON],
//     ['ff6000', MAT.SAND],
//     ['8b4513', MAT.WOOD],
//     ['4d5257', MAT.ADAMANTIUM],
//     ['c8c864', MAT.RUNE_WALL],
//     ['c8c864', MAT.IRON],
//     ['c8c864', MAT.RUSTED_IRON],
// ]);
let DEFAULT_MAT = MAT.ROCK_WALL;
let wangIsInitialized = false,
    rng, num_tiles_h_x, num_tiles_h_y, num_tiles_v_x, num_tiles_v_y, tileSize, tileInfos = {
        horizontal: {},
        vertical: {}
    },
    tilesetImageData, tilesetImageWidth, tilesetImageHeight;

function getPixelDataFromImage(imageData, x, y, imageWidth) {
    const i = (y * imageWidth + x) * 4;
    return [imageData[i], imageData[i + 1], imageData[i + 2], imageData[i + 3]];
}

function parseTilesetData(imgData, imgWidth, imgHeight) {
    let tileSize = -2,
        count_h_x = 0,
        count_h_y = 0,
        count_v_x = 0,
        count_v_y = 0,
        currentPixel = 2;
    while (currentPixel <= imgHeight) {
        const [r, g, b] = getPixelDataFromImage(imgData, 0, currentPixel, imgWidth);
        if (fullColorHex(r, g, b) === 'ffffff') break;
        tileSize++;
        currentPixel++;
    }
    currentPixel = 2;
    let prevColor = '';
    while (currentPixel <= imgHeight) {
        const [r, g, b] = getPixelDataFromImage(imgData, 0, currentPixel, imgWidth), color = fullColorHex(r, g, b);
        if (color === 'ffffff') {
            if (prevColor === 'ffffff') {
                currentPixel += 2;
                break;
            }
            count_h_y++;
        }
        prevColor = color;
        currentPixel++;
    }
    while (currentPixel <= imgHeight) {
        const [r, g, b] = getPixelDataFromImage(imgData, 0, currentPixel, imgWidth);
        if (fullColorHex(r, g, b) === 'ffffff') count_v_y++;
        currentPixel++;
    }
    currentPixel = 0;
    prevColor = '';
    while (currentPixel <= imgWidth) {
        const [r, g, b] = getPixelDataFromImage(imgData, currentPixel, 2, imgWidth), color = fullColorHex(r, g, b);
        if (color === 'ffffff') {
            if (prevColor === 'ffffff') break;
            count_h_x++;
        }
        prevColor = color;
        currentPixel++;
    }
    currentPixel = 0;
    prevColor = '';
    const vertical_tiles_y_offset = (tileSize + 3) * count_h_y + 4;
    while (currentPixel <= imgWidth) {
        const [r, g, b] = getPixelDataFromImage(imgData, currentPixel, vertical_tiles_y_offset, imgWidth), color = fullColorHex(r, g, b);
        if (color === 'ffffff') {
            if (prevColor === 'ffffff') break;
            count_v_x++;
        }
        prevColor = color;
        currentPixel++;
    }
    return {
        tileSize,
        count_h_x,
        count_h_y,
        count_v_x,
        count_v_y
    };
}

function tilePosToPixelCoordinates(tx, ty, horizontal) {
    let x, y;
    if (horizontal) {
        x = tx * tileSize * 2 + 3 * tx;
        y = ty * tileSize + 3 * ty + 2;
    } else {
        const offset_vertical_tiles_start = num_tiles_h_y * (tileSize + 3) + 4;
        x = tx * tileSize + 3 * tx;
        y = ty * tileSize * 2 + 3 * ty + offset_vertical_tiles_start;
    }
    return {
        x,
        y
    };
}

function getTileInfo(tx, ty, horizontal) {
    const points_h = {
            edges: {
                topLeft: {
                    x: Math.floor(tileSize * 0.5),
                    y: 0
                },
                topRight: {
                    x: Math.floor(tileSize * 1.5),
                    y: 0
                },
                left: {
                    x: 0,
                    y: Math.floor(tileSize * 0.5)
                },
                right: {
                    x: tileSize * 2 + 1,
                    y: Math.floor(tileSize * 0.5)
                },
                bottomLeft: {
                    x: Math.floor(tileSize * 0.5),
                    y: tileSize + 1
                },
                bottomRight: {
                    x: Math.floor(tileSize * 1.5),
                    y: tileSize + 1
                },
            }
        },
        points_v = {
            edges: {
                topLeft: {
                    x: 0,
                    y: Math.floor(tileSize * 0.5)
                },
                top: {
                    x: Math.floor(tileSize * 0.5),
                    y: 0
                },
                topRight: {
                    x: tileSize + 1,
                    y: Math.floor(tileSize * 0.5)
                },
                bottomLeft: {
                    x: 0,
                    y: Math.floor(tileSize * 1.5)
                },
                bottom: {
                    x: Math.floor(tileSize * 0.5),
                    y: tileSize * 2 + 1
                },
                bottomRight: {
                    x: tileSize + 1,
                    y: Math.floor(tileSize * 1.5)
                },
            }
        },
        points = horizontal ? points_h : points_v,
        tileCoords = tilePosToPixelCoordinates(tx, ty, horizontal);
    for (const [key, value] of Object.entries(points.edges)) {
        const [r, g, b] = getPixelDataFromImage(tilesetImageData, tileCoords.x + value.x, tileCoords.y + value.y, tilesetImageWidth);
        points.edges[key] = fullColorHex(r, g, b);
    }
    return points;
}

function getValidTiles(constraints, type) {
    const validTiles = [];
    const max_x = type === 'horizontal' ? num_tiles_h_x : num_tiles_v_x,
        max_y = type === 'horizontal' ? num_tiles_h_y : num_tiles_v_y;
    for (let y = 0; y < max_y; y++) {
        for (let x = 0; x < max_x; x++) {
            const tileInfo = tileInfos[type][`${x}_${y}`];
            let failed = false;
            for (const [key, value] of Object.entries(constraints.edges)) {
                if (tileInfo.edges[key] !== value) {
                    failed = true;
                    break;
                }
            }
            if (!failed) validTiles.push({
                x,
                y
            });
        }
    }
    return validTiles;
}

function stampTileToGrid(destTileX, destTileY, srcTileX, srcTileY, isHorizontal, terrainMap) {
    const scaledTileSize = tileSize * WANG_TILE_SCALE;
    const destWorldX = destTileX * scaledTileSize;
    const destWorldY = destTileY * scaledTileSize;
    const srcPixelCoords = tilePosToPixelCoordinates(srcTileX, srcTileY, isHorizontal);
    const tileW = isHorizontal ? tileSize * 2 : tileSize;
    const tileH = isHorizontal ? tileSize : tileSize * 2;
    for (let py = 0; py < tileH; py++) {
        for (let px = 0; px < tileW; px++) {
            const srcX = srcPixelCoords.x + 1 + px;
            const srcY = srcPixelCoords.y + 1 + py;
            const [r, g, b] = getPixelDataFromImage(tilesetImageData, srcX, srcY, tilesetImageWidth);
            const colorHex = fullColorHex(r, g, b);
            const material = COLOR_TO_MAT_MAP.get(colorHex) ?? DEFAULT_MAT;
            const blockStartX = destWorldX + px * WANG_TILE_SCALE;
            const blockStartY = destWorldY + py * WANG_TILE_SCALE;
            for (let i = 0; i < WANG_TILE_SCALE; i++) {
                for (let j = 0; j < WANG_TILE_SCALE; j++) {
                    setGrid(blockStartX + i, blockStartY + j, material, terrainMap);
                }
            }
        }
    }
}

// in generation.worker.js, near the other stamping functions

function stampSetPiece(piece, terrainMap) {
    const destWorldX = piece.bounds.x;
    const destWorldY = piece.bounds.y;

    if (piece.parsedData && piece.parsedData.pixels) {
        // 1. Erase the entire bounding box area first.
        for (let y = 0; y < piece.parsedData.height; y++) {
            for (let x = 0; x < piece.parsedData.width; x++) {
                setGrid(destWorldX + x, destWorldY + y, MAT.EMPTY, terrainMap);
            }
        }
        // 2. Stamp the actual set piece pixels.
        for (let y = 0; y < piece.parsedData.height; y++) {
            for (let x = 0; x < piece.parsedData.width; x++) {
                const pixelIndex = y * piece.parsedData.width + x;
                const pieceMaterial = piece.parsedData.pixels[pixelIndex];
                if (pieceMaterial !== -1) { // -1 means transparent/no-op
                    setGrid(destWorldX + x, destWorldY + y, pieceMaterial, terrainMap);
                }
            }
        }
    }
}

// in generation.worker.js

async function generateWangTileSector(sx, sy, terrainMap, setPieces, stampedPieces, allStampedTiles) {
    if (!wangIsInitialized) {
        console.log("[WORKER] Initializing Wang Tile generator...");
        const imageBlob = await fetch(TILESET).then(res => res.blob());
        const imageBitmap = await createImageBitmap(imageBlob);
        const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageBitmap, 0, 0);
        const imgData = ctx.getImageData(0, 0, imageBitmap.width, imageBitmap.height);
        tilesetImageData = imgData.data;
        tilesetImageWidth = imgData.width;
        tilesetImageHeight = imgData.height;
        const wangData = parseTilesetData(tilesetImageData, tilesetImageWidth, tilesetImageHeight);
        tileSize = wangData.tileSize;
        num_tiles_h_x = wangData.count_h_x;
        num_tiles_h_y = wangData.count_h_y;
        num_tiles_v_x = wangData.count_v_x;
        num_tiles_v_y = wangData.count_v_y;
        for (let y = 0; y < num_tiles_h_y; y++) {
            for (let x = 0; x < num_tiles_h_x; x++) {
                tileInfos.horizontal[`${x}_${y}`] = getTileInfo(x, y, true);
            }
        }
        for (let y = 0; y < num_tiles_v_y; y++) {
            for (let x = 0; x < num_tiles_v_x; x++) {
                tileInfos.vertical[`${x}_${y}`] = getTileInfo(x, y, false);
            }
        }
        rng = prng_create(WORLD_SEED.toString());
        wangIsInitialized = true;
        console.log("[WORKER] Wang Tile generator initialized.");
    }

    const setPieceTileMap = new Map();
    if (setPieces && setPieces.length > 0) {
        for (const piece of setPieces) {
            setPieceTileMap.set(`${piece.tx}_${piece.ty}`, piece);
        }
    }

    const mapData = {};
    const gridUnit = 22 * WANG_TILE_SCALE; // 330 pixels
    const startTileX = Math.floor(sx * SECTOR_SIZE / gridUnit) - 2;
    const startTileY = Math.floor(sy * SECTOR_SIZE / gridUnit) - 2;
    const endTileX = Math.ceil((sx + 1) * SECTOR_SIZE / gridUnit) + 2;
    const endTileY = Math.ceil((sy + 1) * SECTOR_SIZE / gridUnit) + 2;
    
    for (let y = startTileY; y < endTileY; y++) {
        for (let x = startTileX; x < endTileX; x++) {
            
            const piece = setPieceTileMap.get(`${x}_${y}`);
            if (piece) {
                stampSetPiece(piece, terrainMap);
                stampedPieces.push(piece);
                allStampedTiles.push({ x: piece.tx, y: piece.ty, isHorizontal: piece.tileType === 'horizontal' }); // RESTORED

                if (piece.tileType === 'horizontal') {
                    x++; 
                }
                continue;
            }

            const tileTypeCheck = (x - y) % 4;
            if (tileTypeCheck === 0) {
                const constraints = { edges: {} };
                if (mapData[`${x - 1}_${y}`]) constraints.edges.left = mapData[`${x - 1}_${y}`].right;
                if (mapData[`${x}_${y - 1}`]) constraints.edges.topLeft = mapData[`${x}_${y - 1}`].bottom;
                if (mapData[`${x + 1}_${y - 1}`]) constraints.edges.topRight = mapData[`${x + 1}_${y - 1}`].bottom;
                if (mapData[`${x + 2}_${y}`]) constraints.edges.right = mapData[`${x + 2}_${y}`].left;
                
                const validTiles = getValidTiles(constraints, 'horizontal');
                if (validTiles.length === 0) continue;
                
                const randomIndex = Math.floor(rng(x, y) * validTiles.length),
                    randomTile = validTiles[randomIndex],
                    tileInfo = tileInfos.horizontal[`${randomTile.x}_${randomTile.y}`];
                
                stampTileToGrid(x, y, randomTile.x, randomTile.y, true, terrainMap);
                allStampedTiles.push({ x, y, isHorizontal: true }); // RESTORED
                
                mapData[`${x}_${y}`] = { tilePos: randomTile, top: tileInfo.edges.topLeft, left: tileInfo.edges.left, bottom: tileInfo.edges.bottomLeft };
                mapData[`${x + 1}_${y}`] = { tilePos: randomTile, top: tileInfo.edges.topRight, right: tileInfo.edges.right, bottom: tileInfo.edges.bottomRight };
            }
            if (tileTypeCheck === 3 || tileTypeCheck === -1) {
                 const constraints = { edges: {} };
                if (mapData[`${x - 1}_${y}`]) constraints.edges.topLeft = mapData[`${x - 1}_${y}`].right;
                if (mapData[`${x}_${y - 1}`]) constraints.edges.top = mapData[`${x}_${y - 1}`].bottom;
                
                const validTiles = getValidTiles(constraints, 'vertical');
                if (validTiles.length === 0) continue;
                
                const randomIndex = Math.floor(rng(x, y) * validTiles.length),
                    randomTile = validTiles[randomIndex],
                    tileInfo = tileInfos.vertical[`${randomTile.x}_${randomTile.y}`];
                
                stampTileToGrid(x, y, randomTile.x, randomTile.y, false, terrainMap);
                allStampedTiles.push({ x, y, isHorizontal: false }); // RESTORED

                mapData[`${x}_${y}`] = { tilePos: randomTile, left: tileInfo.edges.topLeft, top: tileInfo.edges.top, right: tileInfo.edges.topRight };
                mapData[`${x}_${y + 1}`] = { tilePos: randomTile, left: tileInfo.edges.bottomLeft, bottom: tileInfo.edges.bottom, right: tileInfo.edges.bottomRight };
            }
        }
    }
}

// ====================================================================================
// SECTION 3: SMOOTHING, BACKGROUND & LIGHTING
// ====================================================================================

// --- GAUSSIAN BLUR CONFIGURATION ---

// The threshold for turning a blurred value back into solid ground. 0.5 is the standard.
const SOLID_THRESHOLD = 0.5;


// in generation.worker.js

/**
 * Transforms all structural terrain into smooth, organic shapes, while preserving
 * the pixels of pre-stamped Set Pieces.
 */
function applySmoothingPass(sx, sy, terrainMap, wallMaterial, stampedPieces) {
    const DEFAULT_BLUR_RADIUS = 24;
    const MATERIAL_BLUR_RADII = {
        [MAT.WOOD]: 4,
    };

    const startX = sx * SECTOR_SIZE;
    const startY = sy * SECTOR_SIZE;

    const getGridFromMap = (x, y, map) => {
        const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE), key = coordToKey(cx, cy);
        const chunk = map.get(key);
        if (!chunk) return MAT.EMPTY;
        const lx = x & (CHUNK_SIZE - 1), ly = y & (CHUNK_SIZE - 1);
        return chunk.data[getLocalIndex(lx, ly)];
    };

    // --- NEW: STAGE 0: CREATE PROTECTION MASK ---
    const protectionMask = new Uint8Array(SECTOR_SIZE * SECTOR_SIZE).fill(0);
    if (stampedPieces) {
        for (const piece of stampedPieces) {
            // Check if the piece has pixel data to protect
            if (!piece.parsedData || !piece.parsedData.pixels) continue;

            const pieceStartX = piece.bounds.x;
            const pieceStartY = piece.bounds.y;
            const pieceWidth = piece.bounds.width;
            const pieceHeight = piece.bounds.height;

            const sourcePixels = piece.parsedData.pixels;
            const sourceWidth = piece.parsedData.width;
            const sourceHeight = piece.parsedData.height;

            // Iterate through the world area this piece occupies
            for (let y = 0; y < pieceHeight; y++) {
                for (let x = 0; x < pieceWidth; x++) {
                    const worldX = pieceStartX + x;
                    const worldY = pieceStartY + y;

                    // Only process pixels within the current sector
                    if (worldX >= startX && worldX < startX + SECTOR_SIZE &&
                        worldY >= startY && worldY < startY + SECTOR_SIZE) 
                    {
                        // Scale world coords to source image coords to find the material
                        const sourceX = Math.floor((x / pieceWidth) * sourceWidth);
                        const sourceY = Math.floor((y / pieceHeight) * sourceHeight);
                        const sourcePixelIndex = sourceY * sourceWidth + sourceX;
                        const pieceMaterial = sourcePixels[sourcePixelIndex];

                        // If the set piece pixel is not transparent, mark this location for protection.
                        if (pieceMaterial !== -1) {
                            const sectorLX = worldX - startX;
                            const sectorLY = worldY - startY;
                            protectionMask[sectorLY * SECTOR_SIZE + sectorLX] = 1;
                        }
                    }
                }
            }
        }
    }

    // --- STAGE 1: DECOMPOSITION (Modified) ---
    const SMOOTHABLE_MATERIALS = new Set([wallMaterial, MAT.SAND, MAT.GROUND, MAT.WOOD]);
    const materialBuffers = new Map();
    for (const matId of SMOOTHABLE_MATERIALS) {
        materialBuffers.set(matId, new Float32Array(SECTOR_SIZE * SECTOR_SIZE));
    }
    for (let y = 0; y < SECTOR_SIZE; y++) {
        for (let x = 0; x < SECTOR_SIZE; x++) {
            const index = y * SECTOR_SIZE + x;
            // *** THE CHANGE IS HERE: Check the mask before processing a pixel ***
            if (protectionMask[index] === 1) {
                continue; // Skip protected pixels
            }

            const type = getGridFromMap(startX + x, startY + y, terrainMap);
            if (SMOOTHABLE_MATERIALS.has(type)) {
                materialBuffers.get(type)[index] = 1.0;
            }
        }
    }

    // --- STAGE 2: INDEPENDENT BLURRING (Unchanged) ---
    // This part remains the same, as it only operates on the (now-filtered) buffers.
    const writeBuffer = new Float32Array(SECTOR_SIZE * SECTOR_SIZE);
    for (const [matId, readBuffer] of materialBuffers.entries()) {
        const blurRadius = MATERIAL_BLUR_RADII[matId] || DEFAULT_BLUR_RADIUS;
        const kernel = [];
        const sigma = blurRadius / 3;
        const sigmaSq = sigma * sigma;
        let kernelSum = 0;
        for (let i = -blurRadius; i <= blurRadius; i++) { const value = Math.exp(-0.5 * (i * i / sigmaSq)); kernel.push(value); kernelSum += value; }
        for (let i = 0; i < kernel.length; i++) { kernel[i] /= kernelSum; }
        for (let y = 0; y < SECTOR_SIZE; y++) { for (let x = 0; x < SECTOR_SIZE; x++) { let weightedSum = 0; for (let k = -blurRadius; k <= blurRadius; k++) { const sampleX = Math.max(0, Math.min(SECTOR_SIZE - 1, x + k)); weightedSum += readBuffer[y * SECTOR_SIZE + sampleX] * kernel[k + blurRadius]; } writeBuffer[y * SECTOR_SIZE + x] = weightedSum; } }
        for (let y = 0; y < SECTOR_SIZE; y++) { for (let x = 0; x < SECTOR_SIZE; x++) { let weightedSum = 0; for (let k = -blurRadius; k <= blurRadius; k++) { const sampleY = Math.max(0, Math.min(SECTOR_SIZE - 1, y + k)); weightedSum += writeBuffer[sampleY * SECTOR_SIZE + x] * kernel[k + blurRadius]; } readBuffer[y * SECTOR_SIZE + x] = weightedSum; } }
    }

    // --- STAGE 3: RECOMPOSITION (Modified) ---
    const finalMap = new Map();
    for (let y = 0; y < SECTOR_SIZE; y++) {
        for (let x = 0; x < SECTOR_SIZE; x++) {
            const index = y * SECTOR_SIZE + x;
            const worldX = startX + x;
            const worldY = startY + y;

            // *** THE CHANGE IS HERE: Check the mask before recomposing ***
            if (protectionMask[index] === 1) {
                // If it's a protected pixel, just copy its original material from the input map.
                const originalType = getGridFromMap(worldX, worldY, terrainMap);
                setGrid(worldX, worldY, originalType, finalMap);
            } else {
                // Otherwise, run the normal smoothing recomposition logic.
                let maxStrength = 0.0;
                let winningMaterial = MAT.EMPTY;
                for (const [matId, buffer] of materialBuffers.entries()) {
                    const strength = buffer[index];
                    if (strength > maxStrength) {
                        maxStrength = strength;
                        winningMaterial = matId;
                    }
                }
                if (maxStrength > SOLID_THRESHOLD) {
                    setGrid(worldX, worldY, winningMaterial, finalMap);
                } else {
                    setGrid(worldX, worldY, MAT.EMPTY, finalMap);
                }
            }
        }
    }

    // Final step: replace the old terrain map with the newly composed one.
    terrainMap.clear();
    for(const [key, chunk] of finalMap.entries()) {
        terrainMap.set(key, chunk);
    }
}

const hash = (x, y, s = 0) => {
    let h = x * 374761393 + y * 668265263 + s * 1442695041;
    h = (h ^ (h >> 13)) * 1274126177;
    return (h ^ (h >> 16)) & 255;
};
const lerp = (a, b, t) => a + (b - a) * t;
const lerpColor = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const getSandCaveColor = (x, y) => {
    const px = x >> 1,
        py = y >> 1,
        n = (PerlinNoise.noise(px * 0.04, py * 0.1) + 1) / 2;
    if (n > 0.6) return [60, 45, 30];
    if (n > 0.4) return [50, 38, 25];
    return [40, 30, 20];
};
const getCoalMineColor = (x, y) => {
    const px = x >> 1,
        py = y >> 1,
        r = (PerlinNoise.noise(px * 0.1, py * 0.1) + 1) / 2,
        s = PerlinNoise.noise(px * 0.02, py * 0.15);
    if (s * s > 0.3) return [5, 3, 3];
    if (r > 0.6) return [28, 25, 25];
    if (r > 0.45) return [20, 18, 18];
    return [12, 10, 10];
};
const getVolcanicColor = (x, y) => {
    const px = x >> 1,
        py = y >> 1,
        c = Math.abs(PerlinNoise.noise(px * 0.06, py * 0.06) * 2.5);
    if (c > 0.98) return [255, 170, 0];
    if (c > 0.95) return [255, 90, 0];
    const r = hash(px >> 1, py >> 1) / 255;
    if (r > 0.5) return [25, 10, 10];
    return [15, 5, 5];
};
const getLabyrinthColor = (x, y) => {
    const px = x >> 2,
        py = y >> 2;
    if (x % 4 < 1 || y % 4 < 1) return [20, 22, 25];
    return hash(px, py) > 128 ? [55, 60, 65] : [45, 50, 55];
};
const getMagicDungeonColor = (x, y) => {
    const px = x >> 1,
        py = y >> 1,
        e = (PerlinNoise.noise(px * 0.03, py * 0.03) + 1) / 2,
        c = Math.abs(PerlinNoise.noise(px * 0.16, py * 0.16));
    if (c * c * c > 0.2) return [180, 150, 255];
    if (c * c > 0.25) return [100, 80, 140];
    if (hash(x, y) > 254) return [200, 200, 255];
    if (e > 0.55) return [40, 15, 60];
    return [20, 5, 40];
};
const layerFunctions = [getSandCaveColor, getCoalMineColor, getVolcanicColor, getLabyrinthColor, getMagicDungeonColor];

function generateSectorBackground(sx, sy, biomeInfo) {
    const imageData = new ImageData(SECTOR_SIZE, SECTOR_SIZE),
        data = imageData.data,
        startX = sx * SECTOR_SIZE,
        startY = sy * SECTOR_SIZE,
        layerIndex = biomeInfo.params.layer ?? (biomeInfo.name === "Labyrinth" ? 3 : biomeInfo.name === "MagicDungeon" ? 4 : 1),
        colorFunc = layerFunctions[layerIndex] || getCoalMineColor;
    for (let y = 0; y < SECTOR_SIZE; y++) {
        for (let x = 0; x < SECTOR_SIZE; x++) {
            const worldX = startX + x,
                worldY = startY + y,
                color = colorFunc(worldX, worldY),
                i = (y * SECTOR_SIZE + x) * 4;
            data[i] = color[0];
            data[i + 1] = color[1];
            data[i + 2] = color[2];
            data[i + 3] = 255;
        }
    }
    return imageData;
}

function bakeLightingForSector(sx, sy, terrainMap, borderContext) {
    const lightMap = new Map();
    const getGrid = (x, y) => {
        const cx = Math.floor(x / CHUNK_SIZE),
            cy = Math.floor(y / CHUNK_SIZE),
            key = coordToKey(cx, cy);
        if (terrainMap.has(key)) {
            const chunk = terrainMap.get(key),
                lx = x - cx * CHUNK_SIZE,
                ly = y - cy * CHUNK_SIZE;
            return chunk.data[getLocalIndex(lx, ly)];
        }
        const borderPixel = borderContext[coordToKey(x, y)];
        return borderPixel ? borderPixel.terrain : MAT.EMPTY;
    };
    const getLight = (map, x, y) => {
        const cx = Math.floor(x / CHUNK_SIZE),
            cy = Math.floor(y / CHUNK_SIZE),
            key = coordToKey(cx, cy);
        if (map.has(key)) {
            const chunk = map.get(key),
                lx = x - cx * CHUNK_SIZE,
                ly = y - cy * CHUNK_SIZE;
            return chunk.data[getLocalIndex(lx, ly)];
        }
        const borderPixel = borderContext[coordToKey(x, y)];
        return borderPixel ? borderPixel.light : 0;
    };
    const setLight = (map, x, y, value) => {
        const cx = Math.floor(x / CHUNK_SIZE),
            cy = Math.floor(y / CHUNK_SIZE),
            key = coordToKey(cx, cy);
        let chunkPayload;
        if (!map.has(key)) {
            chunkPayload = {
                data: new Uint8Array(CHUNK_SIZE_SQ).fill(0),
                cx: cx,
                cy: cy
            };
            map.set(key, chunkPayload);
        } else {
            chunkPayload = map.get(key);
        }
        const lx = x - cx * CHUNK_SIZE,
            ly = y - cy * CHUNK_SIZE;
        chunkPayload.data[getLocalIndex(lx, ly)] = value;
    };
    const startX = sx * SECTOR_SIZE,
        startY = sy * SECTOR_SIZE,
        endX = startX + SECTOR_SIZE,
        endY = startY + SECTOR_SIZE;
    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            let initialLight = getGrid(x, y) === MAT.EMPTY ? MAX_LIGHT_LEVEL : 0;
            const DIRS_8 = [
                [-1, 0],
                [1, 0],
                [0, -1],
                [0, 1],
                [-1, -1],
                [-1, 1],
                [1, -1],
                [1, 1]
            ];
            for (const dir of DIRS_8) {
                const nX = x + dir[0],
                    nY = y + dir[1],
                    lightLoss = WALL_TYPES.has(getGrid(x, y)) ? 3 : 1;
                initialLight = Math.max(initialLight, getLight(lightMap, nX, nY) - lightLoss);
            }
            if (initialLight > 0) setLight(lightMap, x, y, initialLight);
        }
    }
    for (let y = startY; y < endY; y++)
        for (let x = startX; x < endX; x++) {
            const currentLight = getLight(lightMap, x, y),
                lightLoss = WALL_TYPES.has(getGrid(x, y)) ? 3 : 1,
                newLight = Math.max(currentLight, getLight(lightMap, x, y - 1) - lightLoss, getLight(lightMap, x - 1, y) - lightLoss);
            if (newLight > currentLight) setLight(lightMap, x, y, newLight);
        }
    for (let y = endY - 1; y >= startY; y--)
        for (let x = endX - 1; x >= startX; x--) {
            const currentLight = getLight(lightMap, x, y),
                lightLoss = WALL_TYPES.has(getGrid(x, y)) ? 3 : 1,
                newLight = Math.max(currentLight, getLight(lightMap, x, y + 1) - lightLoss, getLight(lightMap, x + 1, y) - lightLoss);
            if (newLight > currentLight) setLight(lightMap, x, y, newLight);
        }
    return lightMap;
}

// ====================================================================================
// SECTION 4: MAIN WORKER MESSAGE HANDLER
// ====================================================================================

self.onmessage = async (event) => {
    const {
        type,
        seed,
        sx,
        sy,
        borderContext,
        biomeInfo,
        setPieces
    } = event.data;

    if (type === 'init') {
        WORLD_SEED = seed;
        PerlinNoise.seed(WORLD_SEED);
        if (event.data.colors) {
            initializeColorMap(event.data.colors);
        }
        self.postMessage({
            type: 'init-ack'
        });
        return;
    }

    if (type === 'generate-background') {
        const sectorBackground = generateSectorBackground(sx, sy, biomeInfo);
        self.postMessage({
            type: 'background-result',
            sx: sx,
            sy: sy,
            background: sectorBackground
        }, [sectorBackground.data.buffer]);
        return;
    }

    if (type === 'generate-and-bake') {
        const terrainMap = new Map();

        currentSectorSX = sx;
        currentSectorSY = sy;

        const layerIndex = biomeInfo.params.layer ?? 1; // Default to layer 1 (ROCK_WALL) if not specified
        const wallMaterial = LAYER_WALL_MATERIALS[layerIndex] || MAT.ROCK_WALL;

        // Temporarily override the Wang Tile generator's material mapping for this run
        COLOR_TO_MAT_MAP.set('ffffff', wallMaterial);
        DEFAULT_MAT = wallMaterial;
        const stampedPieces = [];
        const allStampedTiles = [];

        // Step 1: Generate the base blocky cave structure.
        await generateWangTileSector(sx, sy, terrainMap, setPieces, stampedPieces, allStampedTiles);

        // Step 2: Apply the smoothing algorithm to the generated base.
        applySmoothingPass(sx, sy, terrainMap, wallMaterial, stampedPieces);

        const sectorBackground = generateSectorBackground(sx, sy, biomeInfo);
        const lightMap = bakeLightingForSector(sx, sy, terrainMap, borderContext);

        const transferableChunks = [],
            terrainBuffers = [];
        for (const [key, payload] of terrainMap.entries()) {
            transferableChunks.push([key, payload]);
            terrainBuffers.push(payload.data.buffer);
        }

        const transferableLightChunks = [],
            lightBuffers = [];
        for (const [key, payload] of lightMap.entries()) {
            transferableLightChunks.push([key, payload]);
            lightBuffers.push(payload.data.buffer);
        }

        self.postMessage({
            type: 'result',
            sx: sx,
            sy: sy,
            chunks: transferableChunks,
            lightChunks: transferableLightChunks,
            background: sectorBackground,
            wangTileData: allStampedTiles,
            stampedSetPieces: stampedPieces,
        }, [...terrainBuffers, ...lightBuffers, sectorBackground.data.buffer]);
    }
};