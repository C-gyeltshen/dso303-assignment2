# How the design handles the exam peak and the loss of one Availability Zone

## The exam peak

3,000 students starting within 5 minutes is about **10 exam starts per second**. Autosaves then add about **100 writes per second** (3,000 students ÷ 30 seconds).

- **Servers are ready in advance.** A scheduled action raises the Fargate API from 4 to 12 tasks 30 minutes before each exam. Target tracking (50% CPU, requests per task) can add more, up to 20.
- **CloudFront serves the website** from its cache, so page loads never reach the servers.
- **Redis holds the exam paper,** so 3,000 students opening it at once do not hit Aurora.
- **Autosaves go to DynamoDB on-demand,** which absorbs the burst and keeps Aurora free for exam work.
- **Slow work waits in queues.** At the end of the exam, marking and emails go into SQS, and Lambda processes them at a capped speed. A wave of submissions cannot overload the database.

## Losing one Availability Zone

- **Every layer runs in both zones,** and either zone alone can carry the peak.
- **The load balancer** stops sending traffic to the failed zone within seconds, and ECS replaces the lost tasks in the healthy zone.
- **Aurora promotes its Zone B standby** in about a minute. The connection address stays the same, so the API reconnects by itself.
- **Redis switches to its replica.** Each zone has its own NAT gateway. DynamoDB, S3, SQS, Lambda and Cognito already span several zones.
- **No answers are lost.** Aurora keeps six copies across three zones, and browsers retry any autosave sent during the switch.

**RPO:** about zero for a zone failure, and within 5 minutes using point-in-time restore. **RTO:** minutes for a zone failure, well under one hour for a full restore.
