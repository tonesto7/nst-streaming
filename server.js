var nodemon = require('nodemon');

nodemon({
    script: 'app.js'
});

nodemon.on('start', function() {
    console.log('NST Streaming Service has Started');
}).on('quit', function() {
    console.log('NST Streaming Service has Quit.  Restarting...');
}).on('restart', function(files) {
    console.log('NST Service Restarted because the following file was Updated: ', files);
});