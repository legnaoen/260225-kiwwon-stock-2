import { ipcRenderer } from 'electron';
console.log('Sending request...');
window.electronAPI.analyzeStock('005860').then(console.log);
