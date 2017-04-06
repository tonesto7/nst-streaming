/*jshint esversion: 6 */
/*
	NST-Streaming
	Author: Anthony Santilli
	Copyright 2017 Anthony Santilli

	Big thanks to Greg Hesp (@ghesp) for portions of the code and your helpful ideas.
*/

var appVer = '0.7.0';
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

var evtSource;
var nestToken = null;
var stToken = null;
var callbackUrl = null;
var requestStreamOn = false;
var isStreaming = false;
var serviceStartTime = Date.now(); //Returns time in millis
var serviceStartDt = getDtNow();
var lastEventDt = null;
var lastEventData = null;
var eventCount = 0;

var ssdp = require('@achingbrain/ssdp');
var usnVal = 'urn:schemas-upnp-org:service:NST-Streaming:1';
const uuidV4 = require('uuid/v4');
var ssdpServer;
var ssdpOn = false;

var spokeWithST = true;

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
	logger.info('SmartThings is Requesting Status... | PID: ' + process.pid);

	var statRequest = require('request');
	if (callbackUrl && stToken) {
		spokeWithST = true
		statRequest({
			url: callbackUrl + '/streamStatus?access_token=' + stToken,
			method: 'POST',
			json: {
				'streaming': isStreaming,
				'version': appVer,
				'startupDt': getServiceUptime(),
				'sessionEvts': eventCount,
				'lastEvtDt': lastEventDt,
				'hostInfo': getHostInfo()
			}
		}, function(error, response, body) {
			if (error) {
				   logger.verbose('/status error... ', error, response.statusCode, response.statusMessage);
			} else {
				//logger.debug('/status... ', response.statusCode, body);
			}
		});
	} else {
		logger.trace('/status: Can\'t send Status back to SmartThings because the enpoint url or access token are missing...');
	}
});

function manageStream() {
	if (isStreaming && requestStreamOn == 'false') {
		if(evtSource) { evtSource.close(); logger.info('Streaming Connection has been Closed'); }
		lastEventData = null;
		isStreaming = false;
		sendStatusToST('ManagerClosed');
		ssdpSrvInit();

	} else if (!isStreaming && requestStreamOn == 'true') {
		startStreaming();
		isStreaming = true;
		stopSsdp();
	} else {
		isStreaming = false;
		ssdpSrvInit();
	}
}

function startStreaming() {
	//logger.debug("Start Stream");
	evtSource = new EventSource(nest_api_url + '?auth=' + nestToken);
	evtSource.addEventListener('put', function(e) {
		var data = e.data;
		//logger.debug(data);
		try {
			logger.info('New Nest API Event Data Received... | PID: ' + process.pid);
			if (data && lastEventData != data) {
				lastEventDt = getDtNow();
				lastEventData = data;
				eventCount += 1;
				logger.info('Sent Nest API Event Data to NST Manager Client (ST) | Event#: ' + eventCount);
				sendDataToST(data);
			}
		} catch (ex) {
			logger.debug('evtSource (catch)...', e, 'readyState: ' + e.readyState);
		}
	});

	evtSource.addEventListener('open', function(e) {
		logger.info('Nest Connection Opened!');
		isStreaming = true;
		stopSsdp();
	});

	evtSource.addEventListener('closed', function(e) {
		logger.info('Nest Connection Closed!');
		isStreaming = false;
		ssdpSrvInit();
	});

	evtSource.addEventListener('auth_revoked', function(e) {
		logger.info('Stream Authentication token was revoked.');
		if(evtSource) { evtSource.close(); logger.info('Streaming Connection has been Closed'); }
		isStreaming = false;
		lastEventData = null;
		ssdpSrvInit();
		sendStatusToST("Authrevoked");
	});

	//evtSource.addEventListener('error', function(e) {
	evtSource.onerror = function(e) {
		if (e.readyState == EventSource.CLOSED) {
			logger.info('Error listener: Nest API Event Stream Connection was closed! ', e);
		} else {
			logger.info('Error listener: A Stream unknown error occurred: ', e);
			if(evtSource) {
				evtSource.close();
				//console.log(getPrettyDt() + ' - Warn: Streaming Connection has been Closed');
			}
		}
		isStreaming = false;
		ssdpSrvInit();
		lastEventData = null;
		sendStatusToST("StreamError");
	};
	//}, false);
}

function sendDataToST(data) {
	//logger.debug('sendDataToST: url ' + callbackUrl + ' and token ' + stToken + ' found');
	if(data && callbackUrl && stToken) {
		var options = {
			uri: callbackUrl + '/receiveEventData?access_token=' + stToken,
			method: 'POST',
			body: data
		};
		request(options, function(error, response, body) {
			if (!error && (response.statusCode == 200 || response.statusCode == 201)) {
				spokeWithST = true;
				//logger.debug("sendDataToST body.id... ", body.id);
				isStreaming = true;
				stopSsdp();
				return true;
			} else {
				logger.verbose('sendDataToST...error ', error, response.statusCode, response.statusMessage);
				lastEventData = null;
				return false;
			}
		});
	}
}

function sendStatusToST(reason) {
	//logger.debug('sendStatusToST: url ' + callbackUrl + ' and token ' + stToken + ' found, reason: ' + reason);
	if (callbackUrl && stToken) {
		var request2 = require('request');
		var options = {
			uri: callbackUrl + '/streamStatus?access_token=' + stToken,
			method: 'POST',
			json: {
				'streaming': isStreaming,
				'version': appVer,
				'startupDt': getServiceUptime(),
				'lastEvtDt': lastEventDt,
				'sessionEvts': eventCount,
				'hostInfo': getHostInfo(),
				'exitReason': reason
			}
		};
		request2(options, function(error, response, body) {
			if (!error && (response.statusCode == 200 || response.statusCode == 201)) {
				spokeWithST = true;
				//logger.debug("sendStatusToST...body ", body.id);
				return true;
			} else {
				logger.verbose('sendStatusToST...error', error, response.statusCode, response.statusMessage);
				return false;
			}
		});
	} else {
		logger.trace('sendStatusToST: Can\'t send Status back to SmartThings because the enpoint url or access token are missing...');
	}
}

function ssdpSrvInit() {
	if(!ssdpOn) {
		logger.info('ssdpSrvInit: starting (PID: ' + process.pid + ')');

		ssdpServer = ssdp({
			signature: 'node.js/0.12.6 UPnP/1.1 nst-streaming/' + appVer,
			sockets: [{
			    type: 'udp4',
			    broadcast: {
			      address: '239.255.255.250',
			      port: 1900
			    },
			    bind: {
			      address: '0.0.0.0',
			      port: 1900
			    },
			    maxHops: 4
			}]
		});

		ssdpOn = true;

		ssdpServer.advertise({
			usn: usnVal,
			ipv4: true,
			ipv6: false,
			interval: 15000,
			location: {
				udp4: 'http://' + getIPAddress() + ':' + port + '/deviceDesc.xml'
			},
			details: {
				specVersion: {
					major: 1,
					minor: 0
				},
				URLBase: 'http://' + getIPAddress() + ':' + port,
				device: {
					deviceType: usnVal,
					friendlyName: 'NST-Streaming Service',
					serviceIp: getIPAddress(),
					servicePort: port,
					hostName: getHostName(),
					manufacturer: '',
					manufacturerURL: '',
					modelDescription: '',
					modelName: '',
					modelNumber: '',
					modelURL: '',
					serialNumber: '',
					version: appVer,
					UDN: 'uuid:' + uuidV4(),
					presentationURL: '',
					hostInfo: getHostInfo()
				}
			}
		})
		.then(advert => {
			app.get('/deviceDesc.xml', (request, response) => {
				advert.service.details()
				.then(details => {
					spokeWithST = true;
					response.set('Content-Type', 'text/xml');
					response.send(details);
				})
				.catch(error => {
					response.set('Content-Type', 'text/xml');
					response.send(error);
				});
			});
		});
		logger.info('Activated SSDP Broadcast for SmartThings hub to detect...');

		//ssdpServer.on('error', console.error);
		// ssdpServer.on('transport:outgoing-message', (socket, message, remote) => {
		//   console.info('-> Outgoing to %s:%s via %s', remote.address, remote.port, socket.type);
		//   console.info(message.toString('utf8'));
	        // });
		// ssdpServer.on('transport:incoming-message', (message, remote) => {
		//   console.info('<- Incoming from %s:%s', remote.address, remote.port);
		//   console.info(message.toString('utf8'));
		// });
	}
}

function stopSsdp() {
	if(ssdpOn) {
		logger.info('stopSsdp: (PID: ' + process.pid + ')');
		ssdpOn = false;
		ssdpServer.stop();
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

function getHostName() {
	var hostName = os.hostname();
	return hostName;
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
		'ip': getIPAddress(),
		'port': port,
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
			return logger.verbose(e);
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
	var months = Math.floor(time / 31536000);
	time -= months * 2592000;
	var days = Math.floor(time / 86400);
	time -= days * 86400;
	var hours = Math.floor(time / 3600);
	time -= hours * 3600;
	var minutes = Math.floor(time / 60);
	time -= minutes * 60;
	var seconds = parseInt(time % 60, 10);
	return {
		'y': years,
		'mn': months,
		'd': days,
		'h': hours,
		'm': minutes,
		's': seconds
	};
	//return (years + 'y, ' + days + 'd, ' + hours + 'h:' + (minutes < 10 ? '0' + minutes : minutes) + 'm:' + (seconds < 10 ? '0' + seconds : seconds) +'s');
}

function secondsToText(seconds) {
	var levels = [
		[Math.floor(seconds / 31536000), 'years'],
		[Math.floor((seconds % 31536000) / 2592000), 'months'],
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

let intervalObj = setInterval(() => {
	if(spokeWithST) {
		logger.info('Watchdog run | ProcessId: ' + process.pid);
		spokeWithST = false;
	} else {
		logger.info('Watchdog timeout | ProcessId: ' + process.pid);
		let a = gracefulStop();
	}
}, 10*60*1000);

var hostAddr = getIPAddress();

var port = process.env.PORT || 3000;
app.set('port', port);

var appServer = http.createServer(app);
appServer.listen(port, function() {
	logger.info('NST Stream Service (v' + appVer + ') is Running at (IP: ' + hostAddr + ' | Port: ' + port + ') | ProcessId: ' + process.pid);
	//initializes ssdp broadcasting
	ssdpSrvInit();
	logger.info('Waiting for NST Manager to send the signal to initialize the Nest Event Stream...');
});

process.stdin.resume(); //so the program will not close instantly

function exitHandler(options, err) {
	isStreaming = false;
	console.log('exitHandler: (PID: ' + process.pid + ')', options, err);
	if (options.cleanup) {
		logger.info('exitHandler: ', 'ClosedByUserConsole');
		sendStatusToST('ClosedByUserConsole');
	} else if (err) {
		logger.info('exitHandler error', err);
		sendStatusToST('ClosedByError');
		if (options.exit) process.exit(1);
	}
	process.exit();
}

var gracefulStop = function() {
	logger.debug('gracefulStop: ', 'ClosedByUserConsole ' + process.pid);
	lastEventData = null;
	isStreaming = false;
	sendStatusToST('ClosedByUserConsole');
	if(evtSource) {
		evtSource.close(function () {
			console.log('Nest Streaming Connection has been Closed');
		});
	}

	console.log('graceful setting timeout for PID: ' + process.pid);
	setTimeout(function() {
			console.error("Could not close connections in time, forcefully shutting down");
			process.exit(1);
	}, 2*1000);
};

//do something when app is closing
process.on('exit', exitHandler.bind(null, { exit: true }));

//catches ctrl+c event
process.on('SIGINT', gracefulStop);

process.on('SIGUSR2', gracefulStop);

process.on('SIGHUP', gracefulStop);

process.on('SIGTERM', gracefulStop);

//catches uncaught exceptions
//process.once('uncaughtException', exitHandler.bind(null, { cleanup: true, exit: true }));
