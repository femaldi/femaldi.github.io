const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const path = require("path");

const isDev = !app.isPackaged;

function createWindow() {
    const win = new BrowserWindow({
        width: 1920,
        height: 1080,
        minWidth: 1280,
        minHeight: 720,
        backgroundColor: "#020802",
        show: false,
        autoHideMenuBar: true,
        fullscreen: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            devTools: isDev
        }
    });

    Menu.setApplicationMenu(null);

    const indexPath = path.join(__dirname, "..", "dist-renderer", "index.html");

    win.loadFile(indexPath);

    win.once("ready-to-show", () => {
        win.show();
    });

    win.on("enter-full-screen", () => {
        win.setMenuBarVisibility(false);
    });

    return win;
}

ipcMain.handle("app:openExternal", async (_event, url) => {
    if (typeof url !== "string") return;

    const allowed =
        url.startsWith("https://") ||
        url.startsWith("mailto:") ||
        url.startsWith("steam://");

    if (!allowed) return;

    await shell.openExternal(url);
});

ipcMain.handle("app:quit", () => {
    app.quit();
});

app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});