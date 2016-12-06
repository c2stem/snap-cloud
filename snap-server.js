"use strict";

var express = require("express");
var bodyParser = require("body-parser");
var cookieCoder = require("cookie");
var cookieSigner = require("cookie-signature");

function snapServer(options) {
    var router = express.Router();

    // allow cross origin access
    router.options("/", function (req, res, next) {
        res.header("Access-Control-Allow-Methods", "GET, POST");
        res.header("Access-Control-Allow-Credentials", "true");
        res.header("Access-Control-Allow-Origin", req.get("Origin"));
        res.header("Access-Control-Allow-Headers", "Content-Type, SESSIONGLUE");
        res.header("Access-Control-Expose-Headers", "SESSIONGLUE");
        res.header("Cache-Control", "no-store");
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

    // to decode req.body fields
    router.use(bodyParser.json());

    // Login service
    router.post("/", function (req, res) {
        var user = req.body.__u,
            hash = req.body.__h;

        var api = formatAPI();

        res.header("Access-Control-Allow-Credentials", "true");
        res.header("Access-Control-Allow-Origin", req.get("Origin"));
        res.header("Access-Control-Expose-Headers", "MioCracker, SESSIONGLUE");
        res.header("Cache-Control", "no-store");

        var cookieValue = "hello";
        var cookie = cookieCoder.serialize(
            "snap",
            cookieSigner.sign(cookieValue, options.secret), {
                httpOnly: true
            });
        console.log(cookie);

        res.header("MioCracker", cookie);
        res.header("Set-Cookie", cookie);

        res.send(api);
    });

    return router;
}

module.exports = snapServer;