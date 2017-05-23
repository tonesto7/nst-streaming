/*jshint esversion: 6 */
/*
	NST-Streaming
	Authors: Anthony Santilli and Eric Schott
	Copyright 2017 Anthony Santilli

	Big thanks to Greg Hesp (@ghesp) for portions of the code and your helpful ideas.
*/

var appVer = '0.8.5';
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
var structure = null;

var sendTimerActive = false;
var theTimer = null;
var isStreaming = false;
var serviceStartTime = Date.now(); //Returns time in millis
var serviceStartDt = getDtNow();
var lastEventDt = null;
var lastEventData = null;
var eventCount = 0;
var allEventCount = 0;

var savedMyStruct = {};
var savedMyMeta = {};
var savedMyThermostats = {};
var savedMyProtects = {};
var savedMyCameras = {};

var ssdp = require('@achingbrain/ssdp');
var usnVal = 'urn:schemas-upnp-org:service:NST-Streaming:1';
const uuidV4 = require('uuid/v4');
var ssdpServer = null;
var ssdpOn = false;

var spokeWithST = true;
var spokeWithNest = true;

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
	structure = req.headers.structure;
	//logger.debug(req.headers);
	manageStream();
});

//Returns Status of Service
app.post('/status', function(req, res) {
	callbackUrl = req.headers.callback;
	stToken = req.headers.sttoken;
	structure = req.headers.structure;
	logger.info('SmartThings is Requesting Status... | PID: ' + process.pid);

	var statRequest = require('request');
	if (callbackUrl && stToken) {
		spokeWithST = true;
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
		//let a = gracefulStopNoMsg();
		ssdpSrvStart();

	} else if (!isStreaming && requestStreamOn == 'true') {
		sendTimerActive = false;
		startStreaming();
		isStreaming = true;
		stopSsdp();
	} else {
		isStreaming = false;
		lastEventData = null;
		sendStatusToST('ManagerClosed');
		//let a = gracefulStopNoMsg();
		ssdpSrvStart();
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
			if (structure && data && lastEventData != data) {
				var chgd = false;

				var t0 = JSON.parse(data);
				var mydata = {};
				mydata = t0.data;

				var mymeta =  {};
				mymeta = mydata.metadata;
				if(JSON.stringify(mymeta) != JSON.stringify(savedMyMeta)) {
					chgd = true;
					logger.info('myMeta changed ');
				}
				savedMyMeta = mymeta;

				var mystruct = {};
				mystruct = mydata.structures[structure];
				if(JSON.stringify(mystruct) != JSON.stringify(savedMyStruct)) {
					chgd = true;
					logger.info('myStruct changed structure ' + structure);
				}
				savedMyStruct = mystruct;

				if(mystruct.thermostats) {
					var tLen = mystruct.thermostats.length;
					for (i = 0; i < tLen; i++) {
						var t1 = mystruct.thermostats[i];
						if(JSON.stringify(mydata.devices.thermostats[t1]) != JSON.stringify(savedMyThermostats[t1])) {
							chgd = true;
							//logger.info('mystruct.thermostats ' + JSON.stringify(mystruct.thermostats));
							logger.info('thermostat changed ' + JSON.stringify(mystruct.thermostats[i]));
							//logger.info('typeof mystruct... ' + typeof t1);
							//logger.info('typeof mydata... ' + typeof mydata.devices.thermostats[t1]);
						}
						savedMyThermostats[t1] = mydata.devices.thermostats[t1];
					}
				}

				if(mystruct.protects) {
					var pLen = mystruct.protects.length;
					for (i = 0; i < pLen; i++) {
						var p1 = mystruct.protects[i];
						if(JSON.stringify(mydata.devices.protects[p1]) != JSON.stringify(savedMyProtects[p1])) {
							chgd = true;
							//logger.info('mystruct.protects ' + JSON.stringify(mystruct.protects));
							logger.info('protect changed ' + JSON.stringify(mystruct.protects[i]));
						}
						savedMyProtects[p1] = mydata.devices.protects[p1];
					}
				}

				if(mystruct.cameras) {
					var cLen = mystruct.cameras.length;
					for (i = 0; i < cLen; i++) {
						var c1 = mystruct.cameras[i];
						var adjC1 = {};
						var adjC2 = {};
						adjC1 = mydata.devices.cameras[c1];
						adjC2 = savedMyCameras[c1];
						var myisonline = adjC1.is_online;
						var myisstreaming = adjC1.is_streaming;
						logger.info('myisstreaming myisonline ' + myisstreaming + ' ' + myisonline);
						if(!myisonline || !myisstreaming) {
							if(adjC1.web_url) { adjC1.web_url = ""; }
							if(adjC1.snapshot_url) { adjC1.snapshot_url = ""; }
							if(adjC1.app_url) { adjC1.app_url = ""; }
							if(adjC1.last_event) {
								if(adjC1.last_event.image_url) { adjC1.last_event.image_url = ""; }
								if(adjC1.last_event.web_url) { adjC1.last_event.web_url = ""; }
								if(adjC1.last_event.app_url) { adjC1.last_event.app_url = ""; }
								if(adjC1.last_event.animated_image_url) { adjC1.last_event.animated_image_url = ""; }
							}
						}
						if(JSON.stringify(adjC1) != JSON.stringify(adjC2)) {
							chgd = true;
							//logger.info('mystruct.cameras ' + JSON.stringify(mystruct.cameras));
							logger.info('camera changed ' + JSON.stringify(mystruct.cameras[i]));
						}
						savedMyCameras[c1] = adjC1;
					}
				}

/*
				if((eventCount % 5) == 0) {
					logger.info('mydata.devices ' + JSON.stringify(mydata.devices));
					logger.info('mydata.metadata ' + JSON.stringify(mydata.metadata));
					logger.info('mydata.structures ' + JSON.stringify(mydata.structures));
				}
*/
				if(chgd) {
					if(theTimer) {
						clearTimeout(theTimer);
						theTimer = null;
					}
					lastEventDt = getDtNow();
					lastEventData = data;
					//logger.info('Setting send to ST timer for PID: ' + process.pid);
					theTimer = setTimeout(function() {
						sendTimerActive = false;
						theTimer = null;
						eventCount += 1;
						logger.info('Sent Nest API Event Data to NST Manager Client (ST) | Event#: ' + eventCount + ' / ' + allEventCount);
						sendDataToST(lastEventData);
					}, 2*1000);
					sendTimerActive = true;
				}
			}
			allEventCount += 1;
			spokeWithNest = true;
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
		lastEventData = null;
		sendStatusToST('NestConnectionClosed');
		//let a = gracefulStopNoMsg();
		ssdpSrvStart();
	});

	evtSource.addEventListener('auth_revoked', function(e) {
		logger.info('Stream Authentication token was revoked.');
		if(evtSource) { evtSource.close(); logger.info('Streaming Connection has been Closed'); }
		isStreaming = false;
		lastEventData = null;
		sendStatusToST("Authrevoked");
		//let a = gracefulStopNoMsg();
		ssdpSrvStart();
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
		lastEventData = null;
		sendStatusToST("NestStreamError");
		//let a = gracefulStopNoMsg();
		ssdpSrvStart();
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
	if(ssdpServer == null) {
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
		ssdpSrvStart();
	}
}

function ssdpSrvStart() {
	if(!ssdpOn) {
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
	if(spokeWithST && spokeWithNest) {
		logger.info('Watchdog run | ProcessId: ' + process.pid);
		spokeWithST = false;
		spokeWithNest = false;
	} else {
		logger.info('Watchdog timeout | ProcessId: ' + process.pid);
		sendStatusToST('WatchDog');
		let a = gracefulStopNoMsg();
	}
}, 35*60*1000);

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
		sendStatusToST('ClosedExitHandler');
	} else if (err) {
		logger.info('exitHandler error', err);
		sendStatusToST('ClosedByError');
		if (options.exit) process.exit(1);
	}
	process.exit();
}

var gracefulStopNoMsg = function() {
	logger.debug('gracefulStopNoMsg: ', process.pid);
	lastEventData = null;
	isStreaming = false;
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

var gracefulStop = function() {
	logger.debug('gracefulStop: ', 'ClosedByNodeService ' + process.pid);
	lastEventData = null;
	isStreaming = false;
	sendStatusToST('ClosedByNodeService');
	a = gracefulStopNoMsg();
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
