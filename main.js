const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fetch = require('node-fetch');
const log = require('electron-log');
const Store = require('electron-store');

const store = new Store();
let mainWindow;
let asreviewProcess = null;
let isASReviewRunning = false;

// Configure logging
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'build/icon.png')
  });

  mainWindow.loadFile('index.html');
}

async function checkASReviewRunning() {
  try {
    const response = await fetch('http://localhost:5000');
    return response.status === 200;
  } catch {
    return false;
  }
}

async function startASReview() {
  if (isASReviewRunning) {
    log.info('ASReview is already running');
    return;
  }

  try {
    const pythonPath = app.isPackaged
      ? path.join(process.resourcesPath, 'portable-python', 'python.exe')
      : 'python';

    const dataPath = path.join(app.getPath('userData'), 'ASReviewData');
    
    // Install ASReview if not already installed
    if (!store.get('asreviewInstalled')) {
      log.info('Installing ASReview...');
      mainWindow.webContents.send('status-update', 'Installing ASReview...');
      
      await new Promise((resolve, reject) => {
        const pip = spawn(pythonPath, ['-m', 'pip', 'install', 'asreview']);
        pip.on('close', (code) => {
          if (code === 0) {
            store.set('asreviewInstalled', true);
            resolve();
          } else {
            reject(new Error('Failed to install ASReview'));
          }
        });
      });
    }

    // Start ASReview Lab
    log.info('Starting ASReview Lab...');
    mainWindow.webContents.send('status-update', 'Starting ASReview Lab...');

    asreviewProcess = spawn(pythonPath, [
      '-m', 'asreview', 'lab',
      '--port', '5000'
    ], {
      cwd: dataPath
    });

    asreviewProcess.stdout.on('data', (data) => {
      log.info(data.toString());
    });

    asreviewProcess.stderr.on('data', (data) => {
      log.error(data.toString());
    });

    // Wait for server to start
    let attempts = 0;
    while (attempts < 30) {
      if (await checkASReviewRunning()) {
        isASReviewRunning = true;
        mainWindow.webContents.send('asreview-started');
        log.info('ASReview Lab started successfully');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error('ASReview failed to start');
  } catch (error) {
    log.error('Error starting ASReview:', error);
    mainWindow.webContents.send('error', error.message);
  }
}

function stopASReview() {
  if (asreviewProcess) {
    asreviewProcess.kill();
    asreviewProcess = null;
    isASReviewRunning = false;
    mainWindow.webContents.send('asreview-stopped');
    log.info('ASReview Lab stopped');
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopASReview();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.on('start-asreview', () => {
  startASReview();
});

ipcMain.on('stop-asreview', () => {
  stopASReview();
});

ipcMain.on('check-status', async () => {
  const running = await checkASReviewRunning();
  mainWindow.webContents.send(running ? 'asreview-started' : 'asreview-stopped');
});