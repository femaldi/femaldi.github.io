// This script runs in a privileged environment before your index.html is loaded.
// It has access to both the `window` object of your game and Node.js APIs.
//
// For now, we don't need to do anything here, but it's essential for security.
console.log('Preload script loaded.');

// preload.js OR renderer.js

// --- GLOBAL ERROR CATCHING ---
// Catch synchronous errors
window.addEventListener('error', (event) => {
  console.error('!!! UNCAUGHT ERROR IN RENDERER PROCESS !!!');
  // The event object has useful properties
  console.error(`Error: ${event.message} at ${event.filename}:${event.lineno}`);
  console.error(event.error); // The actual error object

  // You can use IPC to send this to the main process to be logged to a file
  // ipcRenderer.send('log-error', event.error.stack);
});

// Catch unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error('!!! UNHANDLED REJECTION IN RENDERER PROCESS !!!');
  // The event.reason is the error object
  console.error(`Reason: ${event.reason.stack || event.reason}`);
  
  // ipcRenderer.send('log-error', event.reason.stack);
});
// --- END GLOBAL ERROR CATCHING ---


// ... the rest of your preload/renderer code ...