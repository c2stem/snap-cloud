'use strict';

var express = require('express'),
    bodyParser = require('body-parser'),
    session = require('express-session'),
    onHeaders = require('on-headers'),
    MongoStore = require('connect-mongo')(session),
    cookieParser = require('cookie'),
    debug = require('debug')('snap-cloud'),
    nodeMailer = require('nodemailer'),
    generatePassword = require('generate-password'),
    shaJs = require('sha.js'),
    parseString = require('xml2js').parseString;

function snapCloud(options) {
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
        extended: true,
        limit: '16mb'
    }));
    router.use(bodyParser.json({
        limit: '16mb'
    }));

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

    function emailPassword(res, email, user, password, message) {
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
                res.send(message);
            }
        });
    }

    // Signup
    router.get('/SignUp', function signup(req, res) {
        var userName = req.query.Username,
            email = req.query.Email,
            password = generatePassword.generate({});
        debug('Sign up', userName, email);

        if (!email || !userName) {
            sendSnapError(res, 'Invalid signup request');
        }

        users.insert({
            _id: userName,
            email: email,
            hash: hashPassword(password),
            created: new Date()
        }, function signupDone(err) {
            if (err) {
                sendSnapError(res, 'User already exists');
            } else {
                emailPassword(res, email, userName, password, "Account created");
            }
        });
    });

    // ResetPW
    router.get('/ResetPW', function resetPw(req, res) {
        var userName = req.query.Username,
            password = generatePassword.generate({});
        debug('Reset password', userName);

        users.findAndModify({
            _id: userName
        }, [], {
            $set: {
                hash: hashPassword(password),
                updated: new Date()
            }
        }, function resetPwDone(err, obj) {
            if (err || !obj || !obj.value) {
                sendSnapError(res, 'User not found');
            } else {
                emailPassword(res, obj.value.email, userName, password, "Password reset");
            }
        });
    });

    // RawPublic
    router.get('/RawPublic', function rawPublic(req, res) {
        var userName = req.query.Username,
            projectName = req.query.ProjectName;
        debug('Load public', userName, projectName);

        if (typeof userName !== 'string' ||
            typeof projectName !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            projects.findOne({
                user: userName,
                name: projectName,
                public: true
            }, function (err, doc) {
                if (err || !doc) {
                    console.log(err, doc);
                    sendSnapError(res, 'Project not found');
                } else {
                    res.send(doc.snapdata);
                }
            });
        }
    });

    // Login
    router.post('/', function (req, res) {
        var userName = req.body.__u,
            hash = req.body.__h;
        debug('Login', userName);

        users.findOne({
            _id: userName
        }, function (err, doc) {
            if (err || !doc) {
                sendSnapError(res, 'User not found');
            } else if (hash !== doc.hash) {
                sendSnapError(res, 'Invalid password');
            } else {
                req.session.user = userName;
                res.send(apis);
            }
        });
    });

    // PublicProjects
    router.get('/PublicProjects', function publicProjects(req, res) {
        var page = parseInt(req.query.page || 0),
            searchText = req.query.search || null,
            query = {
                public: true
            };

        debug('Public projects page', page);
        if (searchText) {
            var allFields = ['name', 'user', 'origin', 'snapdata'];

            if (!searchText.includes(':')) {  // search ALL text
                query.$or = allFields.map(field => {
                    var subquery = {};

                    subquery[field] = {
                        $regex: new RegExp(searchText, 'im')
                    };

                    return subquery;
                });
            } else {  // search the given fields
                var content,
                    fieldAndSearch = [],
                    field;

                content = searchText.split(':')
                    .map(field => field.replace(/^\s*/, '').replace(/\s*$/, ''));

                for (var i = 0; i < content.length; i+=2) {
                    field = content[i].toLowerCase();
                    if (allFields.includes(field) && content[i+1]) {  // has a value
                        query[field] = {
                            $regex: new RegExp(content[i+1], 'im')
                        };
                    }
                }
            }

            console.log('query is', query);
        }

        return projects.find(query)
            .skip(page * 20).limit(20)
            .toArray().then(function (docs) {
                debug('Returned ' + docs.length + ' projects');
                console.log(docs);
                res.send(docs.map(function (proj) {
                    return 'ProjectName=' + encodeURIComponent(proj.name) +
                        '&Updated=' + encodeURIComponent(proj.updated.toJSON()) +
                        '&Notes=' + encodeURIComponent(proj.notes || '') +
                        '&User=' + encodeURIComponent(proj.user || '') +
                        '&Origin=' + encodeURIComponent(proj.origin || '') +
                        '&Thumbnail=' + encodeURIComponent(proj.thumbnail || '');
                }).join(' '));
            })
            .catch(err => {
                debug('Database error', err);
                return res.send('ERROR: ' + err);
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
        var userName = req.session.user,
            oldPassword = req.body.OldPassword,
            newPassword = req.body.NewPassword;
        debug('Change password', userName);

        if (typeof oldPassword !== 'string' ||
            typeof newPassword !== 'string' ||
            typeof userName !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            users.findAndModify({
                _id: userName,
                hash: oldPassword
            }, [], {
                $set: {
                    hash: newPassword,
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
        var userName = req.session.user,
            projectName = req.body.ProjectName,
            sourceCode = req.body.SourceCode,
            media = req.body.Media;
        debug('Save project', userName, projectName);

        if (typeof userName !== 'string' ||
            typeof projectName !== 'string' ||
            typeof sourceCode !== 'string' ||
            typeof media !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            parseString(sourceCode, function (err, parsed) {
                if (err) {
                    sendSnapError(res, 'Invalid XML data');
                } else {
                    var fields = {
                            updated: new Date(),
                            snapdata: '<snapdata>' + sourceCode + media + '</snapdata>',
                            notes: parsed.project.notes,
                            thumbnail: parsed.project.thumbnail,
                        },
                        origin = req.get('origin');
                    if (origin.search('^https?:\/\/localhost(:[0-9]*)?$') !== 0) {
                        fields.origin = origin;
                    }

                    projects.update({
                        user: userName,
                        name: projectName
                    }, {
                        $set: fields,
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
        }
    });

    router.addSnapApi('getProjectList', [], 'Get', function (req, res) {
        var userName = req.session.user;
        debug('Get project list', userName);

        if (typeof userName !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            projects.find({
                user: userName
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
        var userName = req.session.user,
            projectName = req.body.ProjectName;
        debug('Delete project', userName, projectName);

        if (typeof userName !== 'string' ||
            typeof projectName !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            projects.remove({
                user: userName,
                name: projectName
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
        var userName = req.session.user,
            projectName = req.body.ProjectName;
        debug('Publish project', userName, projectName);

        if (typeof userName !== 'string' ||
            typeof projectName !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            projects.update({
                user: userName,
                name: projectName
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
        var userName = req.session.user,
            projectName = req.body.ProjectName;
        debug('Unpublish project', userName, projectName);

        if (typeof userName !== 'string' ||
            typeof projectName !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            projects.update({
                user: userName,
                name: projectName
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
        var userName = req.session.user,
            projectName = req.body.ProjectName;
        debug('Get raw project', userName, projectName);

        if (typeof userName !== 'string' ||
            typeof projectName !== 'string') {
            sendSnapError(res, 'Invalid request');
        } else {
            projects.findOne({
                user: userName,
                name: projectName
            }, function (err, doc) {
                if (err || !doc) {
                    console.log(err, doc);
                    sendSnapError(res, 'Project not found');
                } else {
                    res.send(doc.snapdata);
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

module.exports = snapCloud;
