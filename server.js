/*jshint esversion: 6 */

/****************************************************************************************
	NST-Streaming
	Authors: Anthony Santilli and Eric Schott
	Copyright 2017, 2018 Anthony Santilli

	Big thanks to Greg Hesp (@ghesp) for portions of the code and your helpful ideas.
*****************************************************************************************/

var appVer = '2.0.1';
const nest_api_url = 'https://developer-api.nest.com';
const logger = require('./logging');

var http = require('http');
var request = require('request');
var express = require('express');

var os = require('os');
var EventSource = require('eventsource');
var app = express();

const fs = require('fs');
const logDir = 'logs';
// Create the log directory if it does not exist
if (!fs.existsSync(logDir)) { fs.mkdirSync(logDir); }

var evtSource;

var nestToken = null;
var stHubIp = null;
var useLocalHub = false;
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
var savedMyThermostatsorig = {};
var savedMyProtects = {};
var savedMyProtectsorig = {};
var savedMyCameras = {};
var savedMyCamerasorig = {};

var ssdp = require('@achingbrain/ssdp');
var usnVal = 'urn:schemas-upnp-org:service:NST-Streaming:1';
const uuidV4 = require('uuid/v4');
var ssdpServer = null;
var ssdpOn = false;

var spokeWithST = true;
var spokeWithNest = true;

app.post('/stream', function(req, res) {
    nestToken = req.headers.nesttoken;
    stHubIp = req.headers.sthubip;
    useLocalHub = (req.headers.localstream === "true");
    callbackUrl = req.headers.callback;
    requestStreamOn = req.headers.connstatus;
    stToken = req.headers.sttoken;
    structure = req.headers.structure;
    // logger.debug(JSON.stringify(req.headers));
    manageStream();
});

//Returns Status of Service
app.post('/status', function(req, res) {
    callbackUrl = req.headers.callback;
    stHubIp = req.headers.sthubip;
    useLocalHub = (req.headers.localstream === "true");
    stToken = req.headers.sttoken;
    structure = req.headers.structure;
    logger.info('SmartThings is Requesting Status... | PID: ' + process.pid);
    sendStatusToST('StatusRequest');
});

function manageStream() {
    if (isStreaming && requestStreamOn == 'false') {
        logger.info('Request to Stop stream Received... | PID: ' + process.pid);
        if (evtSource) {
            evtSource.close();
            logger.info('Nest Connection has been Closed');
        }
        resetSaved();
        isStreaming = false;
        sendStatusToST('ManagerClosed');
        //let a = gracefulStopNoMsg();
        ssdpSrvStart();

    } else if (!isStreaming && requestStreamOn == 'true') {
        logger.info('Request to Start stream Received... | PID: ' + process.pid);
        resetSaved();
        sendTimerActive = false;
        startStreaming();
        isStreaming = true;
        stopSsdp();
    } else {
        logger.info('Streaming is ' + isStreaming, '| requestStreamOn is ' + requestStreamOn, ' Received... | PID: ' + process.pid);
    }
}

function resetSaved() {
    savedMyStruct = {};
    savedMyMeta = {};
    savedMyThermostats = {};
    savedMyThermostatsorig = {};
    savedMyProtects = {};
    savedMyProtectsorig = {};
    savedMyCameras = {};
    savedMyCamerasorig = {};
    lastEventData = null;
}

function startStreaming() {
    //logger.debug("Start Stream");
    evtSource = new EventSource(nest_api_url + '?auth=' + nestToken);

    evtSource.addEventListener('put', function(e) {
        var data = e.data;
        //logger.debug(data);
        try {
            logger.info('New Nest API Event Data Received... | PID: ' + process.pid);
            allEventCount += 1;
            spokeWithNest = true;
            if (structure && data && lastEventData != data) {
                var chgd = false;
                var somechg = false;

                var t0 = JSON.parse(data);
                var mydata = {};
                mydata = t0.data;

                var mymeta = {};
                mymeta = mydata.metadata;
                if (JSON.stringify(mymeta) != JSON.stringify(savedMyMeta)) {
                    chgd = true;
                    logger.info('myMeta changed ');
                }
                savedMyMeta = mymeta;

                var mystruct = {};
                mystruct = mydata.structures[structure];
                if (JSON.stringify(mystruct) != JSON.stringify(savedMyStruct)) {
                    chgd = true;
                    logger.info('myStruct changed structure ' + structure);
                }
                savedMyStruct = mystruct;

                if (mystruct.thermostats) {
                    var tLen = mystruct.thermostats.length;
                    for (i = 0; i < tLen; i++) {
                        var t1 = mystruct.thermostats[i];

                        var adjT1 = {};
                        adjT1 = mydata.devices.thermostats[t1];
                        if (JSON.stringify(adjT1) != JSON.stringify(savedMyThermostatsorig[t1])) {
                            savedMyThermostatsorig[t1] = adjT1;
                            if (adjT1.last_connection) {
                                somechg = true;
                                adjT1.last_connection = "";
                            }
                        }

                        if (JSON.stringify(adjT1) != JSON.stringify(savedMyThermostats[t1])) {
                            chgd = true;
                            //logger.info('mystruct.thermostats ' + JSON.stringify(mystruct.thermostats));
                            logger.info('thermostat changed ' + JSON.stringify(mystruct.thermostats[i]));
                            //logger.info('typeof mystruct... ' + typeof t1);
                            //logger.info('typeof mydata... ' + typeof mydata.devices.thermostats[t1]);
                        }
                        savedMyThermostats[t1] = adjT1;
                    }
                }

                if (mystruct.smoke_co_alarms) {
                    var pLen = mystruct.smoke_co_alarms.length;
                    for (i = 0; i < pLen; i++) {
                        var p1 = mystruct.smoke_co_alarms[i];

                        var adjP1 = {};
                        adjP1 = mydata.devices.smoke_co_alarms[p1];
                        if (JSON.stringify(adjP1) != JSON.stringify(savedMyProtectsorig[p1])) {
                            savedMyProtectsorig[p1] = adjP1;
                            if (adjP1.last_connection) {
                                somechg = true;
                                adjP1.last_connection = "";
                            }
                        }

                        if (JSON.stringify(adjP1) != JSON.stringify(savedMyProtects[p1])) {
                            chgd = true;
                            //logger.info('mystruct.protects ' + JSON.stringify(mystruct.protects));
                            logger.info('protect changed ' + JSON.stringify(mystruct.smoke_co_alarms[i]));
                        }
                        savedMyProtects[p1] = adjP1;
                    }
                }

                if (mystruct.cameras) {
                    var cLen = mystruct.cameras.length;
                    for (i = 0; i < cLen; i++) {
                        var c1 = mystruct.cameras[i];
                        var adjC1 = {};
                        var adjC2 = {};
                        adjC1 = mydata.devices.cameras[c1];
                        adjC2 = savedMyCamerasorig[c1];
                        var myisonline = adjC1.is_online;
                        var myisstreaming = adjC1.is_streaming;
                        // logger.info('myisstreaming: ' + myisstreaming, 'myisonline: ' + myisonline);

                        if (JSON.stringify(adjC1) != JSON.stringify(adjC2)) {
                            savedMyCamerasorig[c1] = adjC1;
                            if (!myisonline || !myisstreaming) {
                                somechg = true;
                                if (adjC1.web_url) {
                                    adjC1.web_url = "";
                                }
                                if (adjC1.snapshot_url) {
                                    adjC1.snapshot_url = "";
                                }
                                if (adjC1.app_url) {
                                    adjC1.app_url = "";
                                }
                                if (adjC1.last_event) {
                                    if (adjC1.last_event.image_url) {
                                        adjC1.last_event.image_url = "";
                                    }
                                    if (adjC1.last_event.web_url) {
                                        adjC1.last_event.web_url = "";
                                    }
                                    if (adjC1.last_event.app_url) {
                                        adjC1.last_event.app_url = "";
                                    }
                                    if (adjC1.last_event.animated_image_url) {
                                        adjC1.last_event.animated_image_url = "";
                                    }
                                }
                            }
                        }
                        adjC2 = savedMyCameras[c1];
                        if (JSON.stringify(adjC1) != JSON.stringify(adjC2)) {
                            chgd = true;
                            //logger.info('mystruct.cameras ' + JSON.stringify(mystruct.cameras));
                            logger.info('camera changed ' + JSON.stringify(mystruct.cameras[i]));
                        }
                        savedMyCameras[c1] = adjC1;
                    }
                }

                // if((eventCount % 5) == 0) {
                //     logger.info('mydata.devices ' + JSON.stringify(mydata.devices));
                //     logger.info('mydata.metadata ' + JSON.stringify(mydata.metadata));
                //     logger.info('mydata.structures ' + JSON.stringify(mydata.structures));
                // }

                lastEventDt = getDtNow();
                lastEventData = data;
                var timeww = 120
                if (chgd) {
                    if (theTimer) { // Override the timer
                        clearTimeout(theTimer);
                        theTimer = null;
                        sendTimerActive = false;
                    }
                    timeww = 2
                }
                if (!theTimer && (somechg || chgd)) {
                    //logger.info('Setting send to ST timer for PID: ' + process.pid);
                    theTimer = setTimeout(function() {
                        sendTimerActive = false;
                        theTimer = null;
                        eventCount += 1;
                        logger.info('Sent Nest API Event Data to NST Manager Client (ST) | LocalHub: (' + useLocalHub + ') | Event#: ' + eventCount + ' / ' + allEventCount);
                        sendDataToST(lastEventData);
                    }, timeww * 1000);
                    sendTimerActive = true;
                }
            }
        } catch (ex) {
            logger.debug('evtSource (catch)...', e, 'readyState: ' + e.readyState);
        }
    });

    evtSource.addEventListener('open', function(e) {
        isStreaming = true;
        resetSaved();
        logger.info('Nest Connection Opened!');
        stopSsdp();
    });

    evtSource.addEventListener('closed', function(e) {
        logger.info('Nest Connection Closed!');
        isStreaming = false;
        resetSaved();
        sendStatusToST('NestConnectionClosed');
        //let a = gracefulStopNoMsg();
        ssdpSrvStart();
    });

    evtSource.addEventListener('auth_revoked', function(e) {
        logger.info('Stream Authentication token was revoked.');
        if (evtSource) {
            evtSource.close();
            logger.info('Nest Connection has been Closed');
        }
        isStreaming = false;
        resetSaved();
        sendStatusToST('Authrevoked');
        //let a = gracefulStopNoMsg();
        ssdpSrvStart();
    });

    //evtSource.addEventListener('error', function(e) {
    evtSource.onerror = function(e) {
        if (e.readyState == EventSource.CLOSED) {
            logger.info('Error listener: Nest API Event Stream Connection was closed! ', e);
        } else {
            logger.info('Error listener: A Stream unknown error occurred: ', e);
            if (evtSource) {
                evtSource.close();
                //console.log(getPrettyDt() + ' - Warn: Streaming Connection has been Closed');
                logger.info('Nest Connection has been Closed');
            }
        }
        isStreaming = false;
        resetSaved();
        sendStatusToST('NestStreamError');
        //let a = gracefulStopNoMsg();
        ssdpSrvStart();
    };
    //}, false);
}

function sendDataToST(data) {
    // logger.debug('sendDataToST: useLocalHub ' + useLocalHub + ' and stHubIp ' + stHubIp + ' found');
    if (useLocalHub === true) {
        if (data && stHubIp) {
            var options = {
                uri: 'http://' + stHubIp + ':39500/event',
                method: 'POST',
                headers: {
                    'evtSource': 'NST_Stream',
                    'evtType': 'sendEventData'
                },
                body: data
            };
            request(options, function(error, response, body) {
                // console.log("sendDataToST Response | message: ", response.statusMessage, ' | status:', response.statusCode);
                if (!error && (response.statusCode === 200 || response.statusCode === 201 || response.statusCode === 202)) {
                    spokeWithST = true;
                    //logger.debug("sendDataToST body.id... ", body.id);
                    isStreaming = true;
                    stopSsdp();
                    return true;
                } else {
                    logger.verbose('sendDataToST...error ', error, response.statusCode, response.statusMessage);
                    resetSaved();
                    return false;
                }
            });
        } else {
            logger.trace('sendDataToST: Can\'t send Event Data to SmartThings because the your SmartThings Hub IP is missing...');
        }
    } else {
        //logger.debug('sendDataToST: url ' + callbackUrl + ' and token ' + stToken + ' found');
        if (data && callbackUrl && stToken) {
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
                    resetSaved();
                    return false;
                }
            });
        } else {
            logger.trace('sendDataToST: Can\'t send Status back to SmartThings because the enpoint url or access token are missing...');
        }
    }
}

function sendStatusToST(reason) {
    // logger.debug('sendStatusToST: useLocalHub ' + useLocalHub + ' and sthubIp ' + stHubIp + ' found');
    if (useLocalHub === true) {
        if (stHubIp) {
            var request2 = require('request');
            var options = {
                uri: 'http://' + stHubIp + ':39500/event',
                method: 'POST',
                headers: {
                    'evtSource': 'NST_Stream',
                    'evtType': 'streamStatus'
                },
                body: {
                    'streaming': isStreaming,
                    'version': appVer,
                    'startupDt': getServiceUptime(),
                    'lastEvtDt': lastEventDt,
                    'sessionEvts': eventCount,
                    'hostInfo': getHostInfo(),
                    'exitReason': reason
                },
                json: true
            };
            request2(options, function(error, response, body) {
                // console.log("sendStatusToST Response | message: ", response.statusMessage, ' | status:', response.statusCode);
                if (!error && (response.statusCode === 200 || response.statusCode === 201 || response.statusCode === 202)) {
                    spokeWithST = true;
                    //logger.debug("sendStatusToST...body ", body.id);
                    return true;
                } else {
                    logger.verbose('sendStatusToST...error', error, response.statusCode, response.statusMessage);
                    return false;
                }
            });
        } else {
            logger.trace('sendStatusToST: Can\'t send Status back to SmartThings because the your SmartThings Hub IP is missing...');
        }
    } else {
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
}

function ssdpSrvInit() {
    if (ssdpServer === null) {
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
    if (!ssdpOn) {
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
    if (ssdpOn) {
        logger.info('stopSsdp: (PID: ' + process.pid + ')');
        ssdpOn = false;
        try {
            ssdpServer.stop();
            logger.info('ssdp terminated');
        } catch (e) {
            logger.warn('ssdp terminated');
        }
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
        if (levels[i][0] === 0) continue;
        returntext += ' ' + levels[i][0] + ' ' + (levels[i][0] === 1 ? levels[i][1].substr(0, levels[i][1].length - 1) : levels[i][1]);
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
    if (spokeWithST && spokeWithNest) {
        logger.info('Watchdog run | ProcessId: ' + process.pid);
        spokeWithST = false;
        spokeWithNest = false;
    } else {
        logger.info('Watchdog timeout | ProcessId: ' + process.pid);
        sendStatusToST('WatchDog');
        let a = gracefulStopNoMsg();
    }
}, 35 * 60 * 1000);

var hostAddr = getIPAddress();

var port = process.env.NST_STREAM_PORT || 3000;
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
    resetSaved();
    isStreaming = false;
    if (evtSource) {
        evtSource.close(function() {
            console.log('Nest Connection has been Closed');
        });
    }

    console.log('graceful setting timeout for PID: ' + process.pid);
    setTimeout(function() {
        console.error("Could not close connections in time, forcefully shutting down");
        process.exit(1);
    }, 2 * 1000);
};

var gracefulStop = function() {
    logger.debug('gracefulStop: ', 'ClosedByNodeService ' + process.pid);
    resetSaved();
    isStreaming = false;
    sendStatusToST('ClosedByNodeService');
    a = gracefulStopNoMsg();
};

//do something when app is closing
process.on('exit', exitHandler.bind(null, {
    exit: true
}));

//catches ctrl+c event
process.on('SIGINT', gracefulStop);

process.on('SIGUSR2', gracefulStop);

process.on('SIGHUP', gracefulStop);

process.on('SIGTERM', gracefulStop);