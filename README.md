# gateway

Required Env vars:
* JWT_ISSUER: Token issuer
* JWT_SECRET: Secret for token encoding
* JWT_ROLE_BINDING: Attribute that defines the role in the JWT payload (default: "role")
* SLA_SEC_SCHEME: Security scheme that SLA Rate Limit middleware will use

Optional: 
* IP_RANGE: Used as the range of Ips to scan on okteto