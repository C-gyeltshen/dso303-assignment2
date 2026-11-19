'use strict';
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const ses = new SESv2Client({});

async function sendEmail(to, subject, text) {
  return ses.send(new SendEmailCommand({
    FromEmailAddress: process.env.SES_SENDER,
    Destination: { ToAddresses: [to] },
    Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
  }));
}

module.exports = { sendEmail };
