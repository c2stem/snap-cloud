#!/usr/bin/env node

var program = require('commander'),
    express = require('express'),
    snapCloud = require('./snap-cloud'),
    MongoClient = require('mongodb').MongoClient;

function start(directory, options) {
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
                mailer_smpt: undefined
            }));

            if (directory) {
                // Serve static files
                app.use(express.static(directory));
            }

            // Start the server
            app.listen(8080, function () {
                console.log('Listening on port 8080');
            });
        }
    });
}

program.version('1.0.1')
    .option('-m, --mongo <uri>', 'sets MongoDB URI, defaults to //localhost/snapcloud', '//localhost/snapcloud')
    .arguments('[directory]')
    .action(start)
    .parse(process.argv);

// HACK: directory is really optional
if (program.args.length === 0) {
    start(null, program);
}