const fs = require("fs-extra");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");

const root = path.join(__dirname, "..");
const htmlPath = path.join(root, "dist-renderer", "index.html");
const gameJsPath = path.join(root, "dist-renderer", "game.js");
const obfJsPath = path.join(root, "dist-renderer", "game.obf.js");

async function main() {
    let html = await fs.readFile(htmlPath, "utf8");

    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);

    if (!scriptMatch) {
        throw new Error("Could not find inline <script> block before </body>.");
    }

    const gameJs = scriptMatch[1];

    await fs.writeFile(gameJsPath, gameJs, "utf8");

    const result = JavaScriptObfuscator.obfuscate(gameJs, {
        compact: true,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        stringArray: true,
        stringArrayThreshold: 0.55,
        stringArrayEncoding: ["base64"],
        rotateStringArray: true,
        renameGlobals: false,
        selfDefending: false,
        simplify: true,
        splitStrings: false,
        target: "browser"
    });

    await fs.writeFile(obfJsPath, result.getObfuscatedCode(), "utf8");

    html = html.replace(
        /<script>[\s\S]*?<\/script>\s*<\/body>/,
        `<script src="game.obf.js"></script>\n</body>`
    );

    await fs.writeFile(htmlPath, html, "utf8");
    await fs.remove(gameJsPath);

    console.log("Renderer obfuscated:", obfJsPath);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});