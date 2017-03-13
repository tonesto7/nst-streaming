/*

 */

var http = require('http');
var path = require('path');
var request = require('request');
var request2 = require('request');

var express = require('express');
var bodyParser = require('body-parser');
var session = require('express-session');
var EventSource = require('eventsource');
//var mdns = require('mdns');

var isStreaming = false;

var SUPER_SECRET_KEY = 'bmVzdG1hbmdlcnRvbmVzdG8NCg==';

var NEST_API_URL = 'https://developer-api.nest.com';
var app = express();

//var ad = mdns.createAdvertisement(mdns.tcp('Nest-Event-Srvc'), 3000, ({ name: 'Nest Web Manager' }));
//ad.start();


app.post('/stream', function(req, res) {
    var token = req.headers.token;
    //console.log('AuthToken: ' + token)
    var streamPath = req.headers.callback;
    //console.log('StreamUrl: ' + streamPath)
    var streamOn = req.headers.connstatus;
    //console.log(req.headers);
    console.log('streamOn: ' + streamOn);
    var streamPort = req.headers.port;
    var stToken = req.headers.stToken;
    //console.log('ST_Token: ' + stToken);

    var source = new EventSource(NEST_API_URL + '?auth=' + token);
    if (token && streamOn == 'true') {
        source.addEventListener('put', function(e) {
            //var data = JSON.parse(e.data);
            var data = e.data;
            var options = {
                uri: streamPath + '/receiveEventData?access_token=' + stToken,
                method: 'POST',
                body: data
            };
            //console.log(data);
            console.log('New Event Data Received...');

            request(options, function(error, response, body) {
                if (!error && response.statusCode == 200) {
                    console.log(body.id);
                }
            });
            isStreaming = true;
            //res.send('SmartThings Connected');
        });

        source.addEventListener('open', function(e) {
            console.log('SmartThings Connection opened!');
            isStreaming = true;
            res.send('SmartThings Connected');
        });

        source.addEventListener('auth_revoked', function(e) {
            console.log('Stream Authentication token was revoked.');
            isStreaming = false;
        });
        source.onerror = function(e) {
            console.error("Stream Error: " + e.message);
        };
        source.addEventListener('error', function(e) {
            if (e.readyState == EventSource.CLOSED) {
                isStreaming = false;
                console.error('Stream Connection was closed! ', e);
            } else {
                console.error('A Stream unknown error occurred: ', e);
            }
        }, false);
    }
    else if (token && streamOn == 'false') {
        source.close();
        isStreaming = true;
    }
});

app.post('/cmd', function(req, res) {
    var exitCmd = req.headers.exitCmd;
    console.log('Cmd: ' + exitCmd);
    //var source = new EventSource(NEST_API_URL + '?auth=' + token);
    server.close();
});

app.post('/status', function(req, res) {
    var request3 = require('request');
    var callbackUrl = req.headers.callback;
    console.info('callbackUrl: ' + callbackUrl);
    var token = req.headers.token;
    console.info('Token: ' + token);
    console.info('streaming: ' + isStreaming);
    if(callbackUrl && token) {
        request3({
            url: callbackUrl + '/streamStatus?access_token=' + token,
            method: 'POST',
            json: {
                "streaming":isStreaming
            }
        }, function(error, response, body){
            if(error) {
                console.log(error);
            } else {
                console.log(response.statusCode, body);
                console.log('Status request received...');
            }
        });
    }
});


app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(session({
    secret: SUPER_SECRET_KEY,
    resave: false,
    saveUninitialized: false
}));

function getIPAddress() {
    var interfaces = require('os').networkInterfaces();
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

function getDtNow() {
    var dateTime = require('node-datetime');
    var dt = dateTime.create();
    return dt.format('MMM dd, yyyy HH:mm:ss');
}
var address = getIPAddress();

var port = process.env.PORT || 3000;
app.set('port', port);

var server = http.createServer(app);
server.listen(port);
console.info('NST Event Stream Server is Running on (' + address + ') Port: ' + port);
console.info('Send a Post Command to http://' + address + ':' + port + '/stream with this Body (token: "your_auth_token") to Start the Stream');
