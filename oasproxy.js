const { OASBase, logger } = require("@oas-tools/commons");
const httpProxy = require("http-proxy").createProxyServer();

module.exports = class OASProxy extends OASBase {

    constructor(oasFile, middleware) {
        super(oasFile, middleware); // Call parent constructor
    }

    static initialize(oasFile, _config) {
        return new OASProxy(oasFile, (req, res, next) => {
            
            // Server side discovery
            const path = req.route.path;
            const method = req.method.toLowerCase();
            const server = oasFile.paths[path][method]["x-proxy-url"];

            // Set body content-type for proxy
            httpProxy.once("proxyReq", (proxyReq, req) => {
                if (req.body) {
                    const bodyData = JSON.stringify(req.body);

                    proxyReq.setHeader('Content-Type','application/json');
                    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                    
                    // stream the content
                    proxyReq.write(bodyData);
                    proxyReq.end();
                }
            });

            // Response validation
            const web_o = Object.values(require('http-proxy/lib/http-proxy/passes/web-outgoing'));

            httpProxy.once('proxyRes', (proxyRes, req, res) => {
                const data = [];

                proxyRes.once("data", (chunk) => {
                    logger.debug(`Received ${Buffer.from(chunk).byteLength} bytes of data`);
                    data.push(Buffer.from(chunk));
                });

                proxyRes.once("end", async () => {
                    try {
                        if (data.length > 0 ) res.send(JSON.parse(Buffer.concat(data).toString()));
                        else res.send();
                    } catch (err) {
                        res.statusMessage = "Internal Server Error";
                        next(err);
                    }
                });

                for (var i = 0; i < web_o.length; i++) {
                    if (web_o[i](req, res, proxyRes, {})) { break; }
                }
            });

            // Proxy request
            logger.info(`Redirecting ${method} request to ${server}${path}`);
            httpProxy.web(req, res, {target: server, selfHandleResponse: true});
        })
    }
    
}