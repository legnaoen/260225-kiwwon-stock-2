const Store = require('electron-store');
const store = new Store();
console.log('AI Settings:');
console.dir(store.get('ai_settings'), { depth: null });
console.log('Local AI Settings:');
console.dir(store.get('local_ai_settings'), { depth: null });
