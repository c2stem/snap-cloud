#!/usr/bin/env node

var program = require('commander');

function start(directory, options) {
    if (options.verbose) {
        console.log("Debugging of snap-cloud is enabled");
        process.env['DEBUG'] += ',snap-cloud';
    }

    var express = require('express'),
        snapCloud = require('./snap-cloud'),
        MongoClient = require('mongodb').MongoClient;

    MongoClient.connect('mongodb:' + options.mongo, function (err, db) {
        if (err) {
            console.log('Could not connect to MongoDB at ' + options.mongo, err);
        } else {
            console.log('Connected to MongoDB at ' + options.mongo);

            var app = express();

            // Handle snap cloud requests
            app.use('/SnapCloud', snapCloud({
                session_secret: 'SnapCloud',
                cookie_secure: false,
                mongodb: db,
                mailer_from: "no-reply@c2stem.org",
                mailer_smpt: undefined,
                default_origin: 'http://physics.c2stem.org'
            }));

            if (options.projects) {
                console.log('Listing public projects at projects.html');
                app.use(express.static(__dirname + '/views/'));
            }

            if (directory) {
                console.log('Serving static files from ' + directory);
                app.use(express.static(directory));
            } else {
                console.log('Not serving static files');
            }

            // Start the server
            options.port = +options.port || 8080;
            if (options.collab) {
                console.log('Collaboration is enabled');
                var ws = require('ws'),
                    collaboration = require('snap-collaboration');

                console.log('Listening on port ' + options.port);
                var wss = new ws.Server({
                    server: app.listen(options.port)
                });

                var collab = db.collection('collab');

                // configure the websocket and app
		app.use('/collaboration/*', function(req, res, next) {
		    res.header('Access-Control-Allow-Origin', req.get('origin'));
		    res.header('Access-Control-Allow-Credentials', 'true');
		    res.header('Access-Control-Allow-Methods', 'POST');
		    next();
		});
                collaboration.enable(app, wss, {
                    record: function (json, session) {
                        collab.insertOne({
                            date: new Date(),
                            json: JSON.stringify(json),
                            session: session
                        });
                    }
                });
            } else {
                console.log('Collaboration is disabled');
                app.listen(options.port, function () {
                    console.log('Listening on port ' + options.port);
                });
            }
        }
    });
}

program.version('1.0.2')
    .option('-m, --mongo <uri>', 'sets MongoDB URI [//localhost/snapcloud]', '//localhost/snapcloud')
    .option('-v, --verbose', 'enable logging of snap-cloud')
    .option('-p, --port <n>', 'port number to use [8080]', 8080)
    .option('--no-projects', 'disable the listing of public projects')
    .option('--no-collab', 'disable the collaboration service')
    .arguments('[directory]')
    .action(start)
    .parse(process.argv);

// HACK: directory is really optional
if (program.args.length === 0) {
    start(null, program);
}
