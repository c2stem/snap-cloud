(function(Users) {
    var generatePassword = require('generate-password');
    var nodeMailer = require('nodemailer');
    var shaJs = require('sha.js');
    var mailer = require('./mailer');
    var collection;

    function hashPassword(password) {
        return shaJs('sha512').update(password).digest('hex');
    }

    function emailPassword(email, user, password) {
        var subject = 'Temporary Password';
        var message = 'Hello ' + user +
            '!\n\nYour Snap password has been temporarily set to: ' +
            password + '. Please change it after logging in.';
        return mailer.sendEmail(email, subject, message);
    }

    Users.init = function(db) {
        collection = db.collection('users');
    };

    Users.new = function(username, email, silent, data) {
        var password = generatePassword.generate({}),
            userData = {
                hash: hashPassword(password),
                updated: new Date()
            };

        if (data) {
            data.forEach(pair => {
                var [key, value] = pair;
                userData[key] = value;
            });
        }

        return collection.update({
            _id: username,
            email: email
        }, {
            $set: userData,
            $setOnInsert: {
                created: new Date()
            }
        }, {
            upsert: true,
            multi: false
        })
        .then(user => {
            if (!silent) {
                return emailPassword(email, username, password);
            }
        });

    };

    Users.get = function(username) {
        return collection.findOne({
            _id: username
        });
    };

    Users.remove = function(username) {
        return collection.deleteOne({_id: username})
            .then(result => result.deletedCount > 0);
    };

    Users.setEmail = function(username, email) {
        return collection.findOne({email: email})
            .then(match => {
                if (match) {
                    throw Error('email address is already taken');
                }

                return collection.findAndModify({_id: username}, [], {
                    $set: {
                        email: email,
                        updated: new Date()
                    }
                });
            });
    };

    Users.setPassword = function(username, password, oldPassword) {
        var query = {_id: username},
            sendEmail,
            hash;

        if (password) {  // set to given value
            hash = password;
        } else {  // reset password and send email
            password = generatePassword.generate({});
            hash = hashPassword(password);
        }

        if (oldPassword) {
            query.hash = oldPassword;
        }

        return collection.findAndModify(query, [], {
                $set: {
                    hash: hash,
                    updated: new Date()
                }
            })
            .then(obj => {
                if (password !== hash) {  // generated password
                    return emailPassword(obj.value.email, username, password);
                }
            });
    };

    Users.all = function() {
        return collection.find().stream();
    };

})(exports);
