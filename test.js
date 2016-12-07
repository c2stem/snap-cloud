var express = require("express");
var snapServer = require("./snap-server");

var app = express();

// handle snap server requests
app.use("/SnapCloud", snapServer({
    session_secret: "SnapCloud",
    cookie_secure: false,
    mongodb_url: "mongodb://localhost/snapcloud"
}));

// serve static files
app.use(express.static("/home/mmaroti/workspace/snap-physics/"));

// start the server
app.listen(8080, function () {
    console.log("listening on port 8080");
});