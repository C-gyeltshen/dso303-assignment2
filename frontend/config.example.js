// The pipeline writes config.js from Terraform outputs. For local testing copy this file to config.js.
window.APP_CONFIG = {
  region: 'ap-south-1',
  userPoolClientId: 'xxxxxxxxxxxxxxxxxxxxxxxxxx',
  cognitoDomain: 'https://exam-platform-abc123.auth.ap-south-1.amazoncognito.com',
  apiBase: '', // same origin via CloudFront (/api/*)
};
