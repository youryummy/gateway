const { OASBase, logger } = require("@oas-tools/commons");
const request = require("request");

module.exports = class OASProxy extends OASBase {

    constructor(oasFile, middleware) {
        super(oasFile, middleware); // Call parent constructor
    }

    static initialize(oasFile, _config) {
        return new OASProxy(oasFile, (req, res) => {
            
            // Server side discovery
            const path = req.route.path;
            const method = req.method.toLowerCase();
            const server = oasFile.paths[path][method]["x-proxy-url"];

            // Proxy request
            logger.info(`Redirecting ${method} request to ${server}${req.originalUrl}`);

            // Handle multipart
            if (req.is('multipart/form-data')) {
                let formData = {};
                Object.entries(req.body ?? {}).forEach(([key, val]) => {
                    let file = req.files?.find(f => f.fieldname === key);
                    formData[key] = file ? {
                        value: file.buffer,
                        options: {
                            filename: file.originalname
                        }
                    } : (val ? JSON.stringify(val) : "")
                    
                });
                req.formData = formData;
                req.headers['content-type'] = undefined; // Automatically set the boundary for formData
            }

            else if (req.is('application/json')) {
                req.body = JSON.stringify(req.body);
            }

            // Proxy request using request module
            request({
                uri: `${server}${req.originalUrl}`,
                method: method.toUpperCase(),
                headers: {
                    'Cookie': req.headers.cookie ?? '',
                    'Authorization': req.headers['authorization'],
                    ...(req.headers['content-type'] ? {'Content-Type': req.headers['content-type']} : {})
                },
                ...((/POST|PUT/i).test(method) && (/application\/json/).test(req.headers['content-type']) ? {body: req.body} : {}),
                ...((/POST|PUT/i).test(method) && !req.headers['content-type'] ? {formData: req.formData} : {}),
            }, (err, proxyRes) => {
                if (err) {
                    console.log(err);
                    res.statusMessage = "Internal Server Error";
                    res.status(500).send({message: "Unexpected error occurred. Try again later."});
                } else {
                    const resBody = proxyRes.body;
                    const ctype = proxyRes.headers["content-type"];
                    res.statusMessage = proxyRes.statusMessage;
                    Object.entries(proxyRes.headers).forEach(([key, val]) => res.setHeader(key, val));
                    res.status(proxyRes.statusCode).send(resBody?.length > 0 ? (/application\/json/.test(ctype) ? JSON.parse(resBody) : resBody) : undefined);
                }
            });
        });
    }
    
}