var express = require('express');
var snapCloud = require('./snap-cloud');
var MongoClient = require('mongodb').MongoClient;

MongoClient.connect('mongodb://localhost/snapcloud', function (err, db) {
    if (err) {
        console.log('Could not connect to MongoDB', err);
    } else {
        console.log('Connected to MongoDB');

        var app = express();

        // Handle snap cloud requests
        app.use('/SnapCloud', snapCloud({
            session_secret: 'SnapCloud',
            cookie_secure: false,
            mongodb: db,
            mailer_from: "no-reply@c2stem.org",
            mailer_smpt: undefined
        }));

        // Serve static files
        app.use(express.static('/home/mmaroti/workspace/snap-physics/'));

        // Start the server
        app.listen(8080, function () {
            console.log('Listening on port 8080');
        });
    }
});