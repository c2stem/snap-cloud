"use strict";

var express = require("express");
var bodyParser = require("body-parser");
var session = require("express-session");
var onHeaders = require("on-headers");

function snapServer(options) {
    var router = express.Router();

    // Allow cross origin access
    router.use("*", function (req, res, next) {
        res.header("Access-Control-Allow-Methods", "GET, POST");
        res.header("Access-Control-Allow-Credentials", "true");
        res.header("Access-Control-Allow-Origin", req.get("Origin"));
        res.header("Access-Control-Allow-Headers", "Content-Type, SESSIONGLUE, MioCracker");
        // res.header("Access-Control-Expose-Headers", "SESSIONGLUE");
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

    // Copy cookie to MioCracker
    router.use(function (req, res, next) {
        onHeaders(res, function () {
            var cookie = this.getHeader("Set-Cookie");
            if (cookie) {
                this.setHeader("MioCracker", cookie);
            }
        });
        next();
    });

    router.use(function (req, res, next) {
        var cookie = req.header("MioCracker");
        console.log("MioCracker", cookie);

        // HACK, but is there another way?
        req.headers["Set-Cookie"] = cookie;

        next();
    });

    // Enable session support
    router.use(session({
        name: "snapcloud", // SNAP parses this and sets LIMO to substr(9, ...)
        secret: "SnapSecret",
        resave: false,
        saveUninitialized: true,
        cookie: {
            secure: options.secure,
            htmlOnly: true,
            ephemeral: true
        }
    }));

    // Login service
    router.post("/", function (req, res) {
        var user = req.body.__u,
            hash = req.body.__h;

        res.header("Access-Control-Allow-Credentials", "true");
        res.header("Access-Control-Allow-Origin", req.get("Origin"));
        res.header("Access-Control-Expose-Headers", "MioCracker, SESSIONGLUE");
        res.header("Cache-Control", "no-store");

        req.session.user = user;
        console.log("user login", user)

        var api = formatAPI();
        res.send(api);
    });

    router.get("/logout", function (req, res) {
        console.log(req.session);
        res.sendStatus(200);
    });

    return router;
}

module.exports = snapServer;