"use strict";

var express = require("express");
var bodyParser = require("body-parser");
var session = require("express-session");
var onHeaders = require("on-headers");
var MongoStore = require("connect-mongo")(session);
var cookieParser = require("cookie");

function snapServer(options) {
    var router = express.Router();

    // Allow cross origin access
    router.use("*", function (req, res, next) {
        res.header("Access-Control-Allow-Methods", "GET, POST");
        res.header("Access-Control-Allow-Credentials", "true");
        res.header("Access-Control-Allow-Origin", req.get("origin"));
        res.header("Access-Control-Allow-Headers", "Content-Type, SESSIONGLUE, MioCracker");
        res.header("Access-Control-Expose-Headers", "MioCracker");
        res.header("Cache-Control", "no-store");
        next();
    });

    router.options("*", function (req, res) {
        res.sendStatus(200);
    });

    var services = {
        "saveProject": {
            parameters: ["ProjectName", "SourceCode", "Media", "SourceSize", "MediaSize"],
            method: "Post"
        },
        "logout": {
            parameters: [],
            method: "Get"
        }
    };

    function formatAPI() {
        return Object.keys(services).map(function (name) {
            var service = services[name],
                ret;

            ret = "Service=" + name;
            ret += "&Parameters=" + service.parameters.join(",");
            ret += "&Method=" + service.method;
            ret += "&URL=" + name;

            return ret;
        }).join(" ");
    }

    // Decode req.body fields
    router.use(bodyParser.json());

    function parseCookies(cookies) {
        cookies = cookies || "";
        if (cookies instanceof Array) {
            cookies = cookies.join(" ");
        }
        return cookieParser.parse(cookies);
    }

    // Copy the cookie to MioCracker
    router.use(function (req, res, next) {
        onHeaders(res, function () {
            var cookies = parseCookies(this.getHeader("Set-Cookie"));
            if (!cookies.snapcloud) {
                cookies = parseCookies(req.get("Cookie"));
            }

            if (cookies.snapcloud) {
                var cracker = cookieParser.serialize("snapcloud", cookies.snapcloud);
                console.log("MioCracker", cracker);
                this.setHeader("MioCracker", cracker);
            } else {
                console.log("Could not set MioCracker");
            }
        });

        next();
    });

    // Append MioCracker to the cookies
    router.use(function (req, res, next) {
        var cracker = req.header("MioCracker"),
            cookie = parseCookies(req.headers.cookie);

        if (cracker && !cookie.snapcloud) {
            cookie = cookieParser.serialize("snapcloud", cracker);
            if (req.headers.cookie) {
                req.headers.cookie += " " + cookie;
            } else {
                req.headers.cookie = cookie;
            }
        }

        next();
    });

    // Enable session support
    router.use(function (req, res, next) {
        var fun = session({
            name: "snapcloud", // SNAP parses this and sets LIMO to substr(9, ...)
            secret: options.session_secret || "snapsecreet",
            resave: true,
            saveUninitialized: false,
            store: new MongoStore({
                url: options.mongodb_url
            }),
            unset: "destroy",
            cookie: {
                secure: options.cookie_secure || false,
                htmlOnly: false
            }
        });

        console.log("SESSION SUPPORT START");
        return fun(req, res, function () {
            console.log("SESSION SUPPORT END");
            next();
        });
    });

    // Login service
    router.post("/", function (req, res) {
        var user = req.body.__u,
            hash = req.body.__h;

        req.session.user = user;
        console.log("login", req.session.user);
        req.session.save();

        var api = formatAPI();
        res.send(api);
    });

    router.get("/logout*", function (req, res) {
        console.log("logout", req.session.user);
        res.sendStatus(200);
    });

    router.use(function (req, res) {
        console.log("Unhandled Request");
        console.log('Method:', req.method);
        console.log('Path:', req.path);
        console.log('OriginalUrl:', req.originalUrl);
        console.log('Params:', req.params);
        res.sendStatus(404);
    });

    return router;
}

module.exports = snapServer;
