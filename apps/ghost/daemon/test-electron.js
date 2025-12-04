const electron = require('electron');
console.log('Type:', typeof electron);
if (typeof electron === 'string') {
  console.log('Value:', electron);
} else {
  console.log('Keys:', Object.keys(electron));
}
console.log('Versions:', process.versions);
