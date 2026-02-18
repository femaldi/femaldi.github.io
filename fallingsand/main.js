const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

function createWindow() {
  // Get primary display's work area size to avoid overlapping with taskbars
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const mainWindow = new BrowserWindow({
    // Set initial window size. Your game's canvas is 1440x810 (480x270 at 3x scale)
    // We add some padding for the title bar and controls.
    width: 1460, 
    height: 900,
    fullscreen: true,
    frame: false, 
    webPreferences: {
      // Security Best Practices:
      // contextIsolation is crucial for security. It ensures your game code
      // runs in a separate context from Electron's main process.
      contextIsolation: true,
      // nodeIntegration should be false. Don't expose Node.js APIs to your game's frontend code.
      nodeIntegration: false,
      // The preload script is a safe bridge if you ever need to communicate
      // between your game and the main Electron process (e.g., for saving files).
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#222', // Match your game's body background
    show: false, // Don't show the window until it's ready
  });

  // Load your game's index.html file.
  mainWindow.loadFile('index.html');

  // Once the window is ready, show it. This prevents a white flash.
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Optional: Open the DevTools for debugging.
  // mainWindow.webContents.openDevTools();
}

// This method will be called when Electron has finished initialization.
app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});