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

        apis += 'Service=' + encodeURIComponent(name);
        apis += '&Parameters=' + parameters.map(encodeURIComponent).join(',');
        apis += '&Method=' + encodeURIComponent(method);
        apis += '&URL=' + encodeURIComponent(name);

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
                updated: new Date()
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
                    updated: new Date()
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

    router.addSnapApi('saveProject', ['ProjectName', 'SourceCode', 'Media', 'SourceSize', 'MediaSize'], 'Post', function (req, res) {
        console.log('Save project', req.session.user, req.body.ProjectName);

        if (typeof req.session.user !== 'string' ||
            typeof req.body.ProjectName !== 'string' ||
            typeof req.body.SourceCode !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            projects.update({
                user: req.session.user,
                name: req.body.ProjectName
            }, {
                $set: {
                    updated: new Date(),
                    data: req.body.SourceCode,
                    media: req.body.Media
                },
                $setOnInsert: {
                    public: false
                }
            }, {
                upsert: true,
                multi: false
            }, function (err) {
                if (err) {
                    sendSnapError(res, 'Database error');
                } else {
                    res.sendStatus(200);
                }
            });
        }
    });

    router.addSnapApi('getProjectList', [], 'Get', function (req, res) {
        debug('Get project list', req.session.user);

        if (typeof req.session.user !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            projects.find({
                user: req.session.user
            }).toArray(function (err, docs) {
                if (err || !docs) {
                    sendSnapError(res, 'User not found');
                } else {
                    res.send(docs.map(function (proj) {
                        return 'ProjectName=' + encodeURIComponent(proj.name) +
                            '&Updated=' + encodeURIComponent(proj.updated) +
                            '&Notes=' + encodeURIComponent(proj.notes || '') +
                            '&Public=' + encodeURIComponent(proj.public || false) +
                            '&Thumbnail=' + encodeURIComponent(proj.thumbnail || '');
                    }).join(' '));
                }
            });
        }
    });

    router.addSnapApi('deleteProject', ['ProjectName'], 'Post', function (req, res) {
        debug('Delete project', req.session.user, req.body.ProjectName);

        if (typeof req.session.user !== 'string' ||
            typeof req.body.ProjectName !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            projects.remove({
                user: req.session.user,
                name: req.body.ProjectName
            }, function (err) {
                if (err) {
                    sendSnapError(res, 'Database error');
                } else {
                    res.sendStatus(200);
                }
            });
        }
    });

    router.addSnapApi('publishProject', ['ProjectName'], 'Post', function (req, res) {
        debug('Publish project', req.session.user, req.body.ProjectName);

        if (typeof req.session.user !== 'string' ||
            typeof req.body.ProjectName !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            projects.update({
                user: req.session.user,
                name: req.body.ProjectName
            }, {
                $set: {
                    updated: new Date(),
                    public: true
                }
            }, {
                upsert: false,
                multi: false
            }, function (err) {
                if (err) {
                    sendSnapError(res, 'Database error');
                } else {
                    res.sendStatus(200);
                }
            });
        }
    });

    router.addSnapApi('unpublishProject', ['ProjectName'], 'Post', function (req, res) {
        debug('Unpublish project', req.session.user, req.body.ProjectName);

        if (typeof req.session.user !== 'string' ||
            typeof req.body.ProjectName !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            projects.update({
                user: req.session.user,
                name: req.body.ProjectName
            }, {
                $set: {
                    updated: new Date(),
                    public: false
                }
            }, {
                upsert: false,
                multi: false
            }, function (err) {
                if (err) {
                    sendSnapError(res, 'Database error');
                } else {
                    res.sendStatus(200);
                }
            });
        }
    });

    // router.addSnapApi('getProject', ['ProjectName'], 'Post');

    router.addSnapApi('getRawProject', ['ProjectName'], 'Post', function (req, res) {
        debug('Get raw project', req.session.user, req.body.ProjectName);

        if (typeof req.session.user !== 'string' ||
            typeof req.body.ProjectName !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            projects.findOne({
                user: req.session.user,
                name: req.body.ProjectName
            }, function (err, doc) {
                if (err || !doc) {
                    console.log(err, doc);
                    sendSnapError(res, 'Project not found');
                } else {
                    res.send('<snapdata>' + doc.data + doc.media + '</snapdata>');
                }
            });
        }
    });

    router.use(function (req, res, next) {
        debug('Unhandled Request');
        debug('Method:', req.method);
        debug('Path:', req.path);
        debug('OriginalUrl:', req.originalUrl);
        debug('Params:', req.params);
        debug('Query:', req.query);
        next();
    });

    return router;
}

module.exports = snapServer;