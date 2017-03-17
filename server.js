/*jshint esversion: 6 */
/*
	NST-Streaming
	Version 0.2.0
	Author: Anthony Santilli
	Copyright 2017 Anthony Santilli

	Big thanks to Greg Hesp (@ghesp) for portions of the code and your helpful ideas.
 */

const winston = require('winston');
const fs = require('fs');
const moment = require('moment');
const tsFormat = () => getPrettyDt();
const logDir = 'logs';
// Create the log directory if it does not exist
if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir);
}

// This initializes the winston logging instance
var logger = new (winston.Logger)({
	levels: {
	    trace: 0,
	    input: 1,
	    verbose: 2,
	    prompt: 3,
	    debug: 4,
	    info: 5,
	    data: 6,
	    help: 7,
	    warn: 8,
	    error: 9
	},
	colors: {
	    trace: 'magenta',
	    input: 'grey',
	    verbose: 'cyan',
	    prompt: 'grey',
	    debug: 'yellow',
	    info: 'green',
	    data: 'blue',
	    help: 'cyan',
	    warn: 'orange',
	    error: 'red'
	},
	transports: [
		new (winston.transports.Console)({
			levels: 'trace',
			colorize: true,
			prettyPrint: true,
			timestamp: tsFormat
		}),
		new (require('winston-daily-rotate-file'))({
			filename: `${logDir}/ - NST_Monitor_Service.log`,
			levels: 'trace',
			colorize: true,
			prettyPrint: true,
			timestamp: tsFormat,
			json: false,
			localTime: true,
			datePattern: 'MM-dd-yyyy',
			maxFiles: 20,
			prepend: true
		})
	],
	exitOnError: false
});

function getPrettyDt() {
	if (moment) {
		return moment().format('M-D-YYYY - h:mm:ssa');
	}
}

// Beginning of NodeMon Code
var nodemon = require('nodemon');
nodemon({
	script: 'app.js'
});

nodemon.on('start', function() {
	console.log('\x1Bc');
	logger.info('NST Service Monitor has Started');
}).on('quit', function() {
	console.log('\x1Bc');
	logger.info('NST Streaming Service has Quit. Restarting...');
}).on('restart', function(files) {
	console.log('\x1Bc');
	logger.info('NST Service has been restarted because this file was Updated: ', files);
});
