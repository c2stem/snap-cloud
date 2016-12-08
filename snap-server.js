'use strict';

var express = require('express');
var bodyParser = require('body-parser');
var session = require('express-session');
var onHeaders = require('on-headers');
var MongoStore = require('connect-mongo')(session);
var cookieParser = require('cookie');
var debug = require('debug')('snap-server');

function snapServer(options) {
    var router = express.Router(),
        users = options.mongodb.collection('users'),
        services = {};

    router.addSnapApi = function addSnapApi(name, parameters, method) {
        services[name] = {
            parameters: parameters,
            method: method
        };
    };

    function formatAPI() {
        return Object.keys(services).map(function (name) {
            var service = services[name],
                ret;

            ret = 'Service=' + name;
            ret += '&Parameters=' + service.parameters.join(',');
            ret += '&Method=' + service.method;
            ret += '&URL=' + name;

            return ret;
        }).join(' ');
    }

    // Monkey patch sendSnapError method
    router.use('*', function (req, res, next) {
        res.sendSnapError = function sendSnapError(text) {
            text = "ERROR: " + text;
            debug(text);
            this.status(400).send(text);
        };
        next();
    });

    // Allow cross origin access
    router.use('*', function allowCORS(req, res, next) {
        res.header('Access-Control-Allow-Methods', 'GET, POST');
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Origin', req.get('origin'));
        res.header('Access-Control-Allow-Headers', 'Content-Type, SESSIONGLUE, MioCracker');
        res.header('Access-Control-Expose-Headers', 'MioCracker');
        res.header('Cache-Control', 'no-store');
        next();
    });

    router.options('*', function (req, res) {
        res.sendStatus(200);
    });

    // Decode req.body fields
    router.use(bodyParser.json());

    function parseCookies(cookies) {
        cookies = cookies || '';
        if (cookies instanceof Array) {
            cookies = cookies.join(' ');
        }
        return cookieParser.parse(cookies);
    }

    // Copy the cookie to MioCracker
    router.use(function setMioCracker(req, res, next) {
        onHeaders(res, function () {
            var cookies = parseCookies(this.getHeader('Set-Cookie'));
            if (!cookies.snapcloud) {
                cookies = parseCookies(req.get('Cookie'));
            }

            if (cookies.snapcloud) {
                var cracker = cookieParser.serialize('snapcloud', cookies.snapcloud);
                this.setHeader('MioCracker', cracker);
            } else {
                debug('Could not set MioCracker');
            }
        });

        next();
    });

    // Append MioCracker to the cookies
    router.use(function setCookie(req, res, next) {
        var cracker = req.header('MioCracker'),
            cookie = parseCookies(req.headers.cookie);

        if (cracker && !cookie.snapcloud) {
            if (req.headers.cookie) {
                req.headers.cookie += ' ' + cracker;
            } else {
                req.headers.cookie = cracker;
            }
        }

        next();
    });

    // Enable session support
    router.use(session({
        name: 'snapcloud', // SNAP parses this and sets LIMO to substr(9, ...)
        secret: options.session_secret || 'snapsecreet',
        resave: true,
        saveUninitialized: false,
        store: new MongoStore({
            db: options.mongodb,
            ttl: 1 * 3600 // one hour 
        }),
        unset: 'destroy',
        cookie: {
            secure: options.cookie_secure || false,
            htmlOnly: false
        }
    }));

    // Signup
    router.get('/SignUp', function signup(req, res) {
        var user = req.query.Username,
            email = req.query.Email;
        debug('Sign up request:', user, email);

        if (!email || !user) {
            res.sendSnapError('Invalid signup request');
        }

        users.insert({
            _id: user,
            email: email,
            hash: null,
            created: new Date()
        }, function signupDone(err) {
            if (err) {
                res.sendSnapError('User already exists');
            } else {
                // TODO: send mail
                return res.send('OK');
            }
        });
    });

    // ResetPW
    router.get('/ResetPW', function resetPw(req, res) {
        var user = req.query.Username;
        debug('Password reset request:', user);

        users.update({
            _id: user
        }, {
            $set: {
                hash: null
            }
        }, function resetPwDone(err, status) {
            if (err || status.result.n === 0) {
                res.sendSnapError('User does not exists');
            } else {
                // TODO: send mail
                return res.send('OK');
            }
        });
    });

    // Login
    router.post('/', function (req, res) {
        var user = req.body.__u,
            hash = req.body.__h;

        req.session.user = user;
        debug('Login', req.session.user);
        req.session.save();

        var api = formatAPI();
        res.send(api);
    });

    // Logout
    router.addSnapApi('logout', [], 'Get');
    router.get('/logout*', function (req, res) {
        debug('Logout', req.session.user);
        req.session = null;

        res.sendStatus(200);
    });

    router.addSnapApi('changePassword', ['OldPassword', 'NewPassword'], 'Post');
    router.addSnapApi('getProjectList', [], 'Get');
    router.addSnapApi('getProject', ['ProjectName'], 'Post');
    router.addSnapApi('getRawProject', ['ProjectName'], 'Post');
    router.addSnapApi('deleteProject', ['ProjectName'], 'Post');
    router.addSnapApi('publishProject', ['ProjectName'], 'Post');
    router.addSnapApi('unpublishProject', ['ProjectName'], 'Post');
    router.addSnapApi('saveProject', ['ProjectName', 'SourceCode', 'Media', 'SourceSize', 'MediaSize'], 'Post');

    router.use(function (req, res) {
        debug('Unhandled Request');
        debug('Method:', req.method);
        debug('Path:', req.path);
        debug('OriginalUrl:', req.originalUrl);
        debug('Params:', req.params);
        debug('Query:', req.query);
        res.sendStatus(404);
    });

    return router;
}

module.exports = snapServer;