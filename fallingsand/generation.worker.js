// --- WORKER SCRIPT: generation.worker.js ---

// 1. Dependencies (now includes lighting constants)
let WORLD_SEED = 0;
const MAT = { EMPTY:0,ROCK_WALL:1,SAND:2,WATER:3,SOIL:4,GAS:5,WOOD:10,FIRE:11,GUNPOWDER:12,GUNPOWDER_IGNITED:13,OIL:14,OIL_BURNING:15,COAL:16,COAL_BURNING:17,ACID:18,GLASS:19,GLASS_WALL:20,ADAMANTIUM:21,COPPER:22,SILVER:23,GOLD:24,PLATINUM:25,RUNE_WALL:26,SANDSTONE_WALL:27,VOLCANIC_WALL:28,LABYRINTH_WALL:29,MAGIC_WALL:30,RIGID_BODY_STUB:99 };
const CHUNK_SIZE = 16;
const CHUNK_SIZE_SQ = CHUNK_SIZE * CHUNK_SIZE;
const SECTOR_SIZE = 512;
const WORLD_LAYER_HEIGHT = 2000;
const MAX_LIGHT_LEVEL = 30;
const WALL_TYPES = new Set([MAT.ROCK_WALL, MAT.SANDSTONE_WALL, MAT.VOLCANIC_WALL, MAT.LABYRINTH_WALL, MAT.MAGIC_WALL]);

const PerlinNoise={p:[],seed:function(s){let r=(()=>{let d=s;return()=>(d=(d*9301+49297)%233280)/233280;})();this.p=new Uint8Array(512);let p=[];for(let i=0;i<256;i++)p.push(i);for(let i=p.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[p[i],p[j]]=[p[j],p[i]];}
for(let i=0;i<256;i++)this.p[i]=this.p[i+256]=p[i];},fade:t=>t*t*t*(t*(t*6-15)+10),lerp:(t,a,b)=>a+t*(b-a),grad:function(h,x,y,z){let u=h<8?x:y,v=h<4?y:h===12||h===14?x:z;return((h&1)===0?u:-u)+((h&2)===0?v:-v);},noise:function(x,y,z=0){let X=Math.floor(x)&255,Y=Math.floor(y)&255,Z=Math.floor(z)&255;x-=Math.floor(x);y-=Math.floor(y);z-=Math.floor(z);let u=this.fade(x),v=this.fade(y),w=this.fade(z);let A=this.p[X]+Y,AA=this.p[A]+Z,AB=this.p[A+1]+Z,B=this.p[X+1]+Y,BA=this.p[B]+Z,BB=this.p[B+1]+Z;return this.lerp(w,this.lerp(v,this.lerp(u,this.grad(this.p[AA],x,y,z),this.grad(this.p[BA],x-1,y,z)),this.lerp(u,this.grad(this.p[AB],x,y-1,z),this.grad(this.p[BB],x-1,y-1,z))),this.lerp(v,this.lerp(u,this.grad(this.p[AA+1],x,y,z-1),this.grad(this.p[BA+1],x-1,y,z-1)),this.lerp(u,this.grad(this.p[AB+1],x,y-1,z-1),this.grad(this.p[BB+1],x-1,y-1,z-1))));}};

// 2. Worker-local helpers
const getLocalIndex = (lx, ly) => ly * CHUNK_SIZE + lx;
function coordToKey(x, y) { return x * 374761393 + y * 668265263; }

// 3. Generation and Lighting Functions (now living in the worker)

function generateSector(sectorX, sectorY, localChunkMap) {
    const setGrid = (x, y, type) => {
        const cx=Math.floor(x/CHUNK_SIZE),cy=Math.floor(y/CHUNK_SIZE),key=coordToKey(cx,cy);
        let chunkPayload;
        if(!localChunkMap.has(key)){chunkPayload={data:new Uint8Array(CHUNK_SIZE_SQ).fill(MAT.EMPTY),cx:cx,cy:cy};localChunkMap.set(key,chunkPayload);}else{chunkPayload=localChunkMap.get(key);}
        const lx=x-cx*CHUNK_SIZE,ly=y-cy*CHUNK_SIZE;
        chunkPayload.data[getLocalIndex(lx,ly)]=type;
    };
    const startX=sectorX*SECTOR_SIZE,startY=sectorY*SECTOR_SIZE,endX=startX+SECTOR_SIZE,endY=startY+SECTOR_SIZE,scale=220,octaves=3,persistence=0.5,lacunarity=2.0,depthBiasStrength=0.1,layerHeight=WORLD_LAYER_HEIGHT,layerWallMaterials=[MAT.SANDSTONE_WALL,MAT.ROCK_WALL,MAT.VOLCANIC_WALL,MAT.LABYRINTH_WALL,MAT.MAGIC_WALL];
    for(let y=startY;y<endY;y++){const depthFactor=Math.max(0,y)/(layerHeight*layerWallMaterials.length),currentDepthBias=depthFactor*depthBiasStrength,layerIndex=Math.min(layerWallMaterials.length-1,Math.floor(Math.max(0,y)/layerHeight)),baseWallType=layerWallMaterials[layerIndex];
    for(let x=startX;x<endX;x++){let totalNoise=0,frequency=1,amplitude=1,maxAmplitude=0;for(let i=0;i<octaves;i++){totalNoise+=((PerlinNoise.noise(x*frequency/scale,y*frequency/scale)+1)/2)*amplitude;maxAmplitude+=amplitude;amplitude*=persistence;frequency*=lacunarity;}
    const finalNoise=totalNoise/maxAmplitude;if(finalNoise>=0.51-currentDepthBias)setGrid(x,y,baseWallType);}}
}

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
    const { type } = event.data;

    if (type === 'init') {
        WORLD_SEED = event.data.seed;
        PerlinNoise.seed(WORLD_SEED);
        self.postMessage({ type: 'init-ack' });
        return;
    }

    if (type === 'generate-and-bake') {
        const { sx, sy, borderContext } = event.data;
        
        // Generate terrain into a new map
        const terrainMap = new Map();
        generateSector(sx, sy, terrainMap);
        
        // Use that new terrain map and the border context to bake lighting
        const lightMap = bakeLightingForSector(sx, sy, terrainMap, borderContext);
        
        // Prepare terrain data for transfer
        const transferableChunks = [];
        const terrainBuffers = [];
        for (const [key, payload] of terrainMap.entries()) {
            transferableChunks.push([key, payload]);
            terrainBuffers.push(payload.data.buffer);
        }

        // Prepare light data for transfer
        const transferableLightChunks = [];
        const lightBuffers = [];
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
        }, [...terrainBuffers, ...lightBuffers]); // Transfer all buffers
    }
};