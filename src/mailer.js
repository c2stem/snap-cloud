(function(mailer) {
    var nodeMailer = require('nodemailer');
    var mailer_from = "no-reply@c2stem.org";
    var transport;

    mailer.init = function(mailerOpts) {
        mailerOpts = mailerOpts || {};
        transport = nodeMailer.createTransport(mailerOpts.mailer_smpt);
        mailer_from = mailerOpts.mailer_from || mailer_from;
    };

    mailer.sendEmail = function(email, subject, message) {
        return transport.sendMail({
                from: mailer_from,
                to: email,
                subject: subject,
                text: message
            })
            .then(() => console.log(`sending email "${subject}" to ${email}`))
            .catch(err => {
                var msg =  `Could not send email: ${err}`;
                console.error(msg);
                throw new Error(msg);
            });
    };

})(exports);

