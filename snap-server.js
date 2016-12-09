'use strict';

var express = require('express'),
    bodyParser = require('body-parser'),
    session = require('express-session'),
    onHeaders = require('on-headers'),
    MongoStore = require('connect-mongo')(session),
    cookieParser = require('cookie'),
    debug = require('debug')('snap-server'),
    nodeMailer = require('nodemailer'),
    generatePassword = require('generate-password'),
    shaJs = require('sha.js');

function snapServer(options) {
    var router = express.Router(),
        users = options.mongodb.collection('users'),
        projects = options.mongodb.collection('projects'),
        transport = nodeMailer.createTransport(options.mailer_smpt),
        apis = '';

    router.addSnapApi = function addSnapApi(name, parameters, method, handler) {
        if (apis) {
            apis += ' ';
        }

        apis += 'Service=' + name;
        apis += '&Parameters=' + parameters.join(',');
        apis += '&Method=' + method;
        apis += '&URL=' + name;

        if (handler && method === 'Get') {
            router.get('/' + name + '*', handler);
        } else if (handler && method === 'Post') {
            router.post('/' + name + '*', handler);
        }
    };

    function sendSnapError(res, text) {
        text = 'ERROR: ' + text;
        debug(text);
        res.status(400).send(text);
    }

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
    router.use(bodyParser.urlencoded({
        extended: true
    }));
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
                this.setHeader('MioCracker', 'nothing'); // client fails if not set
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

    function hashPassword(password) {
        return shaJs('sha512').update(password).digest('hex');
    }

    function emailPassword(res, email, user, password) {
        transport.sendMail({
            from: options.mailer_from,
            to: email,
            subject: 'Temporary Password',
            text: 'Hello ' + user +
                '!\n\nYour Snap password has been temporarily set to: ' +
                password + '. Please change it after logging in.'
        }, function (err) {
            if (err) {
                sendSnapError(res, 'Could not send email');
            } else {
                res.sendStatus(200);
            }
        });
    }

    // Signup
    router.get('/SignUp', function signup(req, res) {
        var user = req.query.Username,
            email = req.query.Email,
            password = generatePassword.generate({});
        debug('Sign up', user, email);

        if (!email || !user) {
            sendSnapError(res, 'Invalid signup request');
        }

        users.insert({
            _id: user,
            email: email,
            hash: hashPassword(password),
            created: new Date()
        }, function signupDone(err) {
            if (err) {
                sendSnapError(res, 'User already exists');
            } else {
                emailPassword(res, email, user, password);
            }
        });
    });

    // ResetPW
    router.get('/ResetPW', function resetPw(req, res) {
        var user = req.query.Username,
            password = generatePassword.generate({});
        debug('Reset password', user);

        users.findAndModify({
            _id: user
        }, [], {
            $set: {
                hash: hashPassword(password),
                modified: new Date()
            }
        }, function resetPwDone(err, doc) {
            if (err || !doc) {
                sendSnapError(res, 'User not found');
            } else {
                emailPassword(res, doc.value.email, user, password);
            }
        });
    });

    // Login
    router.post('/', function (req, res) {
        var user = req.body.__u,
            hash = req.body.__h;
        debug('Login', user);

        users.findOne({
            _id: user
        }, function (err, doc) {
            if (err || !doc) {
                sendSnapError(res, 'User not found');
            } else if (hash !== doc.hash) {
                sendSnapError(res, 'Invalid password');
            } else {
                req.session.user = user;
                res.send(apis);
            }
        });
    });

    // Logout
    router.addSnapApi('logout', [], 'Get', function (req, res) {
        debug('Logout', req.session.user);
        req.session = null;
        res.sendStatus(200);
    });

    // ChangePassword
    router.addSnapApi('changePassword', ['OldPassword', 'NewPassword'], 'Post', function (req, res) {
        debug('Change password', req.session.user);

        if (typeof req.body.OldPassword !== 'string' ||
            typeof req.body.NewPassword !== 'string' ||
            typeof req.session.user !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            users.findAndModify({
                _id: req.session.user,
                hash: req.body.OldPassword
            }, [], {
                $set: {
                    hash: req.body.NewPassword,
                    modified: new Date()
                }
            }, function changePwDone(err, doc) {
                if (err || !doc) {
                    sendSnapError(res, 'Invalid password');
                } else {
                    res.sendStatus(200);
                }
            });
        }
    });

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