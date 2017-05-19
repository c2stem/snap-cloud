(function(Users) {
    var generatePassword = require('generate-password');
    var nodeMailer = require('nodemailer');
    var shaJs = require('sha.js');
    var mailer_from = "no-reply@c2stem.org";
    var transport;
    var collection;

    function hashPassword(password) {
        return shaJs('sha512').update(password).digest('hex');
    }

    function emailPassword(email, user, password) {
        return transport.sendMail({
                from: mailer_from,
                to: email,
                subject: 'Temporary Password',
                text: 'Hello ' + user +
                    '!\n\nYour Snap password has been temporarily set to: ' +
                    password + '. Please change it after logging in.'
            })
            .catch(err => {
                throw new Error(`Could not send email: ${err}`);
            });
    }

    Users.init = function(db, mailerOpts) {
        collection = db.collection('users');

        mailerOpts = mailerOpts || {};
        transport = nodeMailer.createTransport(mailerOpts.mailer_smpt);
        mailer_from = mailerOpts.mailer_from || mailer_from;
    };

    Users.new = function(username, email, silent) {
        var password = generatePassword.generate({});

        return collection.update({
            _id: username,
            email: email
        }, {
            $set: {
                hash: hashPassword(password),
                updated: new Date()
            },
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
