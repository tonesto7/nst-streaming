/*jshint esversion: 6 */
/*
	NST-Streaming
	Version 0.2.0
	Author: Anthony Santilli
	Copyright 2017 Anthony Santilli

	Big thanks to Greg Hesp (@ghesp) for portions of the code and your helpful ideas.
*/

var appVer = '0.2.0';
const nest_api_url = 'https://developer-api.nest.com';
const winston = require('winston');
const fs = require('fs');

var http = require('http');
var request = require('request');
var express = require('express');
var os = require('os');
var EventSource = require('eventsource');
var app = express();

const moment = require('moment');
const tsFormat = () => getPrettyDt();
const logDir = 'logs';
// Create the log directory if it does not exist
if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir);
}

var source;
var nestToken = null;
var stToken = null;
var callbackUrl = null;
var requestStreamOn = false;
var isStreaming = false;
var serviceStartTime = Date.now(); //Returns time in millis
var serviceStartDt = getDtNow();
var lastEventDt = null;
var lastEventData = null;

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
			filename: `${logDir}/ - NST_Streaming_Service.log`,
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

app.post('/stream', function(req, res) {
	nestToken = req.headers.nesttoken;
	callbackUrl = req.headers.callback;
	requestStreamOn = req.headers.connstatus;
	stToken = req.headers.sttoken;
	//logger.debug(req.headers);
	manageStream();
});

//Returns Status of Service
app.post('/status', function(req, res) {
	callbackUrl = req.headers.callback;
	stToken = req.headers.sttoken;
	logger.info('SmartThings is Requesting Status...');

	var statRequest = require('request');
	if (callbackUrl && stToken) {
		statRequest({
			url: callbackUrl + '/streamStatus?access_token=' + stToken,
			method: 'POST',
			json: {
				'streaming': isStreaming,
				'version': appVer,
				'startupDt': getServiceUptime(),
				'lastEvtDt': lastEventDt,
				'hostInfo': getHostInfo()
			}
		}, function(error, response, body) {
			if (error) {
				   logger.error('/status error... ', error, response.statusCode, response.statusMessage);
			} else {
				//logger.debug('/status... ', response.statusCode, body);
			}
		});
	} else {
		logger.warn('/status: Can\'t send Status back to SmartThings because the enpoint url or access token are missing...');
	}
});

function manageStream() {
	if (isStreaming && requestStreamOn == 'false') {
		source.close();
		logger.warn('Streaming Connection has been Closed');
		lastEventData = null;
		isStreaming = false;
		sendStatusToST('ManagerClosed');
	} else if (!isStreaming && requestStreamOn == 'true') {
		startStreaming();
		isStreaming = true;
	} else {
		isStreaming = false;
	}
}

function startStreaming() {
	//logger.debug("Start Stream");
	source = new EventSource(nest_api_url + '?auth=' + nestToken);
	source.addEventListener('put', function(e) {
		var data = e.data;
		//logger.debug(data);
		logger.info('New Nest API Event Data Received...');
		if (data && lastEventData != data) {
			lastEventDt = getDtNow();
			lastEventData = data;
			logger.info("Sent Nest Event Data to NST Manager Client (ST)");
			if (sendDataToST(data) === true) {
// this is never reached...
				isStreaming = true;
			}
		}
	});
	source.addEventListener('open', function(e) {
		logger.info('Nest Connection Opened!');
		isStreaming = true;
	});
	source.addEventListener('auth_revoked', function(e) {
		logger.warn('Stream Authentication token was revoked.');
		source.close();
		isStreaming = false;
		lastEventData = null;
		sendStatusToST("ManagerClosed");
	});
	source.addEventListener('error', function(e) {
		if (e.readyState == EventSource.CLOSED) {
			logger.warn('Stream Connection was closed! ', e);
		} else {
			logger.error('A Stream unknown error occurred: ', e);
		}
		source.close();
		isStreaming = false;
		lastEventData = null;
		sendStatusToST("ManagerClosed");
	}, false);
}

function sendDataToST(data) {
	var options = {
		uri: callbackUrl + '/receiveEventData?access_token=' + stToken,
		method: 'POST',
		body: data
	};
	request(options, function(error, response, body) {
		if (!error && (response.statusCode == 200 || response.statusCode == 201)) {
			//logger.debug("sendDataToST body.id... ", body.id);
			return true;
		} else {
			logger.error('sendDataToST...error ', error, response.statusCode, response.statusMessage);
		lastEventData = null;
			return false;
		}
	});
}

function sendStatusToST(reason) {
	var request2 = require('request');
	if (callbackUrl && stToken) {
		var options = {
			uri: callbackUrl + '/streamStatus?access_token=' + stToken,
			method: 'POST',
			json: {
				'streaming': isStreaming,
				'version': appVer,
				'startupDt': getServiceUptime(),
				'lastEvtDt': lastEventDt,
				'hostInfo': getHostInfo(),
			    'exitReason': reason
			}
		};
		logger.debug('url and token found');
		request2(options, function(error, response, body) {
			if (!error && (response.statusCode == 200 || response.statusCode == 201)) {
				//logger.debug("sendStatusToST...body ", body.id);
				return true;
			} else {
				logger.error('sendStatusToST...error', error, response.statusCode, response.statusMessage);
				return false;
			}
		});
	} else {
		logger.warn('sendStatusToST: Can\'t send Status back to SmartThings because the enpoint url or access token are missing...');
	}
}

function getIPAddress() {
	var interfaces = os.networkInterfaces();
	for (var devName in interfaces) {
		var iface = interfaces[devName];
		for (var i = 0; i < iface.length; i++) {
			var alias = iface[i];
			if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal)
				return alias.address;
		}
	}
	return '0.0.0.0';
}

function getServiceUptime() {
	var now = Date.now();
	var diff = (now - serviceStartTime) / 1000;
	//logger.debug("diff: "+ diff);
	return getHostUptimeStr(diff);
}

function getHostInfo() {
	var hostName = os.hostname();
	var osType = os.type();
	var osArch = os.arch();
	var osRelease = os.release();
	var osPlatform = os.platform();
	var osUptime = parseInt(os.uptime());
	var memTotal = os.totalmem();
	var memFree = os.freemem();

	if (osType != 'Windows_NT') {
		osPlatform = getLinuxPlatform();
	}
	return {
			'hostname': hostName,
			'osType': osType,
			'osArch': osArch,
			'osRelease': osRelease,
			'osPlatform': osPlatform,
			'osUptime': getHostUptimeStr(osUptime),
			'osUptimeStr': secondsToText(osUptime),
			'memTotal': formatBytes(memTotal),
			'memFree': formatBytes(memFree)
	};
}

function getLinuxPlatform() {
	var osval;
	var getos = require('getos');
	getos(function(e, os) {
		if (e) {
			return logger.error(e);
		} else {
			osval = JSON.stringify(os);
		}
	});
	return osval;
}

function getDtNow() {
	var date = new Date();
	return date.toISOString();
}

function getPrettyDt() {
	if (moment) {
		return moment().format('M-D-YYYY - h:mm:ssa');
	}
}

function getHostUptimeStr(time) {
	var years = Math.floor(time / 31536000);
	time -= years * 31536000;
	var days = Math.floor(time / 86400);
	time -= days * 86400;
	var hours = Math.floor(time / 3600);
	time -= hours * 3600;
	var minutes = Math.floor(time / 60);
	time -= minutes * 60;
	var seconds = parseInt(time % 60, 10);
	return (years + 'y, ' + days + 'd, ' + hours + 'h:' + (minutes < 10 ? '0' + minutes : minutes) + 'm:' + (seconds < 10 ? '0' + seconds : seconds) +'s');
}

function secondsToText(seconds) {
    var levels = [
        [Math.floor(seconds / 31536000), 'years'],
        [Math.floor((seconds % 31536000) / 86400), 'days'],
        [Math.floor(((seconds % 31536000) % 86400) / 3600), 'hours'],
        [Math.floor((((seconds % 31536000) % 86400) % 3600) / 60), 'minutes'],
        [(((seconds % 31536000) % 86400) % 3600) % 60, 'seconds'],
    ];
    var returntext = '';

    for (var i = 0, max = levels.length; i < max; i++) {
        if ( levels[i][0] === 0 ) continue;
        returntext += ' ' + levels[i][0] + ' ' + (levels[i][0] === 1 ? levels[i][1].substr(0, levels[i][1].length-1): levels[i][1]);
    }
    return returntext.trim();
}

function formatBytes(bytes) {
	if (bytes < 1024) return bytes + " Bytes";
	else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
	else if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
	else return (bytes / 1073741824).toFixed(1) + " GB";
}

var hostAddr = getIPAddress();

var port = process.env.PORT || 3000;
app.set('port', port);

var server = http.createServer(app);
server.listen(port);
logger.info('NST Stream Service (v' + appVer + ') is Running at (IP: ' + hostAddr + ' | Port: ' + port + ')');
logger.info('Waiting for NST Manager to send this service the signal to initialize the Nest Event Stream...');


process.stdin.resume(); //so the program will not close instantly

function exitHandler(options, err) {
	isStreaming = false;
	if (options.cleanup) {
		logger.debug('exitHandler: ', 'ClosedByUserConsole');
		sendStatusToST('ClosedByUserConsole');
	}
	if (err) {
		logger.error('exitHandler error', err);
		sendStatusToST('ClosedByError');
	}
	if (options.exit) process.exit();
}

//do something when app is closing
process.on('exit', exitHandler.bind(null, { cleanup: true }));
//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, { exit: true }));
//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, { exit: true }));
