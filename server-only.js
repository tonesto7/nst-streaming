/*
	NST-Streaming
	Version 0.0.2
	Author: Anthony Santilli
	Copyright 2017 Anthony Santilli

	Big thanks to Greg Hesp (@ghesp) for portions of the code and your helpful ideas.
 */

var codeVer = "0.0.2";
var http = require('http');
var path = require('path');
var request = require('request');

var express = require('express');
var bodyParser = require('body-parser');
var session = require('express-session');
var moment = require('moment');
var os = require("os");
var EventSource = require('eventsource');
var app = express();

//var mdns = require('mdns');
var nest_api_url = 'https://developer-api.nest.com';
var source;
var nestToken = null;
var stToken = null;
var callbackUrl = null;
var requestStreamOn = false;
var isStreaming = false;
var serviceStartTime = Date.now();
var serviceStartDt = getDtNow();
var lastEventDt = null;

//var ad = mdns.createAdvertisement(mdns.tcp('NST-Streaming'), 3000, ({ name: 'NST Streaming Service' }));
//ad.start();

app.post('/stream', function(req, res) {
	nestToken = req.headers.nesttoken;
	callbackUrl = req.headers.callback;
	requestStreamOn = req.headers.connstatus;
	stToken = req.headers.sttoken;
	//console.log(req.headers);
	manageStream();
});

//Returns Status of Service
app.post('/status', function(req, res) {
	callbackUrl = req.headers.callback;
	stToken = req.headers.sttoken;
	console.log('[' + getPrettyDt()+']: ', 'Status request received...');

	var statRequest = require('request');
	if (callbackUrl && stToken) {
		statRequest({
			url: callbackUrl + '/streamStatus?access_token=' + stToken,
			method: 'POST',
			json: {
				"streaming": isStreaming,
				"version": codeVer,
				"startupDt": getServiceUptime(),
				"lastEvtDt": lastEventDt,
				"hostInfo":getHostInfo()
			}
		}, function(error, response, body) {
			if (error) {
				console.log(error);
			} else {
				//console.log(response.statusCode, body);
			}
		});
	}
});

function manageStream() {
	if (isStreaming && requestStreamOn == 'false') {
		source.close();
		sendStatusToST("ManagerClosed");
		console.log('[' + getPrettyDt()+']: ', "Streaming Connection has been Closed");
		isStreaming = false;
	} else if (!isStreaming && requestStreamOn == 'true') {
		startStreaming();
		isStreaming = true;
	} else {
		isStreaming = false;
	}
}

function startStreaming() {
	//console.log("Start Stream");
	source = new EventSource(nest_api_url + '?auth=' + nestToken);
	source.addEventListener('put', function(e) {
		var data = e.data;
		//console.log(data);
		if(data) {
			console.log('[' + getPrettyDt()+']: ', 'New Event Data Received...');
			lastEventDt = getDtNow();
			if (sendDataToST(data)) {
				isStreaming = true;
			}
		}
	});
	source.addEventListener('open', function(e) {
		console.log('[' + getPrettyDt()+']: ', 'SmartThings Connection Opened!');
		isStreaming = true;
	});
	source.addEventListener('auth_revoked', function(e) {
		console.log('Stream Authentication token was revoked.');
		isStreaming = false;
		source.close();
	});
	source.addEventListener('error', function(e) {
		if (e.readyState == EventSource.CLOSED) {
			console.error('[' + getPrettyDt()+']: ', 'Stream Connection was closed! ', e);
		} else {
			console.error('[' + getPrettyDt()+']: ', 'A Stream unknown error occurred: ', e);
		}
		isStreaming = false;
		source.close();
	}, false);
}

function sendDataToST(data) {
	var options = {
		uri: callbackUrl + '/receiveEventData?access_token=' + stToken,
		method: 'POST',
		body: data
	};
	request(options, function(error, response, body) {
		if (!error && response.statusCode == 200) {
			console.log(body.id);
			return true;
		} else if (error) {
			console.log(error);
			return false;
		}
	});
}

function sendStatusToST(reason) {
	var request2 = require('request');
	var bData = { "exitReason": reason };
	if (callbackUrl && stToken) {
		var options = {
			uri: callbackUrl + '/streamStatus?access_token=' + stToken,
			method: 'POST',
			body: JSON.stringify(bData)
		};
		console.log("url and token found");
		request2(options, function(error, response, body) {
			if (!error && response.statusCode == 200) {
				console.log(body.id);
				return true;
			} else if (error) {
				console.log(error);
				return false;
			}
		});
	} else {
		console.log("sendStatusToST: Can't send status because url or token missing...");
	}
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
	extended: false
}));

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
	var diff = (now-serviceStartTime) /1000;
	//console.log("diff: "+ diff);
	return getHostUptimeStr(diff);
}

function getHostInfo() {
	var hostName = os.hostname();
	var osType = os.type();
	var osArch = os.arch();
	var osRelease = os.release();
	var osPlatform = os.platform();
	var osUptime = os.uptime();
	var memTotal = os.totalmem();
	var memFree = os.freemem();

	if(osType != "Windows_NT") {
		osPlatform = getLinuxPlatform();
	}
	return { "hostname":hostName, "osType":osType, "osArch": osArch, "osRelease": osRelease, "osPlatform": osPlatform, "osUptime":getHostUptimeStr(osUptime), "memTotal":formatBytes(memTotal), "memFree":formatBytes(memFree)};
}

function getLinuxPlatform() {
	var osval;
	var getos = require('getos');
	getos(function(e,os) {
	  	if(e) {
			return console.log(e);
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
	if(moment) {
		return moment().format('MMMM Do YYYY, h:mm:ss a');
	}
}

function getHostUptimeStr(time) {
	var hours = Math.floor(time / 3600);
	time -= hours * 3600;
	var minutes = Math.floor(time / 60);
	time -= minutes * 60;
	var seconds = parseInt(time % 60, 10);
	//console.log(hours + ' Hours - ' + minutes + ' Minutes and ' + seconds + " Seconds");
	return (hours + ' Hrs - ' + minutes + ' Min and ' + seconds + " Sec");
}

function formatBytes(bytes) {
    if(bytes < 1024) return bytes + " Bytes";
    else if(bytes < 1048576) return(bytes / 1024).toFixed(1) + " KB";
    else if(bytes < 1073741824) return(bytes / 1048576).toFixed(1) + " MB";
    else return(bytes / 1073741824).toFixed(1) + " GB";
}

var hostAddr = getIPAddress();

var port = process.env.PORT || 3000;
app.set('port', port);

var server = http.createServer(app);
server.listen(port);
console.info('NST Stream Service (v' + codeVer + ') is Running at (IP: ' + hostAddr + ' | Port: ' + port+')');
console.info('Waiting for NST Manager client to send the required data in order to initialize the Nest Event Stream');


process.stdin.resume();//so the program will not close instantly

function exitHandler(options, err) {
    if (options.cleanup) {
		sendStatusToST("ClosedByUserConsole");
	 }
    if (err) {
		sendStatusToST("ClosedByError");
	}
    if (options.exit) process.exit();
}

//do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));
//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));
//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));
