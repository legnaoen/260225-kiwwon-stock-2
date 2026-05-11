const Store = require('electron-store');
const store = new Store();
console.log(store.get('ai_schedule_settings'));
