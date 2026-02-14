// --- WORKER SCRIPT: generation.worker.js ---

// 1. Dependencies copied from the main script.
// The worker needs its own copies of these constants and objects.

let WORLD_SEED = 0; // Will be initialized by the main thread

const MAT = { EMPTY:0,ROCK_WALL:1,SAND:2,WATER:3,SOIL:4,GAS:5,WOOD:10,FIRE:11,GUNPOWDER:12,GUNPOWDER_IGNITED:13,OIL:14,OIL_BURNING:15,COAL:16,COAL_BURNING:17,ACID:18,GLASS:19,GLASS_WALL:20,ADAMANTIUM:21,COPPER:22,SILVER:23,GOLD:24,PLATINUM:25,RUNE_WALL:26,SANDSTONE_WALL:27,VOLCANIC_WALL:28,LABYRINTH_WALL:29,MAGIC_WALL:30,RIGID_BODY_STUB:99 };

const CHUNK_SIZE = 16;
const CHUNK_SIZE_SQ = CHUNK_SIZE * CHUNK_SIZE;
const SECTOR_SIZE = 512;
const WORLD_LAYER_HEIGHT = 2000;

const PerlinNoise={p:[],seed:function(s){let random=(()=>{let sd=s;return()=>(sd=(sd*9301+49297)%233280)/233280;})();this.p=new Uint8Array(512);let perm=[];for(let i=0;i<256;i++)perm.push(i);for(let i=perm.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[perm[i],perm[j]]=[perm[j],perm[i]];}
for(let i=0;i<256;i++)this.p[i]=this.p[i+256]=perm[i];},fade:t=>t*t*t*(t*(t*6-15)+10),lerp:(t,a,b)=>a+t*(b-a),grad:function(h,x,y,z){let u=h<8?x:y,v=h<4?y:h===12||h===14?x:z;return((h&1)===0?u:-u)+((h&2)===0?v:-v);},noise:function(x,y,z=0){let X=Math.floor(x)&255,Y=Math.floor(y)&255,Z=Math.floor(z)&255;x-=Math.floor(x);y-=Math.floor(y);z-=Math.floor(z);let u=this.fade(x),v=this.fade(y),w=this.fade(z);let A=this.p[X]+Y,AA=this.p[A]+Z,AB=this.p[A+1]+Z,B=this.p[X+1]+Y,BA=this.p[B]+Z,BB=this.p[B+1]+Z;return this.lerp(w,this.lerp(v,this.lerp(u,this.grad(this.p[AA],x,y,z),this.grad(this.p[BA],x-1,y,z)),this.lerp(u,this.grad(this.p[AB],x,y-1,z),this.grad(this.p[BB],x-1,y-1,z))),this.lerp(v,this.lerp(u,this.grad(this.p[AA+1],x,y,z-1),this.grad(this.p[BA+1],x-1,y,z-1)),this.lerp(u,this.grad(this.p[AB+1],x,y-1,z-1),this.grad(this.p[BB+1],x-1,y-1,z-1))));}};

// 2. Worker-specific helper functions

const getLocalIndex = (lx, ly) => ly * CHUNK_SIZE + lx;

function coordToKey(x, y) {
    return x * 374761393 + y * 668265263;
}

// This version of generateSector runs synchronously inside the worker.
// It writes to a temporary map that will be sent back to the main thread.
function generateSector(sectorX, sectorY) {
    const localChunkMap = new Map();

    // A worker-local setGrid function
    const setGrid = (x, y, type) => {
        const cx = Math.floor(x / CHUNK_SIZE);
        const cy = Math.floor(y / CHUNK_SIZE);
        const key = coordToKey(cx, cy);

        let chunkData;
        if (!localChunkMap.has(key)) {
            chunkData = new Uint8Array(CHUNK_SIZE_SQ).fill(MAT.EMPTY);
            localChunkMap.set(key, chunkData);
        } else {
            chunkData = localChunkMap.get(key);
        }
        
        const lx = x - cx * CHUNK_SIZE;
        const ly = y - cy * CHUNK_SIZE;
        chunkData[getLocalIndex(lx, ly)] = type;
    };
    
    // The generation logic itself is unchanged, but is now fully synchronous
    // because blocking the worker thread is fine.
    const startX = sectorX * SECTOR_SIZE;
    const startY = sectorY * SECTOR_SIZE;
    const endX = startX + SECTOR_SIZE;
    const endY = startY + SECTOR_SIZE;

    const scale = 220, octaves = 3, persistence = 0.5, lacunarity = 2.0;
    const depthBiasStrength = 0.1;
    const layerHeight = WORLD_LAYER_HEIGHT;
    const layerWallMaterials = [ MAT.SANDSTONE_WALL, MAT.ROCK_WALL, MAT.VOLCANIC_WALL, MAT.LABYRINTH_WALL, MAT.MAGIC_WALL ];

    for (let y = startY; y < endY; y++) {
        const depthFactor = Math.max(0, y) / (layerHeight * layerWallMaterials.length);
        const currentDepthBias = depthFactor * depthBiasStrength;
        const layerIndex = Math.min(layerWallMaterials.length - 1, Math.floor(Math.max(0, y) / layerHeight));
        const baseWallType = layerWallMaterials[layerIndex];

        for (let x = startX; x < endX; x++) {
            let totalNoise = 0, frequency = 1, amplitude = 1, maxAmplitude = 0;
            for (let i = 0; i < octaves; i++) {
                totalNoise += ((PerlinNoise.noise(x * frequency / scale, y * frequency / scale) + 1) / 2) * amplitude;
                maxAmplitude += amplitude;
                amplitude *= persistence;
                frequency *= lacunarity;
            }
            const finalNoise = totalNoise / maxAmplitude;

            if (finalNoise >= 0.51 - currentDepthBias) {
                setGrid(x, y, baseWallType);
            }
        }
    }
    
    return localChunkMap;
}


// 3. The main message handler for the worker
self.onmessage = (event) => {
    const { type } = event.data;

    if (type === 'init') {
        // Initialize the worker with the world seed
        WORLD_SEED = event.data.seed;
        PerlinNoise.seed(WORLD_SEED);
        return;
    }

    if (type === 'generate') {
        // A request to generate a sector
        const { sx, sy } = event.data;
        
        // Run the heavy computation
        const resultMap = generateSector(sx, sy);
        
        // Prepare the data for transfer back to the main thread.
        // We convert the Map to an array and extract the underlying ArrayBuffers.
        const transferableChunks = [];
        const transferableBuffers = [];
        for (const [key, data] of resultMap.entries()) {
            transferableChunks.push([key, data]);
            transferableBuffers.push(data.buffer);
        }

        // Post the result back. The second argument is a list of objects to "transfer"
        // instead of clone, which is much faster for large data like ArrayBuffers.
        self.postMessage({
            type: 'result',
            sx: sx,
            sy: sy,
            chunks: transferableChunks
        }, transferableBuffers);
    }
};